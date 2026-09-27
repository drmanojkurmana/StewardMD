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
    cacheKey: "",        // residentId@orgId the mirror belongs to — load() drops keys absent here
    cacheAt: 0,
    // Last good /me for this account + institution, so a cold start with no signal can open the
    // logbook home instead of "Set up your logbook" (cachedContext()).
    meCache: null, meCacheAt: 0,
    // localId -> { code, message, fields, at }: a submission the SERVER REFUSED (a 4xx). These are not
    // retried; the draft stays on the device and the UI shows a "Fix" row (failedDrafts()).
    failed: {},
    // localId -> { id, at }: the server draft already created for this local draft, so a retry after
    // "create worked, submit failed" does not POST a second copy of the same entry.
    serverIds: {},
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

  /* SMD_IDTOKEN() is a CACHE that id-token.js primes on idle, so for the first seconds after launch
   * it is empty even though the user is signed in. Treating that as "signed out" is what made the
   * module open on a stub context with no orgCode - and the institution screen then printed the raw
   * 32-char org id instead of the SMD code, on every cold start. Ask Firebase directly when the
   * cache is cold; a genuinely signed-out user still resolves to "" and is still refused. */
  function tokenAsync() {
    var t = token();
    if (t) return Promise.resolve(t);
    try {
      var u = G && G.SMD_AUTH && G.SMD_AUTH.currentUser;
      if (u && u.getIdToken) {
        return u.getIdToken().then(function (x) { return String(x || ""); }, function () { return ""; });
      }
    } catch (e) {}
    return Promise.resolve("");
  }

  function req(path, opts) {
    opts = opts || {};
    if (!serverOn()) return Promise.reject(mkErr("server_disabled", "Server sync is turned off for this device."));
    if (!online()) return Promise.reject(mkErr("offline", "You are offline."));
    return tokenAsync().then(function (t) { return reqWith(t, path, opts); });
  }
  function reqWith(t, path, opts) {
    if (!t) return Promise.reject(mkErr("signin_required", "Sign in to sync your logbook."));
    var h = { "Authorization": "Bearer " + t };
    if (opts.body) h["Content-Type"] = "application/json";
    return G.fetch(API + path, {
      method: opts.method || "GET", headers: h,
      body: opts.body ? JSON.stringify(opts.body) : undefined
    }).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (j) {
        if (!r.ok) throw mkErr(j.error || ("http_" + r.status), j.message || j.detail || "", j.errors, r.status, j);
        return j;
      });
    }, function () {
      // fetch() itself rejected: no answer from the server at all (dead network, DNS, TLS, CORS).
      throw mkErr("network", "Could not reach the server.", null, 0);
    });
  }
  /* Every rejection carries `status` (the HTTP status, 0 when there was no HTTP answer), `retryable`
   * and, for an HTTP answer, the parsed `body` (so a screen can read e.g. body.joinRequest). */
  function mkErr(code, message, errors, status, body) {
    var e = new Error(code); e.code = code; e.userMessage = message || ""; e.errors = errors || null;
    e.status = status || 0; e.body = body || null;
    e.retryable = isRetryable(e);
    return e;
  }
  /* RETRY ONLY WHAT A RETRY CAN FIX. Offline, a network failure, a 5xx, a timeout, a rate limit or an
   * expired sign-in all clear up by themselves. Any other 4xx is the server saying "no" to THIS
   * entry (a validation failure, an unknown supervisor), and retrying it forever is what left
   * residents with a queue that never drained and never said why. */
  var RETRY_CODES = { offline: 1, network: 1, server_disabled: 1, signin_required: 1, not_linked: 1 };
  function isRetryable(e) {
    if (!e) return true;
    if (RETRY_CODES[e.code]) return true;
    var st = Number(e.status) || 0;
    if (!st) return e.code !== "no_draft" && e.code !== "no_id";
    return st >= 500 || st === 408 || st === 429 || st === 401;
  }

  /* ── reads ────────────────────────────────────────────────────────────────── */
  function me(orgId) {
    return req("/me?orgId=" + encodeURIComponent(orgId || load().orgId || "")).then(function (r) {
      // Keep the last good context for THIS institution, for an offline cold start.
      if (r && r.ok && r.orgId) patch(function (p) { p.meCache = r; p.meCacheAt = Date.now(); });
      return r;
    }, function (e) {
      // The server said this account is not (or no longer) part of that institution: forget the
      // mirror, so it can never reopen a logbook the account has lost access to.
      if (e && (e.status === 403 || e.status === 404)) patch(function (p) { p.meCache = null; p.meCacheAt = 0; });
      throw e;
    });
  }
  /* OFFLINE COLD START. The last good /me plus the dashboard mirror, for this account and ONLY for the
   * institution the device is linked to (and, for the dashboard, only that resident: the same keying
   * cachedDashboard() applies). null when there is nothing that matches; the screen then shows setup
   * exactly as before. Returns { ctx, dashboard, at }, ctx.stale = true. Read-only: nothing here can
   * write, submit or verify. */
  function cachedContext() {
    var p = load();
    var mc = p.meCache;
    var want = normOrgHandle(p.orgId);
    if (!mc || !want) return null;
    if (normOrgHandle(mc.orgId) !== want && normOrgHandle(mc.orgCode || "") !== want) return null;
    var res = mc.resident;
    return {
      ctx: Object.assign({}, mc, { stale: true }),
      dashboard: res && res.id ? cachedDashboard(res.id) : null,
      at: p.meCacheAt || 0
    };
  }
  function ready() {
    // Deliberately unauthenticated and never rejects: it is how the UI decides whether to offer the
    // "connect to your institution" path at all.
    if (!serverOn() || !online()) return Promise.resolve({ ok: false, enabled: false, reason: "offline" });
    return G.fetch(API + "/ready").then(function (r) { return r.json(); }).catch(function () { return { ok: false, enabled: false }; });
  }
  function dashboard(residentId) {
    return req("/dashboard/resident?residentId=" + encodeURIComponent(residentId)).then(function (d) {
      // Stamp WHOSE logbook this is. The mirror was stored unkeyed, and the screen falls back to it
      // on ANY rejection - so after switching institution, a 403 on the new one resurfaced the
      // previous college's logbook and labelled it merely "your last synced copy".
      patch(function (p) { p.cache = d; p.cacheAt = Date.now(); p.cacheKey = cacheKeyFor(residentId); });
      return d;
    });
  }
  function cacheKeyFor(residentId) {
    var c = context();
    return String(residentId || "") + "@" + String((c && c.orgId) || "");
  }
  /* Returns the mirror ONLY when it belongs to the resident and institution being asked about.
   * `residentId` is optional so older callers still work, but they get nothing back unless the
   * stored key matches - refusing to show a logbook is always safer than showing the wrong one. */
  function cachedDashboard(residentId) {
    var p = load();
    if (!p.cache) return null;
    if (residentId === undefined) return p.cacheKey ? null : p.cache;
    return p.cacheKey === cacheKeyFor(residentId) ? p.cache : null;
  }
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
      .then(function (r) {
        return r.json().catch(function () { return null; }).then(function (j) {
          /* Check the STATUS. A 429 or a 500 returns a body with no `status` field, which the check
           * screen rendered as "Unknown result" - to an examiner asking whether a signature on a
           * training record is genuine. "We could not check right now" is a different answer from
           * "we do not recognise this", and only one of them means try again. */
          if (!r.ok) return { ok: false, status: "unavailable", message: (j && j.message) || "" };
          return j || { ok: false, status: "unavailable" };
        });
      });
  }
  /* ── certification ─────────────────────────────────────────────────────────
   * The signed, frozen document. Never cached and never queued offline: a certificate is minted by
   * the server against live content, and an offline "certify" that landed hours later would sign a
   * logbook nobody was looking at. */
  function certificates(residentId) {
    return req("/certificates?residentId=" + encodeURIComponent(residentId))
      .then(function (r) { return r.certificates || []; });
  }
  function certificate(id) { return req("/certificates/" + encodeURIComponent(id)); }
  function requestCertificate(body) {
    return req("/certificates", { method: "POST", body: body }).then(function (r) { return r.certificate; });
  }
  function signCertificate(id, body) {
    return req("/certificates/" + encodeURIComponent(id) + "/sign", { method: "POST", body: body || {} });
  }
  function revokeCertificate(id, reason) {
    return req("/certificates/" + encodeURIComponent(id) + "/revoke", { method: "POST", body: { reason: reason } })
      .then(function (r) { return r.certificate; });
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

  /* ── Academic Cell writes ─────────────────────────────────────────────────
   * The module could READ programmes and residents but never create either, so nobody could be
   * enrolled and every user sat on "your training record is not linked yet" forever. These three
   * are the missing setup path. All server-gated on PGLOG_CONFIGURE (the Academic Cell cap). */

  // The institution itself is an ORG in the existing queue/OPD system, not a new entity — the same
  // SMD-XXXXXX code the rest of the app already uses. Creator becomes its owner.
  function createInstitution(name) {
    return G.fetch("/api/queue/org", {
      method: "POST",
      headers: { "Authorization": "Bearer " + token(), "Content-Type": "application/json" },
      body: JSON.stringify({ name: String(name || "").trim(), mode: "native", kind: "institution" })
    }).then(function (r) { return r.json().catch(function () { return {}; }); })
      .then(function (j) {
        if (!j || !j.ok || !j.org) throw mkErr((j && j.error) || "org_failed", "Could not create the institution.");
        return j.org;
      });
  }
  // Institutions this account OWNS. A provisioned college admin owns theirs, so this is what stops
  // the console offering "create" to someone whose college already exists — which would quietly
  // produce a second, empty college and a second code.
  /* Rejects rather than resolving to []. It used to swallow everything, including the response
   * STATUS, so a 401 or a 500 was indistinguishable from "you belong to no institutions" - and the
   * screen then told an administrator that their own colleges did not exist. */
  function myInstitutions() {
    return G.fetch("/api/queue/orgs", { headers: { "Authorization": "Bearer " + token() } })
      .then(function (r) {
        return r.json().catch(function () { return {}; }).then(function (j) {
          if (!r.ok || (j && j.ok === false)) {
            throw mkErr((j && j.error) || ("http_" + r.status), (j && j.message) || "");
          }
          return (j && j.orgs) || [];
        });
      });
  }
  /* Remove a programme created by mistake. The server refuses with 409 while anyone is enrolled, so
   * this never has to decide that for itself - it reports what came back. */
  function deleteProgramme(id) {
    return req("/programmes/" + encodeURIComponent(id), { method: "DELETE" });
  }
  function createProgramme(orgId, body) {
    return req("/programmes", { method: "POST", body: Object.assign({ orgId: orgId }, body || {}) })
      .then(function (r) { return r.programme; });
  }
  // One call adds the membership AND, for a resident with a programme, the enrolment — a half-enrolled
  // member still sees the "not linked yet" screen, which is the bug this whole path exists to fix.
  function enrolPerson(orgId, body) {
    return req("/enrol", { method: "POST", body: Object.assign({ orgId: orgId }, body || {}) });
  }
  /* Bulk: rows [{ email, guide?, trainingYear?, name? }], max 100. Resolves
   * { ok, results:[{ email, ok, status:"enrolled"|"invited"|"error", error?, message?, residentId? }],
   *   enrolled, invited, failed }. */
  function enrolBulk(orgId, programmeId, rows, extra) {
    return req("/enrol-bulk", { method: "POST", body: Object.assign({ orgId: orgId, programmeId: programmeId, rows: rows || [] }, extra || {}) });
  }
  function invites(orgId) { return req("/invites?orgId=" + encodeURIComponent(orgId)).then(function (r) { return r.invites || []; }); }
  /* Assign / change a resident's guide (Academic Cell, or the HoD of that resident's department), or
   * any other structural field (Academic Cell only). The server validates the guide and refuses to
   * let anyone name themselves. Resolves the updated resident. */
  function updateResident(residentId, patchBody) {
    return req("/residents/" + encodeURIComponent(residentId), { method: "PATCH", body: patchBody || {} })
      .then(function (r) { return r.resident; });
  }
  /* "Request to join" by institution code. Grants nothing until an Academic Cell / HoD approves. */
  function requestJoin(orgCode, programmeHint, note) {
    return req("/join-request", { method: "POST", body: { orgCode: orgCode, programmeHint: programmeHint || "", note: note || "" } });
  }
  function myJoinRequest() { return req("/join-request").then(function (r) { return r.joinRequest || null; }); }
  function joinRequests(orgId, status) {
    return req("/join-requests?orgId=" + encodeURIComponent(orgId) + (status ? "&status=" + encodeURIComponent(status) : ""))
      .then(function (r) { return r.joinRequests || []; });
  }
  function approveJoinRequest(id, body) {
    return req("/join-requests/" + encodeURIComponent(id) + "/approve", { method: "POST", body: body || {} });
  }
  function rejectJoinRequest(id, reason) {
    return req("/join-requests/" + encodeURIComponent(id) + "/reject", { method: "POST", body: { reason: reason || "" } })
      .then(function (r) { return r.joinRequest; });
  }
  function config(programmeId) { return req("/config/" + encodeURIComponent(programmeId)); }
  function setConfig(programmeId, overrides) { return req("/config/" + encodeURIComponent(programmeId), { method: "PUT", body: { overrides: overrides } }); }

  /* ── local drafts ─────────────────────────────────────────────────────────── */

  // A draft never leaves the device until the resident submits. It is validated with the SAME pure
  // validator the server uses, so "the form said it was fine" and "the server accepted it" can never
  // disagree.
  function saveDraft(body) {
    var m = M(); if (!m) return null;
    var p = load();
    /* Re-saving an EXISTING draft (the "Fix" path for a refused submission) must update that draft,
     * not mint a second one beside it: reuse body.id when it names a draft already on the device. */
    var id = body.localId || (body.id && p.drafts && p.drafts[body.id] ? body.id : "") || localId();
    var e = m.entry(Object.assign({}, body, {
      id: id, residentId: body.residentId || p.residentId, programmeId: body.programmeId || p.programmeId,
      status: "draft", createdAt: body.createdAt || Date.now(), updatedAt: Date.now()
    }));
    patch(function (st) {
      st.drafts[id] = e;
      // Saving is how a refused draft is fixed: the old refusal no longer describes it.
      if (st.failed) delete st.failed[id];
      st.prefs.lastKind = e.kind;
      if (e.setting) st.prefs.lastSetting = e.setting;
      if (e.supervisor) st.prefs.lastSupervisor = e.supervisor;
      if (e.departmentId) st.prefs.lastDepartmentId = e.departmentId;
      if (e.rotationId) st.prefs.lastRotationId = e.rotationId;
    });
    return e;
  }
  /* A refused draft carries `lastError: { code, message, fields, at }` on the objects drafts(),
   * getDraft() and failedDrafts() return. It is stored beside the draft (state.failed), not inside it,
   * because m.entry() is the schema authority and drops unknown fields; so it is always a COPY, and
   * re-saving the draft (saveDraft) clears it. */
  function decorate(p, d) {
    if (!d) return null;
    var f = p.failed && p.failed[d.id];
    return f ? Object.assign({}, d, { lastError: f }) : d;
  }
  function drafts() {
    var p = load(), d = p.drafts || {};
    return Object.keys(d).map(function (k) { return decorate(p, d[k]); })
      .sort(function (a, b) { return String(b.occurredAt).localeCompare(String(a.occurredAt)); });
  }
  // Drafts the server refused (a 4xx). Not queued, not retried: each needs the resident to fix it.
  function failedDrafts() {
    var p = load(), d = p.drafts || {};
    return Object.keys(p.failed || {}).map(function (k) { return decorate(p, d[k]); }).filter(Boolean)
      .sort(function (a, b) { return (b.lastError.at || 0) - (a.lastError.at || 0); });
  }
  function getDraft(id) { var p = load(); return decorate(p, (p.drafts || {})[id] || null); }
  function dropDraft(id) {
    patch(function (p) {
      delete p.drafts[id];
      if (p.failed) delete p.failed[id];
      if (p.serverIds) delete p.serverIds[id];
      p.queue = (p.queue || []).filter(function (q) { return q !== id; });
    });
  }
  function validateDraft(e, ctx) { var m = M(); return m ? m.validateEntry(e, ctx) : { ok: false, errors: [] }; }

  /* The refusal, in words a resident can act on. App-facing, so no em-dash (server and model text is
   * folded too). */
  function plain(t) { return String(t || "").replace(/\s*[\u2014\u2013]\s*/g, ", ").trim(); }
  function lastErrorFor(e) {
    var code = (e && e.code) || "error";
    var fields = [];
    (e && e.errors || []).forEach(function (x) { if (x && x.field) fields.push(String(x.field)); });
    var first = (e && e.errors && e.errors[0] && e.errors[0].message) || "";
    var msg;
    if (code === "validation") msg = first ? "Fix this before sending: " + first : "Some details need fixing before this can be sent.";
    else if (code === "supervisor_unresolved") msg = (e && e.userMessage) || "Pick your guide or a listed faculty member as the supervisor.";
    else if (code === "not_found") msg = "Your logbook link has changed. Open the logbook again, then send this entry.";
    else if (code === "forbidden" || code === "not_own_record" || code === "cross_org") msg = "This entry cannot be sent from this account. Check you are signed in as yourself and linked to the right institution.";
    else msg = (e && e.userMessage) || "The server did not accept this entry. Open it to check the details.";
    return { code: code, message: plain(msg), fields: fields, status: (e && e.status) || 0, at: Date.now() };
  }

  /* ── submission ───────────────────────────────────────────────────────────────
   * push() is a two-step because the server owns both halves: create (which stamps the author and
   * the time) then submit (which sets pendingFor and notifies the supervisor). A failure between
   * them leaves a server-side DRAFT, which is recoverable and visible, never a lost entry; its id is
   * remembered (state.serverIds) so the retry submits THAT draft instead of creating a second copy.
   *
   * Rejects with e.retryable. retryable === false means the server refused this entry (a 4xx): it is
   * taken out of the queue and kept as a draft with lastError, for the resident to fix. */
  function submitDraft(id) {
    var raw = (load().drafts || {})[id];
    if (!raw) { var gone = mkErr("no_draft", "That draft is gone."); gone.retryable = false; return Promise.reject(gone); }
    var d = raw;
    /* A draft recorded BEFORE the account was linked has a blank residentId / programmeId. Stamp them
     * from the link as it stands now; with no link yet it stays queued rather than failing. */
    var c = context();
    if ((!d.residentId && c.residentId) || (!d.programmeId && c.programmeId)) {
      d = Object.assign({}, d, { residentId: d.residentId || c.residentId, programmeId: d.programmeId || c.programmeId });
      patch(function (p) { if (p.drafts[id]) { p.drafts[id].residentId = d.residentId; p.drafts[id].programmeId = d.programmeId; } });
    }
    if (!d.residentId) {
      return Promise.reject(mkErr("not_linked", "Your logbook is not linked to a programme yet. This entry will be sent once it is."));
    }
    var body = stripLocal(d);
    var known = (load().serverIds || {})[id];
    var create = function () {
      return req("/entries", { method: "POST", body: body }).then(function (r) {
        var serverId = r.entry && r.entry.id;
        if (!serverId) throw mkErr("no_id", "The server did not return an entry id.");
        patch(function (p) { p.serverIds = p.serverIds || {}; p.serverIds[id] = { id: serverId, at: d.updatedAt || 0 }; });
        return serverId;
      });
    };
    var alreadyDone = false;
    var ensure = !known ? create() :
      // Changed since that server draft was made (the resident fixed it): bring it up to date first.
      ((d.updatedAt || 0) > (known.at || 0)
        ? req("/entries/" + encodeURIComponent(known.id), { method: "PATCH", body: body }).then(function () {
            patch(function (p) { if (p.serverIds && p.serverIds[id]) p.serverIds[id].at = d.updatedAt || 0; });
            return known.id;
          })
        : Promise.resolve(known.id))
      .then(null, function (e) {
        if (e && e.status === 404) return create();                 // that server draft is gone
        // The earlier attempt DID submit (its answer was lost): nothing left to do.
        if (e && (e.code === "pglog_submitted_withdraw_first" || e.code === "pglog_verified_immutable")) { alreadyDone = true; return known.id; }
        throw e;
      });
    return ensure
      .then(function (serverId) {
        if (alreadyDone) return { entry: { id: serverId, status: "submitted" } };
        return req("/entries/" + encodeURIComponent(serverId) + "/submit", { method: "POST", body: {} });
      })
      .then(function (r) {
        dropDraft(id);
        var entry = r.entry || {};
        if (r.routing) entry.routing = r.routing;
        return entry;
      }, function (e) {
        e.retryable = isRetryable(e);
        if (!e.retryable) {
          var le = lastErrorFor(e);
          e.lastError = le;
          patch(function (p) {
            p.failed = p.failed || {};
            p.failed[id] = le;
            p.queue = (p.queue || []).filter(function (q) { return q !== id; });
          });
        }
        throw e;
      });
  }
  // Queue for later when there is no network. The UI must show these as "waiting to submit", not as
  // "submitted", since nobody owes them a verification yet. A draft the server REFUSED is not queued
  // (retrying cannot fix it): the return value is then the unchanged queue length.
  function queueDraft(id) {
    patch(function (p) {
      if (p.failed && p.failed[id]) return;
      if (p.queue.indexOf(id) < 0) p.queue.push(id);
    });
    return load().queue.length;
  }
  function queued() { var p = load(); return (p.queue || []).map(function (id) { return p.drafts[id]; }).filter(Boolean); }
  /* THE ONE CALL a save screen needs. Never rejects. Resolves one of:
   *   { status: "submitted", entry, routing }   routing: "supervisor" | "guide" | "unassigned"
   *   { status: "queued", reason, message }     offline / network / 5xx / not linked yet: retried by flush()
   *   { status: "needs_fix", lastError }         the server refused it (4xx): kept as a draft, not queued */
  function submitOrQueue(id) {
    if (!serverOn() || !online()) {
      queueDraft(id);
      return Promise.resolve({ status: "queued", reason: !serverOn() ? "server_disabled" : "offline", message: "" });
    }
    return submitDraft(id).then(function (entry) {
      return { status: "submitted", entry: entry, routing: entry.routing || "" };
    }, function (e) {
      if (e && e.retryable === false) return { status: "needs_fix", lastError: e.lastError || lastErrorFor(e) };
      queueDraft(id);
      return { status: "queued", reason: (e && e.code) || "error", message: plain(e && e.userMessage) };
    });
  }
  // Drain the queue. Resolves with a per-item result rather than rejecting, so one bad entry does
  // not strand the rest: { sent, failed:[retryable, still queued], needsFix:[refused, moved to drafts] }.
  /* Two callers can start a flush: the boot timer and the `online` listener, and a reconnect fires
   * both. Without a guard they each snapshot the same queue and each POST every draft in it, so the
   * guide receives two identical entries - and the server has no idempotency key to collapse them.
   * A second caller now joins the pass already running instead of starting another. */
  var _flushing = null;
  function flush() {
    if (_flushing) return _flushing;
    var q = (load().queue || []).slice();
    if (!q.length) return Promise.resolve({ sent: 0, failed: [], needsFix: [] });
    var sent = 0, failed = [], needsFix = [];
    var done = function () {
      patch(function (p) {
        var attempted = {};
        q.forEach(function (id) { attempted[id] = 1; });
        /* Keep anything that failed RETRYABLY, and anything queued DURING this pass. The old filter
         * kept only the failures, so a draft saved while the flush was in flight was dropped from the
         * queue without ever being sent. A REFUSED draft (4xx) leaves the queue for good: retrying it
         * forever is how a queue never drained and never said why. */
        p.queue = (p.queue || []).filter(function (id) {
          return !attempted[id] || failed.some(function (f) { return f.id === id; });
        });
      });
      _flushing = null;
      return { sent: sent, failed: failed, needsFix: needsFix };
    };
    _flushing = q.reduce(function (chain, id) {
      return chain.then(function () {
        return submitDraft(id).then(function () { sent++; }, function (e) {
          if (e && e.retryable === false) {
            if (e.code !== "no_draft") needsFix.push({ id: id, error: e.code, message: (e.lastError && e.lastError.message) || "" });
          } else {
            failed.push({ id: id, error: e && e.code, message: e && e.userMessage });
          }
        });
      });
    }, Promise.resolve()).then(done, function (e) { _flushing = null; throw e; });
    return _flushing;
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
  /* An institution handle is EITHER a human-facing SMD-XXXXXX code (case-insensitive, canonically
   * upper) or a 32-char Firestore document id (lower-case hex, case-SENSITIVE). The setup screen
   * upper-cased everything a user typed, which is right for the first and destroys the second: a
   * pasted org id became 349CDC... , fsGet("q_orgs/349CDC...") matched no document, and every pglog
   * call failed the same silent way. Normalise in ONE place, on the way in and on the way out, so
   * a handle already stored wrong on a device heals itself without the user retyping it. */
  function normOrgHandle(v) {
    v = String(v == null ? "" : v).trim();
    return /^[0-9a-fA-F]{32}$/.test(v) ? v.toLowerCase() : v.toUpperCase();
  }
  function setContext(c) {
    patch(function (p) {
      if (c.orgId != null) p.orgId = normOrgHandle(c.orgId);
      if (c.residentId != null) p.residentId = String(c.residentId);
      if (c.programmeId != null) p.programmeId = String(c.programmeId);
      if (c.curriculumId != null) p.curriculumId = String(c.curriculumId);
    });
  }
  function context() { var p = load(); return { orgId: normOrgHandle(p.orgId), residentId: p.residentId, programmeId: p.programmeId, curriculumId: p.curriculumId }; }
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
    ready: ready, me: me, dashboard: dashboard, cachedDashboard: cachedDashboard, cachedContext: cachedContext,
    facultyDashboard: facultyDashboard, deptDashboard: deptDashboard,
    entries: entries, entry: entry, rotations: rotations, assessments: assessments,
    attestations: attestations, pending: pending, residents: residents, programmes: programmes,
    notifications: notifications, markRead: markRead, config: config, setConfig: setConfig,
    facultyRoster: facultyRoster, verifyCode: verifyCode,
    // academic-cell writes
    createInstitution: createInstitution, createProgramme: createProgramme, deleteProgramme: deleteProgramme, enrolPerson: enrolPerson,
    myInstitutions: myInstitutions,
    certificates: certificates, certificate: certificate, requestCertificate: requestCertificate,
    signCertificate: signCertificate, revokeCertificate: revokeCertificate,
    // drafts
    saveDraft: saveDraft, drafts: drafts, getDraft: getDraft, dropDraft: dropDraft,
    validateDraft: validateDraft, submitDraft: submitDraft, queueDraft: queueDraft,
    queued: queued, flush: flush, stripLocal: stripLocal, localId: localId,
    failedDrafts: failedDrafts, submitOrQueue: submitOrQueue, isRetryable: isRetryable,
    // onboarding
    enrolBulk: enrolBulk, invites: invites, updateResident: updateResident,
    requestJoin: requestJoin, myJoinRequest: myJoinRequest, joinRequests: joinRequests,
    approveJoinRequest: approveJoinRequest, rejectJoinRequest: rejectJoinRequest,
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
