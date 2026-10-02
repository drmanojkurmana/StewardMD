/* pglog-screens.js — NMC Logbook · router + every screen.
 * ===========================================================================
 * Sibling of surgx-screens.js / clinix-screens.js. Scoped to #pglogRoot / #pglogScroll / .pgl-*.
 * All data-act values are prefixed pgl- so they cannot collide with home.js's ACT map. Back/close
 * use .pgl-back / .pgl-close, which swipe-back.js's BACK_SEL already matches.
 *
 * Routes: "home" · "add" · "add/<kind>" · "entries" · "entry/<id>" · "progress" · "rotations" ·
 *         "research" · "attendance" · "reports" · "report/<id>" · "certify" · "faculty" · "review/<id>" ·
 *         "dept" · "resident/<id>" · "setup" · "inbox"
 *
 * THREE THINGS THIS FILE IS DELIBERATELY NOT
 *   - it does not own the rules. Validation, progress, verification and audit come from
 *     pglog-model.js; requirements come from the curriculum packs. This renders them.
 *   - it does not decide what an NMC requirement is. Every requirement chip renders the
 *     provenance grade the pack gave it. There is no place here where a label is written by hand.
 *   - it does not gamify. No streaks, no badges, no confetti. A training record does not
 *     congratulate you for having done your job.
 *
 * THE UX RULE THAT DROVE THE LAYOUT: the most common action must be three taps.
 *   Open -> + Add -> Procedure -> (procedure, role, faculty prefilled) -> Submit.
 * Everything a resident already told StewardMD (their unit, their current rotation, their usual
 * supervisor, today's date) is prefilled and editable, never re-asked.
 */
(function () {
  "use strict";

  /* ── shorthands ──────────────────────────────────────────────────────────── */
  function M() { try { return window.SMD_PGLOG_MODEL || null; } catch (e) { return null; } }
  function C() { try { return window.SMD_PGLOG_CURRICULUM || null; } catch (e) { return null; } }
  function ST() { try { return window.SMD_PGLOG_STORE || null; } catch (e) { return null; } }
  function REP() { try { return window.SMD_PGLOG_REPORTS || null; } catch (e) { return null; } }
  function QK() { try { return window.SMD_PGLOG_QUICK || null; } catch (e) { return null; } }
  function AN() { try { return window.SMD_PGLOG_ANALYTICS || null; } catch (e) { return null; } }
  function PH() { try { return window.SMD_PGLOG_PHOTOS || null; } catch (e) { return null; } }
  function BK() { try { return window.SMD_PGLOG_BACKUP || null; } catch (e) { return null; } }
  function AI() { try { return window.SMD_PGLOG_AI || null; } catch (e) { return null; } }
  function flag(k) { try { return !!(window.SMD_PGLOG_FLAGS && SMD_PGLOG_FLAGS.bool(k)); } catch (e) { return false; } }
  function fint(k) { try { return window.SMD_PGLOG_FLAGS ? SMD_PGLOG_FLAGS.int(k) : 0; } catch (e) { return 0; } }

  function ic(n) { return '<span class="material-symbols-rounded" aria-hidden="true">' + n + "</span>"; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) {
      return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c];
    });
  }
  function attr(s) { return esc(s).replace(/\s+/g, " "); }
  function arr(x) { return Array.isArray(x) ? x : []; }
  function haptic(k) { try { if (window.SMD_HAPTICS && SMD_HAPTICS[k]) SMD_HAPTICS[k](); } catch (e) {} }
  // The clinician's own progress moment (smd-celebrate.js; plays the success haptic itself). `key` = once ever.
  function celebrate(title, detail, key) {
    if (window.SMD_CELEBRATE && window.SMD_CELEBRATE.show({ title: title, detail: detail, key: key })) return;
    haptic("success");
  }
  function toast(m) {
    try { if (window.toast) return window.toast(m); } catch (e) {}
    try { if (window.SB && SB.toast) return SB.toast(m); } catch (e) {}
    try { console.log("[pglog]", m); } catch (e) {}
  }
  function todayISO() { var m = M(); return m ? m.isoDate(Date.now()) : ""; }

  /* What this resident logs most, kept on the device so the quick picker puts it first. Titles
   * only - a procedure name is not patient data - capped, and scoped to the account. */
  function recentsKey() { try { var st = ST(); return "smd_pglog_recent_" + (st ? st.uid() : "anon"); } catch (e) { return "smd_pglog_recent_anon"; } }
  function readRecents() {
    if (state.quickRecents) return state.quickRecents;
    try { state.quickRecents = JSON.parse(localStorage.getItem(recentsKey()) || "[]") || []; }
    catch (e) { state.quickRecents = []; }
    return state.quickRecents;
  }
  function noteRecent(kind, title) {
    title = String(title || "").trim(); if (!title) return;
    var list = readRecents().slice(), hit = null;
    for (var i = 0; i < list.length; i++) {
      if (list[i] && String(list[i].title).toLowerCase() === title.toLowerCase() && list[i].kind === kind) { hit = list[i]; break; }
    }
    if (hit) { hit.n = (hit.n || 0) + 1; hit.at = Date.now(); }
    else list.push({ title: title, kind: kind, n: 1, at: Date.now() });
    list.sort(function (a, b) { return (b.n || 0) - (a.n || 0) || (b.at || 0) - (a.at || 0); });
    state.quickRecents = list.slice(0, 60);
    try { localStorage.setItem(recentsKey(), JSON.stringify(state.quickRecents)); } catch (e) {}
  }
  function recentsFor(kind) {
    return readRecents().filter(function (r) { return !kind || r.kind === kind; });
  }
  function specialtyId() {
    var p = (state.dash && state.dash.programme) || (state.ctx && state.ctx.programme) || {};
    return p.specialtyId || p.packId || p.name || "";
  }

  /* ── easy mode (smd_pglog_easy, default ON) ─────────────────────────────────
   * Residents called the eLogbook "a very hard, strict framework". Easy mode changes the WORDS and
   * the NUMBER OF TAPS, never a rule: verification, immutability, the monthly signature and who may
   * give it are all enforced by pglog-model.js and the server exactly as before. "0" restores the
   * previous screens for comparison. */
  function easy() { return flag("smd_pglog_easy"); }
  var SETTING_LABEL = { opd: "OPD", ipd: "Ward / IPD", emergency: "Emergency", ot: "Theatre", daycare: "Day care", bedside: "Bedside" };
  var OUTCOME_LABEL = { improved: "Improved", unchanged: "Unchanged", worsened: "Worsened", referred: "Referred", died: "Died", unknown: "Not known" };
  var ACAD_ROLE_LABEL = { presented: "Presented", attended: "Attended", moderated: "Moderated", organised: "Organised" };
  var SEX_LABEL = { male: "Male", female: "Female", other: "Other" };
  var KIND_TITLE = { procedure: "Log a procedure", clinical: "Log a case", academic: "Log an academic activity",
    research: "Log research", certification: "Log a certificate", attendance: "Record attendance", reflection: "Write a reflection" };
  function capWord(s) { s = String(s || "").replace(/_/g, " "); return s ? s.charAt(0).toUpperCase() + s.slice(1) : ""; }
  function kindText(e) {
    if (e && e.kind === "clinical") return "Clinical" + (e.setting ? " · " + settingText(e.setting) : "");
    var R = REP(); return R ? R.kindLabel(e) : capWord(e && e.kind);
  }
  function settingText(v) { return SETTING_LABEL[v] || capWord(v); }
  function outcomeText(v) { return OUTCOME_LABEL[v] || capWord(v); }
  function roleText(e) {
    var m = M(), r = e && e.role;
    if (!r) return "";
    return (m && m.ROLE_LABEL && m.ROLE_LABEL[r]) || ACAD_ROLE_LABEL[r] || capWord(r);
  }
  /* A person's NAME wherever one is known. The roster (/faculty-roster) now carries names; the uid
   * fragment REP().person() prints is the last resort, never the first. */
  function personName(id) {
    if (!id) return "";
    var m = M();
    try { if (state.ctx && state.ctx.uid && m && m.sameActor(id, state.ctx.uid)) return "You"; } catch (e) {}
    var lists = [arr(state.roster), arr(state.inst && state.inst.faculty)];
    for (var i = 0; i < lists.length; i++) {
      for (var j = 0; j < lists[i].length; j++) {
        var r = lists[i][j];
        if (r && r.name && sameId(r.identity, id)) return r.name;
      }
    }
    var res = (state.dash && state.dash.resident) || (state.ctx && state.ctx.resident) || {};
    if (res.guide && sameId(id, res.guide) && res.guideName) return res.guideName;
    for (var k = 0; k < lists.length; k++) {
      var hit = lists[k].filter(function (r) { return r && sameId(r.identity, id); })[0];
      if (hit) return rosterLabel(hit);
    }
    if (res.guide && sameId(id, res.guide)) return "Your guide";
    return REP() ? REP().person(id) : String(id);
  }
  function sameId(a, b) {
    if (!a || !b) return false;
    if (a === b) return true;
    try { var m = M(); return !!(m && m.sameActor && m.sameActor(a, b)); } catch (e) { return false; }
  }
  /* The roster may not know a name yet (name ""). A role label reads better than a uid fragment; the
   * short tail is only there so two unnamed people in one picker can be told apart. */
  function rosterLabel(r) {
    if (!r) return "";
    if (r.name) return r.name;
    var tail = String(r.identity || "").replace(/^(fb:|ghis:|cfa:)/, "").slice(-4);
    return (r.role === "pg_hod" ? "Head of Department" : r.role === "academic_cell" ? "Academic Cell" : "Faculty member") + (tail ? " (" + tail + ")" : "");
  }
  function residentRecord() { return (state.dash && state.dash.resident) || (state.ctx && state.ctx.resident) || null; }
  function guideOf() { var r = residentRecord(); return (r && r.guide) || ""; }
  /* The disclosure the provenance moved into. The badge itself is still rendered by prov(), so the
   * NMC-vs-institution distinction is exactly what it was; it is just not the first thing a resident
   * reads on a form. Progress, Reports and the certificate keep their badges in the open. */
  function whyBox(inner) {
    return '<details class="pgl-why"><summary>' + ic("help") + "Why is this required?</summary><div>" + inner + "</div></details>";
  }
  function provHome(source, clause) { return easy() ? "" : " " + prov(source, clause); }
  function monthOf(e) { return String((e && e.occurredAt) || "").slice(0, 7); }
  /* A failure the network caused (retry later) versus a refusal the server made (the resident has to
   * change something). Only the first may be queued with "it will be submitted when you are online". */
  function isTransient(e) {
    if (!e) return true;
    if (typeof e.retryable === "boolean") return e.retryable;   // the store's own classification
    var c = e.code;
    if (c === "network") return true;
    if (!c || c === "offline" || c === "server_disabled" || c === "signin_required") return true;
    return /^http_5/.test(String(c)) || c === "unavailable";
  }
  function refusalText(e) {
    if (e && e.userMessage) return e.userMessage;
    var c = e && e.code;
    if (c === "supervisor_unresolved") return "That supervisor is not on your department's faculty list, so nobody would receive it. Pick your guide or a listed faculty member.";
    if (c === "not_found") return "Your logbook is not linked to a programme yet, so this cannot be submitted.";
    if (c === "forbidden") return "The server refused this entry for your account.";
    if (c === "validation" || c === "invalid") return "The server found a field that needs fixing.";
    return "The server did not accept this entry (" + String(c || "error") + ").";
  }
  /* Drafts the server refused. The store stamps lastError on them (and may expose failedDrafts());
   * state.submitErrors is this session's own record, so the Fix row appears even on an older store. */
  function failedDrafts() {
    var st = ST(); if (!st) return [];
    var list = [];
    try { list = st.failedDrafts ? arr(st.failedDrafts()) : []; } catch (e) { list = []; }
    var seen = {}; list.forEach(function (d) { if (d && d.id) seen[d.id] = 1; });
    arr(st.drafts()).forEach(function (d) {
      var le = d.lastError || (state.submitErrors && state.submitErrors[d.id]);
      if (le && !seen[d.id]) { seen[d.id] = 1; list.push(Object.assign({}, d, { lastError: le })); }
    });
    return list.map(function (d) {
      return d.lastError ? d : Object.assign({}, d, { lastError: (state.submitErrors && state.submitErrors[d.id]) || { code: "refused", message: "" } });
    });
  }
  function draftError(id) {
    var d = failedDrafts().filter(function (x) { return x.id === id; })[0];
    return d ? d.lastError : null;
  }
  function noteSubmitError(id, e) {
    state.submitErrors = state.submitErrors || {};
    state.submitErrors[id] = { code: (e && e.code) || "refused", message: refusalText(e) };
  }

  /* Transport for the endpoints the store may not wrap yet (join requests, bulk enrol, resident
   * update). Same token path and error shape as pglog-store's req(), so a store that does wrap them
   * is preferred and this is only the fallback. */
  function api(path, opts) {
    opts = opts || {};
    if (!flag("smd_pglog_server")) return Promise.reject(Object.assign(new Error("server_disabled"), { code: "server_disabled", userMessage: "Server sync is off on this device." }));
    var tok = "";
    try { tok = (window.SMD_IDTOKEN && window.SMD_IDTOKEN()) || ""; } catch (e) {}
    var tp = tok ? Promise.resolve(tok) : (function () {
      try { var u = window.SMD_AUTH && window.SMD_AUTH.currentUser; if (u && u.getIdToken) return u.getIdToken().then(String, function () { return ""; }); } catch (e) {}
      return Promise.resolve("");
    })();
    return tp.then(function (t) {
      if (!t) throw Object.assign(new Error("signin_required"), { code: "signin_required", userMessage: "Sign in first." });
      var h = { "Authorization": "Bearer " + t };
      if (opts.body) h["Content-Type"] = "application/json";
      return window.fetch("/api/pglog" + path, { method: opts.method || "GET", headers: h, body: opts.body ? JSON.stringify(opts.body) : undefined })
        .then(function (r) {
          return r.json().catch(function () { return {}; }).then(function (j) {
            if (!r.ok) throw Object.assign(new Error(j.error || "http_" + r.status), { code: j.error || ("http_" + r.status), userMessage: j.message || "", status: r.status });
            return j;
          });
        });
    });
  }
  function storeCall(names, args, fallback) {
    var st = ST();
    for (var i = 0; i < names.length; i++) { if (st && typeof st[names[i]] === "function") return st[names[i]].apply(st, args); }
    return fallback();
  }

  /* An in-app sheet for a short typed reason (withdraw, amend, reject). window.prompt() is a desktop
   * dialog in a mobile shell: it cannot be styled, it loses the keyboard on iOS and it blocks the
   * WebView. cb(null) on cancel, cb(text) on confirm. */
  function reasonSheet(o, cb) {
    o = o || {};
    var ov = document.createElement("div");
    ov.className = "pgl-consent-ov pgl-reason-ov";
    ov.innerHTML = '<div class="pgl-consent pgl-reason" role="dialog" aria-modal="true" aria-label="' + attr(o.title || "Reason") + '">' +
      '<div class="pgl-consent-t">' + esc(o.title || "Reason") + "</div>" +
      (o.body ? '<p class="pgl-reason-b">' + esc(o.body) + "</p>" : "") +
      '<textarea id="pglReasonTxt" class="pgl-qinput" rows="3" placeholder="' + attr(o.placeholder || "") + '"></textarea>' +
      '<div class="pgl-reason-err" id="pglReasonErr"></div>' +
      '<div class="pgl-consent-acts">' +
        '<button class="pgl-btn ghost" id="pglReasonNo">Cancel</button>' +
        '<button class="pgl-btn" id="pglReasonGo">' + esc(o.confirm || "Confirm") + "</button>" +
      "</div></div>";
    document.body.appendChild(ov);
    var ta = ov.querySelector("#pglReasonTxt");
    function done(v) { try { ov.remove(); } catch (e) {} cb(v); }
    ov.querySelector("#pglReasonNo").addEventListener("click", function () { done(null); });
    ov.querySelector("#pglReasonGo").addEventListener("click", function () {
      var v = String(ta.value || "").trim();
      if (!v && o.required !== false) { ov.querySelector("#pglReasonErr").textContent = o.requiredText || "Please write a short reason."; return; }
      done(v);
    });
    ov.addEventListener("click", function (e) { if (e.target === ov) done(null); });
    try { setTimeout(function () { ta.focus(); }, 60); } catch (e) {}
  }

  /* ── state ───────────────────────────────────────────────────────────────── */
  var state = {
    root: null, host: null, stack: ["home"],
    loading: false, error: "",
    ctx: null,            // { role, caps, resident, programme, rotations } from /me
    dash: null,           // resident dashboard payload
    pack: null,           // flattened curriculum pack
    requirements: [],     // resolved for this resident
    progress: [], gaps: [], eligibility: null,
    templates: null,
    draft: null, draftErrors: [], suggestions: [],
    faculty: null, dept: null, review: null, assessment: null,
    roster: [], checked: null,
    cert: null, certVerifyUrl: "", certLoading: false,   // the signed document + its QR target
    filter: { kind: "", status: "" },
    deptFilter: { departmentId: "", trainingYear: "" },
    inbox: [],
    // Quick log (15-20s path), analytics and the Drive backup sheet.
    quick: null,          // { kind, query, title, role, setting, complications[], notes, heard[], photos[] }
    quickRecents: null,   // [{title,kind,n,at}] from localStorage - what THIS resident picks most
    analytics: { window: "all", kind: "" },
    backupBusy: false
  };

  function route() { return state.stack[state.stack.length - 1] || "home"; }
  function head0() { return String(route()).split("/")[0]; }
  function arg() { var p = String(route()).split("/"); return p.slice(1).join("/"); }
  function go(r) { state.stack.push(r); render(); try { state.host.scrollTop = 0; } catch (e) {} }
  function back() {
    if (state.stack.length > 1) { state.stack.pop(); render(); try { state.host.scrollTop = 0; } catch (e) {} }
    else if (window.PGLOG) window.PGLOG.close();
  }
  function replace(r) { state.stack[state.stack.length - 1] = r; render(); }

  /* ── chrome ──────────────────────────────────────────────────────────────── */
  function head(title, sub, right) {
    var isHome = route() === "home";
    var lead = isHome
      ? '<button class="pgl-hbtn pgl-close" data-pgl="close" aria-label="Close NMC eLOGBook">' + ic("close") + "</button>"
      : '<button class="pgl-hbtn pgl-back" data-pgl="back" aria-label="Back">' + ic("arrow_back") + "</button>";
    return '<div class="pgl-head">' + lead +
      '<div class="pgl-htitle">' + (sub ? '<span class="pgl-hsub">' + esc(sub) + "</span>" : "") + esc(title) + "</div>" +
      (right || "") +
      (isHome ? "" : '<button class="pgl-hbtn pgl-close" data-pgl="close" aria-label="Close">' + ic("close") + "</button>") +
      "</div>";
  }
  function wrap(inner) { return '<div class="pgl-wrap">' + inner + "</div>"; }
  // Privacy mode (privacy-mode.js): the case reference (an MRN / IP number) is wrapped so it can be masked on
  // screen; plain esc() without it.
  function phi(kind, v, html) { var P = window.SMD_PRIVACY_MODE; return P ? P.wrap(kind, v, html) : (html == null ? esc(v) : html); }
  function loading() { return '<div class="pgl-wrap pgl-skel"><i></i><i></i><i></i><i></i></div>'; }
  function emptyState(icon, title, sub, action) {
    return '<div class="pgl-state"><div class="ic">' + ic(icon) + "</div>" +
      '<div class="t">' + esc(title) + "</div><div class=\"s\">" + esc(sub) + "</div>" + (action || "") + "</div>";
  }
  function errorState(msg, retry) {
    return emptyState("cloud_off", "Could not load this", msg || "",
      '<button class="pgl-btn" data-pgl="retry" data-r="' + attr(retry || route()) + '">Try again</button>');
  }
  function banner(kind, icon, text) {
    return '<div class="pgl-banner" data-t="' + kind + '">' + ic(icon) + "<div>" + text + "</div></div>";
  }

  // The provenance badge. THE rule of this module: an NMC requirement and an institutional target
  // must never look alike. Never hand-write one of these; always go through here.
  function prov(source, clause) {
    var c = C();
    var label = c ? c.sourceLabel(source) : String(source || "");
    return '<span class="pgl-prov" data-src="' + attr(source || "unspecified") + '">' + esc(label) + "</span>" +
      (clause ? ' <span class="pgl-clause">' + esc(clause) + "</span>" : "");
  }
  var VSTATE = {
    verified: ["task_alt", "Verified"], submitted: ["hourglass_top", "Awaiting verification"],
    returned: ["undo", "Returned"], draft: ["edit_note", "Draft"], queued: ["cloud_upload", "Waiting to submit"],
    failed: ["error", "Needs a fix"]
  };
  function vstate(s) {
    var v = VSTATE[s] || VSTATE.draft;
    return '<span class="pgl-vstate" data-s="' + attr(s) + '">' + ic(v[0]) + esc(v[1]) + "</span>";
  }

  /* ── loading the context ─────────────────────────────────────────────────── */
  function ensureContext() {
    var st = ST();
    if (!st) return Promise.reject(new Error("store_missing"));
    /* Cached, but keyed to nothing. If the device is now pointed at a DIFFERENT institution, the
     * cached answer describes the old one - the console then renders the previous college's name
     * and code, or falls back to the raw id. Invalidate when the org has moved under us. */
    if (state.ctx) {
      var want = ((st.context() || {}).orgId) || "";
      var have = state.ctx.orgId || "";
      /* Only a change BETWEEN two real orgs invalidates. Invalidating when the org is merely absent
       * was tried and is wrong: ensureContext() runs on every screen, and a context legitimately
       * fetched without an org (a viewer, or a resident not yet linked) would be thrown away and
       * refetched on each render, turning an ordinary unlinked state into a request loop and an
       * error screen. The explicit unlink paths (clear-inst, pick-inst) null state.ctx themselves. */
      if (!want || !have || want === have) return Promise.resolve(state.ctx);
      /* NARROW on purpose. This runs inside ensureContext, which every screen calls on every render
       * pass, so the full org reset here wipes state that is mid-load and the module never settles
       * (15 checks failed when it did). state.inst is included because screenInstitution prefers it
       * over ctx and would otherwise paint the previous college; the wider reset belongs on the
       * user-initiated switches, which is where resetOrgScopedState() is called. */
      state.ctx = null; state.dash = null; state.inst = {};
    }
    var demo = st.seedDemo(todayISO());
    if (demo) {   // smd_pglog_demo — LOCAL ONLY, never a server call. Every screen labels it.
      state.ctx = { role: "pg_resident", caps: [], resident: demo.resident, programme: demo.programme, rotations: [], demo: true };
      state.dash = demo;
      return loadPack().then(function () { return state.ctx; });
    }
    var c = st.context();
    return st.me(c.orgId).then(function (r) {
      state.ctx = r;
      // The human types SMD-XXXXXX; the store keys on the internal id. /me resolves and tells us
      // which, so this is where the two stop disagreeing.
      if (r.orgId && r.orgId !== c.orgId) st.setContext({ orgId: r.orgId });
      if (r.resident) st.setContext({ residentId: r.resident.id, programmeId: r.resident.programmeId, curriculumId: r.programme && r.programme.curriculumId });
      rememberContext(r);
      return loadPack().then(function () { return r; });
    }, function (e) {
      /* OFFLINE COLD START. /me cannot be reached, so without this an ENROLLED resident opening the
       * app on a ward with no signal was shown the set-up question, as if they had never linked.
       * The last good context (store.cachedContext(), or this screen's own copy on an older store)
       * lands them on their home with the stale banner and the quick log. Only for a network
       * failure: a refusal from the server is an answer, not an outage. */
      var cc = isTransient(e) && e.code !== "signin_required" && e.code !== "server_disabled" ? cachedContext() : null;
      if (cc && cc.resident) {
        state.ctx = Object.assign({}, cc, { cached: true });
        return loadPack().then(function () { return state.ctx; });
      }
      throw e;
    });
  }
  function ctxKey() { var st = ST(); return "smd_pglog_ctx_" + (st ? st.uid() : "anon"); }
  /* Only what the home screen needs to render offline: who, which programme, which org. No entries,
   * no clinical detail (the dashboard mirror is the store's, and is already account- and org-keyed). */
  function rememberContext(r) {
    var st = ST();
    if (!r || !r.resident || (st && st.cachedContext)) return;
    try {
      localStorage.setItem(ctxKey(), JSON.stringify({
        role: r.role, caps: r.caps, uid: r.uid, orgId: r.orgId, orgCode: r.orgCode, orgName: r.orgName,
        resident: r.resident, programme: r.programme, rotations: []
      }));
    } catch (e) {}
  }
  function cachedContext() {
    var st = ST();
    try {
      if (st && st.cachedContext) {
        var c = st.cachedContext();
        // The store returns { ctx, dashboard, at }; an older shape returned the context itself.
        return c ? (c.ctx ? c.ctx : c) : null;
      }
    } catch (e) {}
    try { return JSON.parse(localStorage.getItem(ctxKey()) || "null"); } catch (e) { return null; }
  }
  /* The institution's own targets. state.config was READ here and never written anywhere, and
   * store.config() had no callers, so every requirement shown was the raw pack default even where
   * the Academic Cell had configured otherwise - the configuration screen wrote to a server nobody
   * asked. Failure is not fatal: fall back to pack defaults rather than blocking the logbook. */
  /* Everything that describes ONE institution. Five call sites nulled ctx and dash and left the rest
   * behind, so after switching college the faculty queue, the department view, the certificate, the
   * progress bars and the requirement targets were still the PREVIOUS institution's until something
   * happened to reload them. One place, so a sixth caller cannot get it half right. */
  function resetOrgScopedState() {
    state.ctx = null; state.dash = null; state.inst = {};
    state.faculty = null; state.dept = null;
    state.cert = null; state.certErr = null; state.certVerifyUrl = "";
    state.checked = null; state.inbox = [];
    state.pack = null; state.config = null; state.requirements = null;
    state.progress = null; state.gaps = [];
    state.assessment = null; state.review = null;
  }

  function loadConfig() {
    var st = ST();
    var prog = state.ctx && state.ctx.programme;
    var pid = prog && prog.id;
    if (!pid || !st || !st.config) { state.config = null; return Promise.resolve(null); }
    if (state.config && state.config.programmeId === pid) return Promise.resolve(state.config);
    return st.config(pid).then(function (c) {
      state.config = c ? Object.assign({ programmeId: pid }, c) : null;
      return state.config;
    }, function () { state.config = null; return null; });
  }

  function loadPack() {
    var c = C(), st = ST();
    if (!c) return Promise.resolve(null);
    var prog = state.ctx && state.ctx.programme;
    var id = (prog && prog.curriculumId) || (st && st.context().curriculumId) || "generic-pg";
    return loadConfig().then(function () { return c.load(id); }).then(function (pack) {
      state.pack = pack;
      var overrides = (state.config && state.config.overrides) || {};
      state.requirements = c.resolve(pack, {
        degree: prog ? prog.degree : "", overrides: overrides,
        startDate: state.ctx && state.ctx.resident ? state.ctx.resident.startDate : ""
      });
      recompute();
      return pack;
    }, function () { state.pack = null; return null; });
  }
  // Progress is recomputed from the SAME pure functions the server uses, so a phone that is offline
  // and a server that is not never disagree about a number on a regulatory record.
  function recompute() {
    var m = M(); if (!m || !state.dash) return;
    var res = state.dash.resident || (state.ctx && state.ctx.resident) || {};
    var prog = state.dash.programme || (state.ctx && state.ctx.programme) || null;
    // `programme` lets progressFor prorate a whole-course target instead of demanding all of it on
    // day one (R1, finding C3).
    var ctx = { programmeStart: res.startDate, today: todayISO(), programme: prog };
    state.progress = m.progress(state.requirements, state.dash.entries || [], ctx);
    state.gaps = m.gaps(state.requirements, state.dash.entries || [], ctx);
    state.eligibility = m.examEligibility({
      programme: state.dash.programme || (state.ctx && state.ctx.programme),
      entries: state.dash.entries || [], rotations: state.dash.rotations || [],
      attendance: state.dash.attendance, requirementProgress: state.progress
    });
  }
  function loadDashboard(force) {
    var st = ST();
    if (state.ctx && state.ctx.demo) return Promise.resolve(state.dash);
    var res = state.ctx && state.ctx.resident;
    if (!res) return Promise.resolve(null);
    if (state.dash && !force) return Promise.resolve(state.dash);
    return st.dashboard(res.id).then(function (d) { state.dash = d; adoptOrphanDrafts(d); recompute(); return d; },
      function (e) {
        /* Offline: fall back to the last mirror rather than an empty screen, and SAY it is a mirror.
         * Pass the resident, so a mirror belonging to a DIFFERENT resident or institution is refused
         * rather than shown: this path catches every rejection, not just offline ones, so a 403 on a
         * newly switched institution used to resurface the previous college's logbook here. */
        var cached = st.cachedDashboard(res.id);
        if (cached) { state.dash = cached; state.dash.stale = true; recompute(); return cached; }
        /* Cold start with a cached context but no mirror: still the resident's home, not setup. */
        if (state.ctx && state.ctx.cached && isTransient(e)) {
          state.dash = { resident: res, programme: state.ctx.programme || {}, entries: [], rotations: [], months: [],
            summary: {}, weekly: {}, stale: true };
          recompute();
          return state.dash;
        }
        throw e;
      });
  }
  /* Work logged BEFORE the Academic Cell enrolled this resident was saved with no resident id, so
   * the first submit after linking was refused (not_found) and sat in "Waiting to submit" forever.
   * Stamp the now-known resident onto those drafts; nothing else about them changes. */
  function adoptOrphanDrafts(d) {
    var st = ST(), res = d && d.resident;
    if (!st || !res || !res.id) return;
    arr(st.drafts()).forEach(function (x) {
      if (x && !x.residentId && !x.__serverId) {
        try { st.saveDraft(Object.assign({}, x, { residentId: res.id, localId: x.id })); } catch (e) {}
      }
    });
  }
  function loadTemplates() {
    var c = C();
    if (state.templates || !c) return Promise.resolve(state.templates);
    return c.loadTemplates().then(function (t) { state.templates = t; return t; }, function () { return null; });
  }

  /* ── HOME · "My NMC Logbook" ─────────────────────────────────────────────── */
  function screenHome() {
    var m = M(), st = ST(), E = easy();
    var res = state.dash && state.dash.resident;
    /* A guide, HOD or Academic Cell has no resident record, so loadDashboard() returns null and
     * state.dash stays null forever. The "Faculty review" and "Department oversight" rows are built
     * BELOW this early return, which made every faculty screen unreachable: a professor holding
     * pglog.verify opened the module and was shown the trainee setup prompt, with no route to the
     * pending queue, assessments or certificate signing. Give them their own home instead. */
    if (!res && (canFaculty() || canDept())) return wrap(facultyHome());
    if (!res) return setupPrompt();
    var prog = state.dash.programme || {};
    var sum = state.dash.summary || {};
    var wk = state.dash.weekly || {};
    var months = arr(state.dash.months);
    var rotations = arr(state.dash.rotations);
    var current = rotations.filter(function (r) {
      return r.startDate && m.daysBetween(r.startDate, todayISO()) >= 0 && (!r.endDate || m.daysBetween(todayISO(), r.endDate) >= 0);
    })[0];
    var outstanding = outstandingActions();
    var queued = st ? st.queued() : [];
    var drafts = st ? st.drafts() : [];
    var h = [];

    if (state.ctx && state.ctx.demo) {
      h.push(banner("warn", "science",
        "<b>Demonstration data.</b> Every entry below is fabricated so the dashboards can be shown. " +
        "Nothing here reaches a server. Turn off <code>smd_pglog_demo</code> before using this for real training."));
    }
    if (state.dash.stale) {
      h.push(banner("info", "cloud_off", "Showing your last synced copy. You are offline. New entries are saved on this device and submitted when you reconnect."));
    }

    // Identity strip: the "who and where" the resident should never have to re-enter.
    var guideId = res.guide || "";
    h.push('<div class="pgl-card">' +
      '<div class="pgl-row-t" style="font-size:16px">' + esc(res.name || "My logbook") + "</div>" +
      '<div class="pgl-row-s">' +
        esc(prog.name || ((prog.degree || "") + " " + (prog.specialtyId || ""))) +
        " · Year " + esc(String(state.dash.trainingYear || res.trainingYear || 1)) +
        (state.dash.semester ? " · Semester " + esc(String(state.dash.semester)) : "") +
        (res.unit ? " · " + esc(res.unit) : "") +
      "</div>" +
      (E && guideId ? '<div class="pgl-row-s" style="margin-top:6px">' + ic("person") + " Guide: <b style=\"margin-left:3px\">" + esc(personName(guideId)) + "</b></div>" : "") +
      (current ? '<div class="pgl-row-s" style="margin-top:6px">' + ic("pin_drop") +
        " Current posting: <b style=\"margin-left:3px\">" + esc(current.name) + "</b>" +
        (current.endDate ? " · ends " + esc(current.endDate) : "") + "</div>" : "") +
      "</div>");

    /* Four numbers: what is done, what is waiting on someone else, what is waiting on YOU, and the
     * weekly cadence. "Needs you" used to add the queue to the drafts it is a subset of, so every
     * queued entry was counted twice. */
    var returnedN = arr(state.dash.entries).filter(function (e) { return e.status === "returned"; }).length;
    var needsYou = (sum.draft || 0) + returnedN + drafts.filter(function (d) { return !isQueued(d.id) || draftError(d.id); }).length;
    h.push('<div class="pgl-stats">' +
      stat(sum.verified || 0, "Verified") +
      stat(sum.submitted || 0, E ? "With your guide" : "Awaiting faculty") +
      stat(needsYou, "Needs you") +
      stat(wk.pct == null ? "-" : wk.pct + "%", E ? "Weeks logged" : "Weekly cadence") +
      "</div>");

    // The weekly strip: PGMER-2023 5.2(vi) made visible. One cell per ISO week.
    if (wk.weeks) {
      h.push('<div class="pgl-card tight">' +
        '<div class="pgl-row-s" style="justify-content:space-between">' +
          "<span><b>" + esc(String(wk.logged)) + "</b> of " + esc(String(wk.weeks)) + " weeks logged</span>" +
          (E ? "" : prov("nmc_regulation", "5.2(vi)")) + "</div>" +
        weekStrip(wk) +
        (E
          ? '<div class="hint" style="font-size:12px;color:var(--pgl-muted);margin-top:6px">Add at least one entry this week. Any entry counts.</div>' +
            whyBox("The NMC regulation says the e-logbook “needs to be updated on weekly basis”. A week counts once anything is logged in it. " +
              prov("nmc_regulation", "5.2(vi)"))
          : '<div class="hint" style="font-size:11.5px;color:var(--pgl-faint);margin-top:6px">' +
            "The e-logbook “needs to be updated on weekly basis”. A week counts once anything is logged in it." +
            "</div>") +
        "</div>");
    }

    if (outstanding.length) {
      h.push('<div class="pgl-sec-title"><span>' + (E ? "Needs you" : "Outstanding") + "</span><span>" + outstanding.length + "</span></div>");
      outstanding.slice(0, 6).forEach(function (o) { h.push(actionRow(o)); });
    }

    var overdueMonths = months.filter(function (x) { return x.overdue; });
    if (E) {
      /* The monthly authentication is the GUIDE's act, not the resident's. Listing it under the
       * resident's own to-do list told them they were failing at something they cannot do. */
      var waitingN = sum.submitted || 0;
      if (overdueMonths.length || waitingN) {
        h.push('<div class="pgl-sec-title"><span>Waiting on your guide</span><span>' + (overdueMonths.length + (waitingN ? 1 : 0)) + "</span></div>");
        if (waitingN) {
          h.push('<div class="pgl-row static pgl-waiting"><span class="pgl-row-ic">' + ic("hourglass_top") + "</span>" +
            '<span class="pgl-row-main"><span class="pgl-row-t">' + waitingN + " entr" + (waitingN === 1 ? "y" : "ies") + " to verify</span>" +
            '<span class="pgl-row-s">' + esc(guideId ? personName(guideId) + " has them." : "Your guide has them.") + " Nothing for you to do.</span></span></div>");
        }
        overdueMonths.forEach(function (x) {
          h.push('<div class="pgl-row static pgl-waiting"><span class="pgl-row-ic">' + ic("event_available") + "</span>" +
            '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(monthLabel(x.period)) + ": monthly sign-off</span>" +
            '<span class="pgl-row-s">Your guide authenticates each month. Nothing for you to do.</span></span></div>');
        });
        h.push(whyBox("Your guide checks and authenticates the logbook every month. " + prov("nmc_regulation", "5.2(vii)")));
      }
    } else if (overdueMonths.length) {
      h.push(banner("warn", "gavel",
        "<b>" + overdueMonths.length + " month(s)</b> without your guide's authentication (" +
        esc(overdueMonths.map(function (x) { return x.period; }).join(", ")) +
        "). " + prov("nmc_regulation", "5.2(vii)")));
    }

    // Progress by category: only requirements with a real target get a bar.
    var withTarget = state.progress.filter(function (p) { return p.target != null; });
    h.push('<div class="pgl-sec-title"><span>Training progress</span>' +
      '<button class="pgl-chip" data-pgl="go" data-r="progress" style="min-height:28px;padding:4px 10px;font-size:12px">All</button></div>');
    if (!state.requirements.length) {
      h.push(banner("info", "info", E
        ? "No specialty curriculum is loaded yet, so only the national PG requirements are shown. Your department can add more."
        : "No curriculum pack is loaded for this specialty, so only the PGMER-2023 requirements apply. The Academic Cell can add specialty requirements, which will show as institutional policy."));
    }
    (withTarget.length ? withTarget : state.progress).slice(0, 5).forEach(function (p) { h.push(progressRow(p, E)); });

    h.push('<div class="pgl-sec-title"><span>Recent activity</span>' +
      '<button class="pgl-chip" data-pgl="go" data-r="entries" style="min-height:28px;padding:4px 10px;font-size:12px">All entries</button></div>');
    var recent = arr(state.dash.entries).slice(0, 6);
    if (!recent.length && !drafts.length) {
      h.push(emptyState("history_edu", "Nothing logged yet",
        "Log the first thing you did today. It takes three taps.",
        '<button class="pgl-btn" data-pgl="go" data-r="' + (E ? "quick" : "add") + '">' + (E ? "Log it now" : "Add activity") + "</button>"));
    } else {
      drafts.slice(0, 3).forEach(function (d) { h.push(entryRow(d, true)); });
      recent.forEach(function (e) { h.push(entryRow(e)); });
    }

    h.push('<div class="pgl-sec-title"><span>Sections</span></div>');
    h.push(navRow("rotations", "route", "Rotations and postings", rotations.length + " recorded"));
    h.push(navRow("research", "science", "Research and thesis", researchSubtitle()));
    if (flag("smd_pglog_attendance")) h.push(navRow("attendance", "event_available", "Attendance", attendanceSubtitle()));
    h.push(navRow("progress", "insights", "Progress and gaps", state.gaps.length ? state.gaps.length + " gap(s)" : "On track"));
    h.push(navRow("analytics", "query_stats", "My numbers", "Caseload, complications, independence year on year"));
    if (flag("smd_pglog_reports")) h.push(navRow("reports", "description", "Reports and portfolio", "12 documents · PDF and CSV"));
    if (flag("smd_pglog_certify")) h.push(navRow("certify", "verified_user", "Certification and official PDF", certNavSubtitle()));
    if (canFaculty()) h.push(navRow("faculty", "how_to_reg", "Faculty review", "Verify, assess, authenticate"));
    if (canDept()) h.push(navRow("dept", "corporate_fare", "Department oversight", "Progress across residents"));
    h.push(navRow("check", "qr_code_scanner", "Verify a signed record", "Scan or type a verification code"));
    if (BK() && BK().available()) h.push(navRow("backup", "cloud_sync", "Backup to Google Drive", BK().describe()));

    h.push('<div class="pgl-banner" data-t="ai" style="margin-top:18px">' + ic("policy") +
      "<div>Requirements shown here are traced to their NMC source. This app does not certify " +
      "compliance and does not determine examination eligibility: your University and institution do.</div></div>");

    var bar = '<div class="pgl-actionbar">' +
      '<button class="pgl-btn" data-pgl="go" data-r="quick">' + ic("bolt") + "Log it now</button>" +
      '<button class="pgl-btn ghost" data-pgl="go" data-r="add">' + ic("add") + "Full form</button>" +
      (state.inbox.length ? '<button class="pgl-btn ghost" data-pgl="go" data-r="inbox">' + ic("notifications") + " " + state.inbox.length + "</button>" : "") +
      "</div>";
    return wrap(h.join("")) + bar;
  }

  function stat(v, label) { return '<div class="pgl-stat"><b>' + esc(String(v)) + "</b><span>" + esc(label) + "</span></div>"; }
  function weekStrip(wk) {
    var missed = {}; arr(wk.missed).forEach(function (w) { missed[w] = 1; });
    /* Place each gap on ITS OWN week. This used to build the map above and then never read it,
     * marking the first N cells instead - so a resident who logged steadily for a year and then
     * stopped saw the gap drawn at the START of their training, and vice versa. */
    var order = arr(wk.order);
    var cells = [];
    if (order.length) {
      // Show the most RECENT 80 weeks when there are more; the tail is what a resident acts on.
      var shown = order.length > 80 ? order.slice(order.length - 80) : order;
      shown.forEach(function (w) { cells.push(missed[w] ? '<i data-l="0"></i>' : '<i data-l="1"></i>'); });
    } else {
      // A payload cached before the model returned `order`: we know how many weeks, not which were
      // missed. Draw them neutral rather than inventing positions; the label still carries the count.
      for (var i = 0; i < Math.min(wk.weeks || 0, 80); i++) cells.push('<i data-l="1"></i>');
    }
    return '<div class="pgl-weeks" aria-label="' + attr(wk.logged + " of " + wk.weeks + " weeks logged") + '">' + cells.join("") + "</div>";
  }
  function navRow(r, icon, title, sub) {
    return '<button class="pgl-row" data-pgl="go" data-r="' + attr(r) + '">' +
      '<span class="pgl-row-ic">' + ic(icon) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(title) + "</span>" +
      '<span class="pgl-row-s">' + esc(sub) + "</span></span>" + ic("chevron_right") + "</button>";
  }
  function actionRow(o) {
    return '<button class="pgl-row" data-pgl="' + attr(o.act || "go") + '" data-r="' + attr(o.route || "") + '" data-id="' + attr(o.id || "") + '"' +
      (o.fix ? ' data-fix="1"' : "") + ">" +
      '<span class="pgl-row-ic">' + ic(o.icon) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(o.title) + "</span>" +
      '<span class="pgl-row-s">' + esc(o.sub) + (o.source && !easy() ? " " + prov(o.source, o.clause) : "") + "</span></span>" +
      (o.fix ? '<span class="pgl-fixtag">Fix</span>' : ic("chevron_right")) + "</button>";
  }

  function outstandingActions() {
    var m = M(), st = ST(), out = [], E = easy();
    var d = state.dash || {};
    var R = REP();
    arr(d.entries).forEach(function (e) {
      if (e.status === "returned") out.push({ act: "go", route: "entry/" + e.id, icon: "undo",
        title: "Returned: " + (R ? R.activityLabel(e) : e.title),
        sub: e.returnReason || "Correct and resubmit" });
    });
    /* A draft the SERVER refused is not "waiting to submit": nothing will change until the resident
     * fixes it, so it gets its own row with the server's own reason and a Fix action. */
    var failed = failedDrafts(), failedIds = {};
    failed.forEach(function (f) {
      failedIds[f.id] = 1;
      out.push({ act: "go", route: "entry/" + f.id, icon: "error", fix: true,
        title: "Fix: " + (R ? R.activityLabel(f) : (f.title || f.kind)),
        sub: (f.lastError && f.lastError.message) || "The server did not accept this entry." });
    });
    // Easy mode: an unfinished local draft needs the resident too, so it is listed where it is counted.
    if (E && st) {
      st.drafts().forEach(function (dr) {
        if (failedIds[dr.id] || isQueued(dr.id)) return;
        out.push({ act: "go", route: "entry/" + dr.id, icon: "edit_note",
          title: "Draft: " + (R ? R.activityLabel(dr) : (dr.title || dr.kind)), sub: "Finish it and submit" });
      });
    }
    (st ? st.queued() : []).forEach(function (e) {
      if (failedIds[e.id]) return;
      out.push({ act: "go", route: "entry/" + e.id, icon: "cloud_upload", title: "Waiting to submit",
        sub: E ? ((R ? R.activityLabel(e) : "") + " · sends when you are online") : e.occurredAt });
    });
    var ai = AI();
    if (ai) {
      ai.reminders({
        requirements: state.requirements, requirementProgress: state.progress,
        rotations: arr(d.rotations), months: arr(d.months), today: todayISO(),
        rotationEndNoticeDays: fint("smd_pglog_verify_sla_days")
      }).filter(function (r) {
        // The guide's monthly authentication is listed under "Waiting on your guide" in easy mode.
        return !(E && r.kind === "attestation_overdue");
      }).slice(0, 5).forEach(function (r) {
        out.push({ act: "go", route: r.kind === "rotation_ending" ? "rotations" : "progress",
          icon: r.kind === "overdue" ? "priority_high" : r.kind === "attestation_overdue" ? "gavel" : "schedule",
          title: r.kind === "attestation_overdue" ? "Guide authentication missing for " + monthLabel(r.dueAt) : r.label,
          sub: r.kind === "overdue" ? r.days + " days overdue" : (r.days != null ? "due in " + r.days + " days" : ""),
          source: r.source, clause: r.clause });
      });
    }
    return out;
  }
  function researchSubtitle() {
    var rows = arr(state.dash && state.dash.entries).filter(function (e) { return e.kind === "research"; });
    var accepted = rows.some(function (e) { return e.milestone === "accepted"; });
    var last = rows.filter(function (e) { return e.subtype === "thesis_milestone"; })
      .sort(function (a, b) { return String(b.occurredAt).localeCompare(String(a.occurredAt)); })[0];
    if (accepted) return "Thesis accepted";
    return last ? (REP() ? REP().milestoneLabel(last.milestone) : last.milestone) : "No milestone recorded";
  }
  function attendanceSubtitle() {
    var a = state.dash && state.dash.attendance;
    if (!a || a.pctOfRecorded == null) return "Nothing recorded";
    return a.attendedDays + " days · " + (a.pctOfWorkingDays == null ? "not yet calculated" : a.pctOfWorkingDays + "% of working days");
  }

  function progressRow(p, noProv) {
    var pct = p.pct == null ? null : Math.max(0, Math.min(100, p.pct));
    var count = p.target == null
      ? '<span class="pgl-count">' + p.done + " <small>logged</small></span>"
      : '<span class="pgl-count">' + p.done + " <small>/ " + p.target + (p.per && p.per !== "course" ? " per " + p.per : "") + "</small></span>";
    return '<button class="pgl-row" data-pgl="req" data-id="' + attr(p.requirementId) + '">' +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(p.label) + "</span>" +
      '<span class="pgl-row-s">' + count +
        (p.pending ? " · " + p.pending + " awaiting verification" : "") +
        (noProv ? "" : " " + prov(p.source, p.clause)) + "</span>" +
      // No bar for an unspecified requirement: a bar implies a denominator that does not exist.
      (pct == null ? "" : '<span class="pgl-bar" data-state="' + attr(p.state) + '"><i style="width:' + pct + '%"></i></span>') +
      "</span></button>";
  }

  function entryRow(e, isDraft) {
    var r = REP();
    var status = isDraft ? (draftError(e.id) ? "failed" : isQueued(e.id) ? "queued" : "draft") : e.status;
    return '<button class="pgl-row" data-pgl="go" data-r="entry/' + attr(e.id) + '">' +
      '<span class="pgl-row-ic">' + ic(kindIcon(e)) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(r ? r.activityLabel(e) : (e.title || e.kind)) + "</span>" +
      '<span class="pgl-row-s">' + esc(e.occurredAt) + " · " + esc(kindText(e)) +
        (e.role ? " · " + esc(roleText(e)) : "") + " " + vstate(status) + "</span></span>" +
      "</button>";
  }
  function isQueued(id) { var st = ST(); return st ? st.queued().some(function (q) { return q.id === id; }) : false; }
  var KIND_ICON = { clinical: "stethoscope", procedure: "content_cut", academic: "school",
    research: "science", certification: "workspace_premium", attendance: "event_available", reflection: "self_improvement" };
  function kindIcon(e) {
    if (e.kind === "clinical") return e.setting === "emergency" ? "emergency" : e.setting === "ipd" ? "bed" : "stethoscope";
    return KIND_ICON[e.kind] || "note";
  }

  /* The QR that makes a signature checkable by someone who does not use this app. Rendered from
   * pglog-qr.js — no library, no network, so it prints and works on a ward. */
  function qrBlock(code, caption, url) {
    if (!code) return "";
    // The server tells us where to point (PGLOG_VERIFY_BASE lets a self-hosted deployment print its
    // own domain); the constant is only a fallback for a record whose URL we were not given.
    url = url || ("https://stewardmd.in/pglog/v/" + code);
    var svg = "";
    try { svg = window.SMD_PGLOG_QR ? SMD_PGLOG_QR.toSvg(url, { scale: 4, label: "Verification code " + code }) : ""; }
    catch (e) { svg = ""; }
    return '<div class="pgl-qr">' + (svg || "") +
      '<div class="pgl-qr-meta"><div class="pgl-qr-code">' + esc(code) + "</div>" +
      '<div class="pgl-qr-cap">' + esc(caption || "Scan to verify this signature") + "</div>" +
      '<div class="pgl-qr-url">' + esc(url) + "</div></div></div>";
  }

  // The banner a faculty member sees when they cannot sign, and WHY. Never a disabled button with
  // no explanation — the commonest reason is simply that they have not verified their registration.
  function signerBanner() {
    var sg = state.ctx && state.ctx.signer;
    if (!sg || sg.ok) return "";
    return banner("warn", "verified_user",
      "<b>You cannot sign logbook records yet.</b> " + esc(sg.message || "") +
      " A PG logbook entry is a document a University relies on, so it has to carry a registered " +
      "practitioner's number. " +
      '<button class="pgl-chip" data-pgl="go-verify" style="margin-top:8px">Verify my registration</button>');
  }

  /* Home for someone whose role in this institution is to REVIEW rather than to log: a guide, a head
   * of department, or the Academic Cell. Built from the same caps the nav rows use, so it can never
   * offer a screen the server would refuse. */
  function facultyHome() {
    var cx = state.ctx || {};
    var h = [];
    h.push('<div class="pgl-card"><h3>' + esc(cx.orgName || "Your institution") + "</h3>" +
      '<p style="font-size:13.5px;line-height:1.6;color:var(--pgl-muted)">' +
      "You are signed in for review duties. Your own trainee logbook is not set up, and it does not " +
      "need to be." + "</p></div>");
    if (canFaculty()) h.push(navRow("faculty", "how_to_reg", "Faculty review", "Verify, assess, authenticate"));
    if (canDept()) h.push(navRow("dept", "corporate_fare", "Department oversight", "Progress across residents"));
    if (arr(cx.caps).indexOf("pglog.configure") > -1) {
      h.push(navRow("institution", "apartment", "Institution", "Programmes, faculty, residents and requests to join"));
    }
    h.push(navRow("check", "qr_code_scanner", "Verify a signed record", "Scan or type a verification code"));
    h.push(easy()
      ? '<div class="pgl-banner" data-t="ai" style="margin-top:18px">' + ic("policy") +
        "<div>Signing a trainee's record is a personal act tied to your council registration. Sign only work you supervised." +
        whyBox("PGMER-2023 9.2(c) puts a penalty on the named faculty member who certifies a false record.") + "</div></div>"
      : '<div class="pgl-banner" data-t="ai" style="margin-top:18px">' + ic("policy") +
        "<div>Signing a trainee's record is a personal act tied to your council registration. " +
        "PGMER-2023 9.2(c) puts a penalty on certifying work you did not supervise.</div></div>");
    return h.join("");
  }

  /* The drafts saved on this device before the resident is linked, so "I logged it" is visible. */
  function localDraftsBlock() {
    var st = ST(), drafts = st ? st.drafts() : [];
    if (!drafts.length) return "";
    return '<div class="pgl-sec-title"><span>Saved on this device</span><span>' + drafts.length + "</span></div>" +
      drafts.slice(0, 8).map(function (d) { return entryRow(d, true); }).join("") +
      '<p class="hint" style="font-size:12px;color:var(--pgl-muted)">These go to your guide once your department links your logbook.</p>';
  }
  function logNowBar() {
    return '<div class="pgl-actionbar">' +
      '<button class="pgl-btn" data-pgl="go" data-r="quick">' + ic("bolt") + "Log it now</button>" +
      '<button class="pgl-btn ghost" data-pgl="go" data-r="add">' + ic("add") + "Full form</button></div>";
  }

  function setupPrompt() {
    var cx = state.ctx || {};
    var E = easy();
    if (!flag("smd_pglog_server")) {
      return wrap(emptyState("cloud_off", "Server sync is off",
        "The logbook is running on-device only. Drafts are saved here but cannot be submitted for verification.",
        '<button class="pgl-btn" data-pgl="go" data-r="add">Log something anyway</button>') + (E ? localDraftsBlock() : ""));
    }
    if (E && cx.stub && (cx.reason === "signin_required" || !cx.reason)) {
      /* Signed out. The role question cannot be answered usefully without an account (every next
       * step needs one), so ask for the one thing that unblocks everything. */
      return wrap(
        '<div class="pgl-state"><div class="ic">' + ic("login") + "</div>" +
        '<div class="t">Sign in to use your logbook</div>' +
        '<div class="s">Your logbook belongs to your StewardMD account, so your guide can verify it and it is never lost with this phone.</div>' +
        '<button class="pgl-btn" data-pgl="signin">' + ic("login") + "Sign in</button></div>" +
        '<div style="text-align:center;margin-top:4px"><button class="pgl-btn ghost" data-pgl="go" data-r="quick">' + ic("bolt") + "Log something on this device first</button></div>" +
        localDraftsBlock());
    }
    if (E && cx.stub && (cx.reason === "offline" || cx.reason === "network")) {
      return wrap(emptyState("cloud_off", "You are offline",
        "Your logbook opens once you are back online. You can still log today's work on this device.", "") + localDraftsBlock()) + logNowBar();
    }
    /* Found the institution but not enrolled yet: the request to join, and then its status. This
     * used to loop straight back to the three-way question, so a resident who had done everything
     * right was asked again who they were. */
    var jr = E ? (cx.joinRequest || state.joinLocal || null) : null;
    if (E && (jr || state.joinBusy || state.joinErr) && !(cx.stub && (cx.reason === "signin_required" || cx.reason === "offline"))) {
      var org = (jr && jr.orgName) || cx.orgName || "your institution";
      var status = (jr && jr.status) || (state.joinBusy ? "sending" : "error");
      var card;
      if (status === "sending") {
        card = emptyState("send", "Found " + org, "Sending your request to join…");
      } else if (status === "rejected") {
        card = emptyState("block", "Your request was not approved",
          (jr.reason ? "Reason: " + jr.reason + ". " : "") + "Speak to your department or Academic Cell, then send it again.",
          '<button class="pgl-btn" data-pgl="join-send">Send the request again</button>');
      } else if (status === "error") {
        card = emptyState("error", "Found " + org, (state.joinErr || "The request to join could not be sent.") + " ",
          '<button class="pgl-btn" data-pgl="join-send">Try again</button>');
      } else {
        card = '<div class="pgl-state pgl-join"><div class="ic">' + ic("mark_email_read") + "</div>" +
          '<div class="t">Found ' + esc(org) + ". Your request to join has been sent</div>" +
          '<div class="s">Status: <b>' + esc(status === "approved" ? "approved" : "waiting for your department") + "</b>. " +
          "The Academic Cell adds your programme, guide and start date. You do not need to do anything else.</div>" +
          '<button class="pgl-btn ghost" data-pgl="join-refresh">' + ic("refresh") + "Check again</button></div>";
      }
      return wrap(card + localDraftsBlock()) + logNowBar();
    }
    /* ASK, do not assume (2026-08-27). This screen used to be written entirely in resident voice
     * ("your training record", "your guide's monthly authentication"), so a professor opening the
     * module was told they were an un-enrolled trainee.
     *
     * The ROLE itself is still never self-declared - it comes from the institution's membership
     * record, server-side, because someone who could call themselves faculty could sign a trainee's
     * record and PGMER-2023 9.2(c) puts a monetary penalty on exactly that. What the answer chooses
     * is which set of INSTRUCTIONS to show, nothing more. */
    var notYet = E && cx.stub && cx.reason === "forbidden" && ((ST() && ST().context()) || {}).orgId
      ? banner("info", "hourglass_top", "This account is not part of <b>" + esc(((ST() && ST().context()) || {}).orgId) +
          "</b> yet. A resident can send a request to join below; faculty are added by the Academic Cell with the email they sign in with.")
      : "";
    return '<div class="pgl-wrap">' + notYet +
      '<div class="pgl-state"><div class="ic">' + ic("school") + "</div>" +
      '<div class="t">Set up your logbook</div>' +
      '<div class="s">StewardMD does not know your role in this programme yet. Which of these are you?</div></div>' +
      '<div class="pgl-card" style="padding:0;overflow:hidden">' +
        navRow("setup", "school", "I am a PG resident", "I am in training and will log my work here.") +
        navRow("setup-faculty", "draw", "I am faculty or HOD", "I verify, assess and sign residents' records.") +
        navRow("institution", "apartment", "I am setting up our institution", "Academic Cell: create the programme and enrol people.") +
      "</div>" +
      (E ? localDraftsBlock() :
        '<div style="text-align:center;margin-top:14px">' +
        '<button class="pgl-btn ghost" data-pgl="go" data-r="add">Just log something on this device</button></div>') +
      "</div>" + (E ? logNowBar() : "");
  }


  function screenSetup() {
    var st = ST(), c = st ? st.context() : {};
    if (easy()) {
      return wrap(
        '<div class="pgl-card"><h3>Link your logbook</h3>' +
        "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
        "Enter your college's StewardMD code. We send your department a request to join; they add your " +
        "programme, guide and start date. Anything you log meanwhile stays on this device and is sent later." +
        "</p></div>" +
        '<div class="pgl-field"><label for="pglOrg">College code (SMD-XXXXXX)</label>' +
        '<input type="text" id="pglOrg" value="' + attr(c.orgId || "") + '" placeholder="SMD-XXXXXX" autocapitalize="characters">' +
        (state.setupErr ? '<div class="pgl-err">' + esc(state.setupErr) + "</div>" : "") +
        '<div class="hint">Your department or Academic Cell has it.</div></div>' +
        '<button class="pgl-btn wide" data-pgl="save-org" data-join="1">Find my college</button>' +
        whyBox("PGMER-2023 5.2(iv) asks every institution running a PG programme to set up an Academic Cell; that cell enrols you. " +
          "This module is <b>structured to</b> PGMER-2023 5.2(vi)-(vii). It does not claim to be certified by the NMC, and whether a " +
          "logbook is acceptable to your University is your institution's decision, not this app's."));
    }
    return wrap(
      '<div class="pgl-card"><h3>Linking your logbook</h3>' +
      "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
      "PGMER-2023 5.2(iv) requires every institution running a PG programme to set up an Academic Cell. " +
      "That cell creates the programme in StewardMD and enrols you into it with your training dates and your guide. " +
      "Until then, anything you log stays on this device." +
      "</p></div>" +
      '<div class="pgl-field"><label for="pglOrg">Institution code (SMD-XXXXXX)</label>' +
      '<input type="text" id="pglOrg" value="' + attr(c.orgId || "") + '" placeholder="SMD-XXXXXX" autocapitalize="characters">' +
      '<div class="hint">Ask your department for the StewardMD institution code. Entering it here only tells this device where to look, it does not enrol you.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="save-org">Save and check</button>' +
      banner("info", "policy",
        "This module is <b>structured to</b> PGMER-2023 5.2(vi)-(vii). It does not claim to be certified by the NMC, " +
        "and whether a logbook is acceptable to your University is your institution's decision, not this app's.")
    );
  }

  /* ── ADD · the three-tap path ────────────────────────────────────────────── */
  /* Faculty and HODs are enrolled the same way residents are - by the Academic Cell - but what they
   * need to hear is different, and one thing is specific to them: signing needs a verified medical
   * registration, so a faculty member added to the org who never verified still cannot sign. Saying
   * that here is cheaper than letting them discover it at the moment they try to authenticate a
   * month's entries. */
  function screenSetupFaculty() {
    var st = ST(), c = st ? st.context() : {};
    return wrap(
      '<div class="pgl-card"><h3>Faculty and HOD access</h3>' +
      "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
      "Your institution's Academic Cell adds you to the programme as <b>faculty</b> or <b>HOD</b>. " +
      "Once added, the residents assigned to you appear here for verification, assessment and the " +
      "monthly authentication PGMER-2023 5.2(vii) requires." +
      "</p></div>" +
      '<div class="pgl-field"><label for="pglOrg">Institution code (SMD-XXXXXX)</label>' +
      '<input type="text" id="pglOrg" value="' + attr(c.orgId || "") + '" placeholder="SMD-XXXXXX" autocapitalize="characters">' +
      '<div class="hint">Ask your Academic Cell for the code. Entering it here only tells this device where to look; it does not grant you access.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="save-org">Save and check</button>' +
      banner("info", "verified_user",
        "<b>Signing needs a verified registration.</b> A logbook entry is a document a University relies on, " +
        "so it has to carry a registered practitioner's number. Verify yours before your first monthly " +
        "authentication." +
        '<button class="pgl-chip" data-pgl="go-verify" style="margin-top:8px">Verify my registration</button>')
    );
  }

  /* The Academic Cell console. PGMER-2023 5.2(iv) makes this cell responsible for the programme, and
   * every other screen in this module assumed enrolment had already happened - but nothing anywhere
   * could perform it. No create-institution, no create-programme, no enrol. So every user sat on
   * "your training record is not linked yet" forever, whatever their role. This is that missing step,
   * kept to the three actions that unblock a real programme. */
  function screenInstitution() {
    var st = ST(), c = st ? st.context() : {}, I = state.inst || {};
    var orgId = c.orgId || "";
    if (!orgId) {
      var mine = I.mine || [];
      // A failed lookup is not an empty list. Saying "institutions are set up by StewardMD" to an
      // administrator whose own colleges just failed to load sends them to the wrong place entirely.
      if (I.mineErr) {
        return wrap(
          banner("warn", "error", esc(instErr(I.mineErr, "Could not load your institutions."))) +
          '<button class="pgl-btn wide" data-pgl="retry" data-r="institution">Try again</button>');
      }
      var pick = mine.length
        ? '<div class="pgl-card"><h3>Your institutions</h3>' +
          '<p style="font-size:13px;color:var(--pgl-muted)">This device is not pointed at one yet. Pick it rather than creating a second.</p>' +
          mine.map(function (o) {
            // Every org this account owns is listed here, clinics included - that is how an OPD
            // clinic came to be adopted as "your institution". Name the kind on the row.
            var clinic = o.kind !== "institution";
            return '<button class="pgl-row" data-pgl="pick-inst" data-id="' + attr(o.id) + '">' +
              '<span class="pgl-row-ic">' + ic(clinic ? "local_hospital" : "apartment") + "</span>" +
              '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(o.name || o.id) + "</span>" +
              '<span class="pgl-row-s">' + esc((o.code || "") + (clinic ? " · OPD clinic, not a PG institution" : " · PG institution")) +
              "</span></span>" + ic("chevron_right") + "</button>";
          }).join("") + "</div>"
        : "";
      /* NO self-serve create. A PG institution is provisioned for a college that licenses StewardMD,
       * through the owner-gated /api/tenants route which also names its administrator. The server
       * enforces that; showing a "Create institution" button here would only ever 403, and a
       * self-appointed Academic Cell running a recognised programme is the thing being prevented. */
      return wrap(
        pick +
        '<div class="pgl-card"><h3>Institutions are set up by StewardMD</h3>' +
        "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
        "A PG institution is provisioned for the college that licenses StewardMD. We create it, name its " +
        "administrator, and issue the <b>institution code</b> - then that administrator adds programmes, " +
        "faculty and residents from this console." +
        "</p>" +
        "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted);margin-top:10px\">" +
        "If your college has already been set up, you were sent an institution code." +
        "</p></div>" +
        '<div class="pgl-field"><div class="hint">Have a code? ' +
        '<button class="pgl-chip" data-pgl="go" data-r="setup-faculty">Enter it here</button></div></div>' +
        (I.msg ? banner(I.err ? "warn" : "info", I.err ? "error" : "check_circle", esc(I.msg)) : "")
      );
    }
    /* If /me failed there is no code, no name, and no roster - the previous build still rendered the
     * full card and presented the raw orgId under "Share this with your residents", which is both
     * wrong and unactionable. Say what broke and offer the way out. */
    if (I.ctxErr) {
      return wrap(
        '<div class="pgl-card"><h3>Cannot open this institution</h3>' +
        '<p style="font-size:13.5px;line-height:1.6;color:var(--pgl-muted)">' +
          esc(instErr(I.ctxErr, "This device is pointed at an institution the server did not return.")) +
        "</p>" +
        '<p style="font-size:12px;line-height:1.5;color:var(--pgl-muted);margin-top:10px">' +
          (I.ctxErr.code === "signin_required"
            ? "Your institution is on the server, not on this device. Sign in and reopen this screen."
            : "Institution ID stored on this device") + "</p>" +
        '<div style="font:600 12px/1.45 var(--mono,ui-monospace,monospace);color:var(--pgl-muted);word-break:break-all;user-select:all">' +
          esc(orgId) + "</div></div>" +
        // A signed-out user does not need a different institution, they need to sign in. Offering
        // the picker there sends them round a loop that cannot succeed.
        (I.ctxErr.code === "signin_required" ? ""
          : '<button class="pgl-btn wide" data-pgl="clear-inst">Choose a different institution</button>')
      );
    }
    var kind = (state.ctx && state.ctx.orgKind) || "";
    var clinicWarn = kind && kind !== "institution"
      ? banner("warn", "error",
          "This is an OPD clinic, not a PG institution. Residents enrolled here will not be on a recognised " +
          "programme. Create your medical college instead.") +
        '<button class="pgl-btn wide" data-pgl="clear-inst">Choose or create the right institution</button>'
      : "";
    var progs = I.programmes || [];
    var specs = I.specialties || [];
    var opts = progs.map(function (pr) {
      return '<option value="' + attr(pr.id) + '">' + esc((pr.name || pr.specialtyId || pr.id) + " · " + (pr.degree || "")) + "</option>";
    }).join("");
    var specOpts = specs.map(function (sp) {
      return '<option value="' + attr(sp.id) + '" data-deg="' + attr(sp.degree || "MD") + '">' +
        esc(sp.name + " (" + (sp.degree || "") + ")") + (sp.hasSpecialtyPack ? "" : " · generic pack") + "</option>";
    }).join("");
    return wrap(
      clinicWarn +
      '<div class="pgl-card"><h3>' + esc(I.orgName || (state.ctx && state.ctx.orgName) || "Your institution") + "</h3>" +
      '<p style="font-size:13.5px;line-height:1.6;color:var(--pgl-muted)">' +
        ((I.orgCode || (state.ctx && state.ctx.orgCode)) ? "Institution code" : "Institution ID (no short code yet)") + "</p>" +
      /* break-all + a size that fits: the fallback value is a 32-char org id and it ran straight off
       * the edge of the card. A code a human has to read out to a resident must never be clipped. */
      '<div style="font:800 19px/1.3 var(--sans);letter-spacing:.04em;color:var(--pgl-accent,#0e6e63);word-break:break-all;user-select:all">' +
        esc(I.orgCode || (state.ctx && state.ctx.orgCode) || orgId) + "</div>" +
      '<p style="font-size:12.5px;line-height:1.55;color:var(--pgl-muted);margin-top:8px">' +
      /* Only invite sharing when there is something SHAREABLE. Telling the owner to hand a raw
       * document id to their residents is how it got typed back into the setup field - and the
       * setup field then upper-cased it, which is what broke every call. */
      ((I.orgCode || (state.ctx && state.ctx.orgCode))
        ? "Share this with your residents and faculty. They enter it under Set up."
        : "This is an internal ID, not a shareable code. Reopen this screen once you are online to mint the institution code.") +
      "</p></div>" +

      '<div class="pgl-card"><h3>PG programmes</h3>' +
      (progs.length
        ? progs.map(function (pr) {
            /* Remove is offered for every programme; the SERVER decides whether it is allowed, and
             * refuses with 409 while anyone is enrolled. Hiding the control from a count this screen
             * happens to hold would just be a second, staler copy of that rule. */
            return '<div class="pgl-row static"><span class="pgl-row-ic">' + ic("school") + "</span>" +
              '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(pr.name || pr.specialtyId || pr.id) + "</span>" +
              '<span class="pgl-row-s">' + esc((pr.degree || "") + " · " + (pr.durationMonths || 36) + " months") + "</span></span>" +
              '<button class="pgl-chip" data-pgl="del-prog" data-id="' + attr(pr.id) + '" data-n="' +
              attr(pr.name || pr.specialtyId || pr.id) + '"' + (state.progBusy === pr.id ? " disabled" : "") + ">" +
              (state.progBusy === pr.id ? "Removing…" : "Remove") + "</button></div>";
          }).join("")
        : I.progErr
          // "None yet" and "we could not ask" are different answers, and only one of them means
          // it is safe to add a programme.
          ? banner("warn", "error", esc(instErr(I.progErr, "Could not load the programmes for this institution.")))
          : '<p style="font-size:13px;color:var(--pgl-muted)">None yet. A resident cannot be enrolled until one exists.</p>') +
      '<div class="pgl-field"><label for="pglSpec">Specialty</label>' +
      '<select id="pglSpec"><option value="" selected disabled>Choose a specialty…</option>' +
        (specOpts || '<option value="" disabled>Loading the NMC list…</option>') + "</select>" +
      '<div class="hint">From PGMER-2023 Annexure-1 and Annexure-2. 15 specialties have a full curriculum pack; the rest use the PGMER requirements.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="create-prog"' + (I.busy ? " disabled" : "") + ">Add programme</button></div>" +

      joinRequestsCard(I, progs) +
      '<div class="pgl-card"><h3>Enrol a person</h3>' +
      '<div class="pgl-field"><label for="pglEmail">Their StewardMD email</label>' +
      '<input type="email" id="pglEmail" placeholder="name@example.com" autocapitalize="none" spellcheck="false">' +
      '<div class="hint">If they have not signed in to StewardMD yet, they are enrolled the first time they do.</div></div>' +
      '<div class="pgl-field"><label for="pglRole">Role</label><select id="pglRole">' +
        '<option value="pg_resident">PG resident</option>' +
        '<option value="pg_faculty">Faculty (guide)</option>' +
        '<option value="pg_hod">Head of Department</option>' +
        '<option value="academic_cell">Academic Cell</option>' +
      "</select></div>" +
      '<div class="pgl-field"><label for="pglProg">Programme (residents only)</label>' +
      '<select id="pglProg"><option value="">None</option>' + opts + "</select></div>" +
      '<div class="pgl-field"><label for="pglGuide">Guide (residents only)</label>' + guideSelect("pglGuide", "", I.faculty) +
      '<div class="hint">Their entries go to this person for verification unless they pick someone else.</div></div>' +
      '<div class="pgl-field"><label for="pglName">Their name</label>' +
      '<input type="text" id="pglName" placeholder="Dr. …"></div>' +
      '<div class="pgl-2col"><div class="pgl-field"><label for="pglStart">Training start date</label>' +
      '<input type="date" id="pglStart"></div>' +
      '<div class="pgl-field"><label for="pglYear">Training year</label>' + yearSelect("pglYear", 1) + "</div></div>" +
      '<button class="pgl-btn wide" data-pgl="enrol-person"' + (I.busy ? " disabled" : "") + ">" +
        (I.busy ? "Working…" : "Enrol") + "</button></div>" +
      bulkEnrolCard(I, opts) +
      (I.msg ? banner(I.err ? "warn" : "info", I.err ? "error" : "check_circle", esc(I.msg)) : "") +
      banner("info", "policy",
        "Enrolling someone grants them access to this institution's logbook data appropriate to their role. " +
        "An Academic Cell can add residents, faculty and HODs; it cannot create administrators.")
    );
  }

  /* A guide is picked by NAME from the faculty roster. The value is the roster identity, which is
   * what the server resolves; the resident never types a uid fragment. */
  function guideSelect(id, current, faculty) {
    var rows = arr(faculty).filter(function (r) { return r && r.identity; });
    return '<select id="' + attr(id) + '"><option value="">' + (rows.length ? "No guide yet" : "Faculty list not loaded") + "</option>" +
      rows.map(function (r) {
        return '<option value="' + attr(r.identity) + '"' + (current && sameId(current, r.identity) ? " selected" : "") + ">" +
          esc(rosterLabel(r)) + (r.role === "pg_hod" ? " (HOD)" : "") + "</option>";
      }).join("") + "</select>";
  }
  function yearSelect(id, cur) {
    return '<select id="' + attr(id) + '">' + [1, 2, 3].map(function (y) {
      return '<option value="' + y + '"' + (Number(cur || 1) === y ? " selected" : "") + ">Year " + y + "</option>";
    }).join("") + "</select>";
  }
  /* Requests to join, from residents who found the college by its code. Approving one IS the
   * enrolment (programme, guide, start date, year): the role a person ends up with comes from this
   * decision by the Academic Cell, never from what they said about themselves. */
  function joinRequestsCard(I, progs) {
    if (I.joinsMissing) return "";   // the server does not offer join requests yet
    var rows = arr(I.joins).filter(function (r) { return !r.status || r.status === "pending"; });
    var h = '<div class="pgl-card pgl-joins"><h3>Requests to join <span class="pgl-count">' + rows.length + "</span></h3>";
    if (I.joinsErr) h += banner("warn", "error", esc(instErr(I.joinsErr, "Could not load the requests to join.")));
    else if (!rows.length) h += '<p style="font-size:13px;color:var(--pgl-muted)">None waiting. A resident who enters your code appears here.</p>';
    var popts = function (sel) {
      return arr(progs).map(function (pr) {
        return '<option value="' + attr(pr.id) + '"' + (sel === pr.id ? " selected" : "") + ">" + esc((pr.name || pr.specialtyId || pr.id) + " · " + (pr.degree || "")) + "</option>";
      }).join("");
    };
    rows.forEach(function (r) {
      var id = String(r.id || "");
      var busy = state.joinActBusy === id;
      var pSel = r.programmeId || (progs[0] && progs[0].id) || "";
      h += '<div class="pgl-jr" data-jr="' + attr(id) + '">' +
        '<div class="pgl-row-t">' + esc(r.name || r.displayName || r.email || "A resident") + "</div>" +
        '<div class="pgl-row-s">' + esc([r.email, r.createdAt || r.requestedAt ? "asked " + (M() ? M().isoDate(r.createdAt || r.requestedAt) : "") : ""].filter(Boolean).join(" · ")) + "</div>" +
        '<div class="pgl-field"><label>Programme</label><select data-jr-f="programmeId">' + (popts(pSel) || '<option value="">Add a programme first</option>') + "</select></div>" +
        '<div class="pgl-field"><label>Guide</label>' + guideSelect("pglJrGuide_" + id, r.guide || "", I.faculty).replace("<select ", '<select data-jr-f="guide" ') + "</div>" +
        '<div class="pgl-2col"><div class="pgl-field"><label>Start date</label><input type="date" data-jr-f="startDate" value="' + attr(r.startDate || todayISO()) + '"></div>' +
        '<div class="pgl-field"><label>Training year</label>' + yearSelect("pglJrYear_" + id, r.trainingYear || 1).replace("<select ", '<select data-jr-f="trainingYear" ') + "</div></div>" +
        '<div class="pgl-btnrow" style="margin-top:4px">' +
          '<button class="pgl-btn ghost" data-pgl="jr-reject" data-id="' + attr(id) + '"' + (busy ? " disabled" : "") + ">Reject</button>" +
          '<button class="pgl-btn" data-pgl="jr-approve" data-id="' + attr(id) + '"' + (busy ? " disabled" : "") + ">" + (busy ? "Working…" : "Approve") + "</button>" +
        "</div></div>";
    });
    return h + "</div>";
  }
  function bulkEnrolCard(I, opts) {
    var r = I.bulk;
    return '<div class="pgl-card"><h3>Enrol several residents</h3>' +
      '<div class="pgl-field"><label for="pglBulk">Emails, one per line</label>' +
      '<textarea id="pglBulk" rows="4" placeholder="asha@college.in&#10;vikram@college.in" autocapitalize="none" spellcheck="false"></textarea></div>' +
      '<div class="pgl-field"><label for="pglBulkProg">Programme</label><select id="pglBulkProg"><option value="">Choose…</option>' + opts + "</select></div>" +
      '<div class="pgl-2col"><div class="pgl-field"><label for="pglBulkGuide">Guide (optional)</label>' + guideSelect("pglBulkGuide", "", I.faculty) + "</div>" +
      '<div class="pgl-field"><label for="pglBulkYear">Training year</label>' + yearSelect("pglBulkYear", 1) + "</div></div>" +
      '<button class="pgl-btn wide" data-pgl="enrol-bulk"' + (I.bulkBusy ? " disabled" : "") + ">" + (I.bulkBusy ? "Enrolling…" : "Enrol all") + "</button>" +
      (r ? banner(r.err ? "warn" : "info", r.err ? "error" : "check_circle", esc(r.msg)) : "") +
      "</div>";
  }

  // Server messages are written for a human already (see needsProBody / the pglog router), so prefer
  // them over a generic string; fall back only when there is nothing to show.
  function instErr(e, fallback) {
    if (e && e.userMessage) return e.userMessage;
    if (e && e.code === "forbidden") return "You do not have Academic Cell access to this institution.";
    if (e && e.code === "signin_required") return "Sign in to set up an institution.";
    /* gate() -> e404("org") reaches the client as "not_found". It means this device holds an org id
     * the server cannot resolve - created against a different environment, or since deleted. */
    if (e && e.code === "institution_provisioning_required")
      return "PG institutions are set up by StewardMD for the college that licenses it. Ask StewardMD to " +
             "provision your institution and name its administrator - you will get an institution code to share.";
    if (e && e.code === "not_found") return "The server does not have an institution with this ID. It may have been created on a different account or environment.";
    return fallback;
  }
  function loadInstitution() {
    var st = ST();
    state.inst = state.inst || {};
    if (!st) return Promise.resolve();
    var org = (st.context() || {}).orgId;
    if (!org) {
      return (st.myInstitutions ? st.myInstitutions() : Promise.resolve([]))
        .then(function (list) { state.inst.mine = list || []; state.inst.mineErr = null; },
              function (e) { state.inst.mine = []; state.inst.mineErr = e || new Error("unknown"); });
    }
    var cur = C();
    /* ROOT CAUSE of the raw 32-char id showing as "Institution code": this screen reads the code from
     * state.ctx (populated by /me, which does return orgCode), but "pick-inst" sets state.ctx = null
     * and then calls loadInstitution() directly - never re-running ensureContext(). So ctx was null
     * for the render that followed, state.inst was cleared alongside it, and BOTH code sources were
     * empty, leaving only the orgId fallback. Re-establish the context here, where every caller of
     * this screen routes through, instead of at each of the three call sites that null it. */
    return ensureContext().then(function () {
      // A stub context is not a context. It resolves, so the rejection branch never runs.
      var cx = state.ctx;
      state.inst.ctxErr = (cx && cx.stub)
        ? Object.assign(new Error(cx.reason || "signin_required"), { code: cx.reason || "signin_required" })
        : null;
    }, function (e) { state.inst.ctxErr = e || new Error("unknown"); }).then(function () {
    return Promise.all([
      /* Record WHY this was empty. Swallowing the rejection made a 403 or a 500 render as "None yet.
       * A resident cannot be enrolled until one exists" - so an Academic Cell whose request had
       * failed would create a duplicate programme on top of the ones already there. */
      st.programmes(org).then(function (r) { state.inst.progErr = null; return (r && r.programmes) || []; },
                              function (e) { state.inst.progErr = e || new Error("unknown"); return []; }),
      (cur && cur.loadSpecialties)
        ? cur.loadSpecialties().then(function (b) { return [].concat((b && b.broad) || [], (b && b.super) || []); },
                                     function () { return []; })
        : Promise.resolve([])
      ,
      // The faculty roster, so guides are chosen by name. Best effort.
      (st.facultyRoster ? st.facultyRoster(org).then(function (f) { return arr(f); }, function () { return []; }) : Promise.resolve([])),
      loadJoinRequests(org)
    ]).then(function (r) {
      state.inst.programmes = r[0];
      state.inst.specialties = r[1];
      state.inst.faculty = r[2];
      if (!state.inst.orgCode && state.ctx && state.ctx.orgCode) state.inst.orgCode = state.ctx.orgCode;
      if (!state.inst.orgName && state.ctx && state.ctx.orgName) state.inst.orgName = state.ctx.orgName;
    });
    });
  }

  function screenAddPicker() {
    var kinds = [
      ["procedure", "content_cut", "Procedure / operation", "Assisted, supervised or independent"],
      ["clinical", "stethoscope", "Clinical activity", "OPD, inpatient or emergency"],
      ["academic", "school", "Academic activity", "Seminar, journal club, teaching"],
      ["research", "science", "Research / thesis", "Milestone, publication, presentation"],
      ["certification", "workspace_premium", "Certification", "Research methodology, ethics, BCLS/ACLS"],
      ["reflection", "self_improvement", "Reflection", "Critical incident or learning point"]
    ];
    /* Easy mode: the institution records attendance, so it is not one more thing on the resident's
     * add list. It stays reachable from Progress (and the home Sections list). */
    if (flag("smd_pglog_attendance") && !easy()) kinds.push(["attendance", "event_available", "Attendance", "Present, leave or absent"]);
    var h = [];
    if (easy()) {
      h.push('<button class="pgl-row pgl-row-quick" data-pgl="go" data-r="quick">' +
        '<span class="pgl-row-ic">' + ic("bolt") + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">Quick log</span>' +
        '<span class="pgl-row-s">A procedure, case or teaching session in three taps</span></span>' + ic("chevron_right") + "</button>");
    }
    kinds.forEach(function (k) {
      h.push('<button class="pgl-row" data-pgl="go" data-r="add/' + k[0] + '">' +
        '<span class="pgl-row-ic">' + ic(k[1]) + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(k[2]) + "</span>" +
        '<span class="pgl-row-s">' + esc(k[3]) + "</span></span>" + ic("chevron_right") + "</button>");
    });
    var drafts = ST() ? ST().drafts() : [];
    if (drafts.length) {
      h.push('<div class="pgl-sec-title"><span>Unfinished drafts</span><span>' + drafts.length + "</span></div>");
      drafts.slice(0, 5).forEach(function (d) { h.push(entryRow(d, true)); });
    }
    return wrap(h.join(""));
  }

  function isSurgicalDegree() { return quickNeedsSupervisor(); }
  /* Text inputs and text areas get the same dictation the quick screen has (easy mode). */
  function micFor(name) {
    if (!easy() || !voiceAvailable()) return "";
    var on = state.fieldMic === name;
    return '<button class="pgl-fmic' + (on ? " on" : "") + '" data-pgl="f-mic" data-field="' + attr(name) + '" aria-label="Dictate">' + ic(on ? "graphic_eq" : "mic") + "</button>";
  }
  function withMic(name, control) {
    var mic = micFor(name);
    return mic ? '<div class="pgl-micwrap">' + control + mic + "</div>" : control;
  }

  /* Who receives the entry. In easy mode a known supervisor is a NAME chip ("Dr Menon, your guide ·
   * Change"); only MS / M.Ch must name one (PGMER-2023 5.2(vi)), everyone else's entries go to their
   * guide, which the server falls back to when no supervisor is given. */
  function supervisorField(d, errs) {
    var roster = arr(state.roster);
    var guide = guideOf();
    var must = d.kind === "procedure" && isSurgicalDegree();
    if (easy() && !state.supEdit) {
      if (d.supervisor) {
        var isGuide = guide && sameId(d.supervisor, guide);
        return '<div class="pgl-field' + (errs.supervisor ? " bad" : "") + '"><label>' + (must ? "Supervising consultant" : "Goes to") + "</label>" +
          '<button class="pgl-supchip" data-pgl="sup-change">' + ic("person") + "<b>" + esc(personName(d.supervisor)) + "</b>" +
          (isGuide ? "<small>your guide</small>" : "") + '<span class="chg">Change</span></button>' +
          (errs.supervisor ? '<div class="pgl-err">' + esc(errs.supervisor) + "</div>" : "") + "</div>";
      }
      if (!must) {
        return '<div class="pgl-field"><label>Goes to</label>' +
          '<button class="pgl-supchip" data-pgl="sup-change">' + ic("person") + "<b>Your guide</b>" +
          '<span class="chg">Pick someone else</span></button>' +
          '<div class="hint">You do not need to choose anyone. Your guide receives it for verification.</div></div>';
      }
    }
    var hintOld = "They receive this entry for verification (PGMER-2023 5.2(vii)). Only people who can actually " +
      "verify are listed. An unlisted name would mean nobody receives it.";
    var hintEasy = must ? "Required for " + ((state.dash && state.dash.programme && state.dash.programme.degree) || "surgical") + " procedure entries. They verify it."
      : "Leave it as your guide unless someone else supervised this.";
    // A PICKER, not a text box. `pendingFor` is a copy of this value and is the only thing that puts
    // the entry in someone's queue, so a typo here produces an entry that is "submitted" and reaches
    // nobody. The server refuses an unresolvable supervisor; this is how the resident avoids one.
    if (roster.length) {
      var known = roster.some(function (r) { return sameId(r.identity, d.supervisor); });
      return field(easy() ? (must ? "Supervising consultant" : "Goes to") : "Faculty / supervisor", "supervisor",
        '<select data-f="supervisor">' +
          '<option value="">' + (easy() && !must ? "My guide" : "Choose") + "</option>" +
          roster.map(function (r) {
            return '<option value="' + attr(r.identity) + '"' + (sameId(d.supervisor, r.identity) ? " selected" : "") + ">" +
              esc(rosterLabel(r)) + (r.role === "pg_hod" ? " (HOD)" : "") + (guide && sameId(guide, r.identity) ? " · your guide" : "") + "</option>";
          }).join("") +
          (d.supervisor && !known ? '<option value="' + attr(d.supervisor) + '" selected>' + esc(personName(d.supervisor)) + " (not on the faculty list)</option>" : "") +
        "</select>",
        easy() ? hintEasy : hintOld, errs);
    }
    return field(easy() ? (must ? "Supervising consultant" : "Goes to") : "Faculty / supervisor", "supervisor",
      '<input type="text" data-f="supervisor" value="' + attr(d.supervisor) + '" placeholder="Who supervised this?">',
      easy() ? hintEasy + " The faculty list is not loaded yet; it is checked when you submit."
        : "They receive the entry for verification (PGMER-2023 5.2(vii)). The faculty list is not loaded " +
          "on this device yet, so this is free text; it will be checked against the list when you submit.", errs);
  }

  // The form. Every field the resident already told StewardMD is prefilled from their context.
  function screenAddForm(kind) {
    var m = M(), st = ST(), prefs = st ? st.prefs() : {}, E = easy();
    var d = state.draft;
    if (!d || d.kind !== kind) {
      var res = (state.dash && state.dash.resident) || (state.ctx && state.ctx.resident) || {};
      var current = currentRotation();
      var must = kind === "procedure" && isSurgicalDegree();
      d = state.draft = m.entry({
        id: st ? st.localId() : "loc_tmp", kind: kind,
        residentId: res.id, occurredAt: todayISO(),
        departmentId: (current && current.departmentId) || res.departmentId || prefs.lastDepartmentId || "",
        rotationId: (current && current.id) || "",
        unit: res.unit || "",
        supervisor: E
          ? ((current && current.faculty) || res.guide || (must ? prefs.lastSupervisor : "") || "")
          : ((current && current.faculty) || prefs.lastSupervisor || res.guide || ""),
        setting: kind === "clinical" ? (prefs.lastSetting || "opd") : undefined,
        role: kind === "academic" ? "presented" : ""
      });
      /* INTEGRITY. m.entry() normalises a blank role to "assisted", which pre-selected the one claim
       * PGMER-2023 9.2(c) penalises. The resident taps it, exactly as on the quick screen. */
      if (kind === "procedure" || kind === "clinical") d.role = "";
      state.draftErrors = [];
      state.suggestions = [];
      state.supEdit = false;
    }
    var errs = {}; arr(state.draftErrors).forEach(function (e) { errs[e.field] = e.message; });
    var h = [];

    if (d.__serverId || d.__amendId) {
      h.push(banner(d.__amendId ? "info" : "bad", d.__amendId ? "lock" : "undo", d.__amendId
        ? "<b>Amending a verified entry.</b> Change what is wrong, then save. The verified original is kept in full and your guide re-verifies the change."
        : "<b>Correcting a returned entry.</b>" + (d.returnReason ? " Your guide said: " + esc(d.returnReason) : "")));
    }

    if (E) {
      var y = m.addDays ? m.addDays(todayISO(), -1) : "";
      h.push('<div class="pgl-field"><label>Date</label><div class="pgl-chips pgl-datechips">' +
        '<button class="pgl-chip sm" data-f-chip="occurredAt" data-v="' + attr(todayISO()) + '" aria-pressed="' + (d.occurredAt === todayISO()) + '">Today</button>' +
        (y ? '<button class="pgl-chip sm" data-f-chip="occurredAt" data-v="' + attr(y) + '" aria-pressed="' + (d.occurredAt === y) + '">Yesterday</button>' : "") +
        '<input type="date" data-f="occurredAt" value="' + attr(d.occurredAt) + '" max="' + attr(todayISO()) + '" aria-label="Pick a date"></div>' +
        (errs.occurredAt ? '<div class="pgl-err">' + esc(errs.occurredAt) + "</div>" : "") + "</div>");
    } else {
      h.push(field("Date", "occurredAt", '<input type="date" data-f="occurredAt" value="' + attr(d.occurredAt) + '" max="' + attr(todayISO()) + '">',
        "When the work was done. Log in real time where you can: the delay is recorded and shown.", errs));
    }

    if (kind === "procedure") h.push(procedureFields(d, errs));
    else if (kind === "clinical") h.push(clinicalFields(d, errs));
    else if (kind === "academic") h.push(academicFields(d, errs));
    else if (kind === "research") h.push(researchFields(d, errs));
    else if (kind === "certification") h.push(certificationFields(d, errs));
    else if (kind === "attendance") h.push(attendanceFields(d, errs));
    else if (kind === "reflection") h.push(reflectionFields(d, errs));

    // Role ladder: the graded responsibility PGMER-2023 5.2(x) describes. Not shown for kinds
    // where it is meaningless. Never pre-selected.
    if (kind === "procedure" || kind === "clinical") {
      var surg = isSurgicalDegree();
      h.push('<div class="pgl-field' + (errs.role ? " bad" : "") + '"><label>Your role</label><div class="pgl-chips">' +
        m.ROLES.map(function (r) {
          return '<button class="pgl-chip" data-f-chip="role" data-v="' + r + '" aria-pressed="' + (d.role === r ? "true" : "false") + '">' +
            esc(m.ROLE_LABEL[r]) + "</button>";
        }).join("") + "</div>" +
        (errs.role ? '<div class="pgl-err">' + esc(errs.role) + "</div>" : "") +
        (E
          ? (surg && kind === "procedure" ? '<div class="hint">MS / M.Ch: say whether you assisted or did it yourself. ' +
              whyBox("PGMER-2023 5.2(vi) requires MS / M.Ch students to record every surgical procedure assisted or done independently.") + "</div>" : "")
          : '<div class="hint">' + esc("PGMER-2023 5.2(vi) requires MS / M.Ch students to record every surgical procedure assisted or done independently.") + "</div>") +
        "</div>");
    }

    h.push(supervisorField(d, errs));

    if (arr(state.dash && state.dash.rotations).length) {
      h.push(field("Rotation / posting", "rotationId",
        '<select data-f="rotationId"><option value="">Not linked</option>' +
        arr(state.dash.rotations).map(function (r) {
          return '<option value="' + attr(r.id) + '"' + (d.rotationId === r.id ? " selected" : "") + ">" + esc(r.name) + "</option>";
        }).join("") + "</select>", "", errs));
    }

    h.push(field("Remarks", "remarks", withMic("remarks", '<textarea data-f="remarks" placeholder="Optional">' + esc(d.remarks) + "</textarea>"), "", errs));

    // Requirement mapping: deterministic first, AI clearly labelled and opt-in.
    h.push(requirementPicker(d));

    h.push('<div class="pgl-banner" data-t="ai">' + ic("shield_person") +
      "<div><b>No patient identity.</b> This is an educational logbook, not a second record of the patient. " +
      "A case reference is a hospital/MRN reference only; a name, phone number or Aadhaar typed into it is stripped before it is stored.</div></div>");

    var bar = d.__amendId
      ? '<div class="pgl-actionbar"><button class="pgl-btn wide" data-pgl="amend-save">' + ic("send") + "Send amendment</button></div>"
      : '<div class="pgl-actionbar">' +
        '<button class="pgl-btn ghost" data-pgl="save-draft">Save draft</button>' +
        '<button class="pgl-btn" data-pgl="submit-draft">' + ic("send") + (d.__serverId ? "Resubmit" : "Submit") + "</button></div>";
    return wrap(h.join("")) + bar;
  }

  function field(label, name, control, hint, errs) {
    var bad = errs && errs[name];
    return '<div class="pgl-field' + (bad ? " bad" : "") + '"><label>' + esc(label) + "</label>" + control +
      (bad ? '<div class="pgl-err">' + esc(bad) + "</div>" : "") +
      (hint ? '<div class="hint">' + esc(hint) + "</div>" : "") + "</div>";
  }

  function procedureFields(d, errs) {
    var c = C(), cat = state.pack ? arr(state.pack.procedureCatalog) : [];
    var h = "";
    if (cat.length) {
      h += field("Procedure", "procedure",
        '<select data-f="procedureId"><option value="">Choose, or type below</option>' +
        cat.map(function (p) {
          return '<option value="' + attr(p.id) + '"' + (d.procedureId === p.id ? " selected" : "") + ">" +
            esc(p.label) + (p.target != null ? " (" + p.target + " required)" : "") + "</option>";
        }).join("") + "</select>",
        "From your specialty's NMC curriculum. Numbers in brackets are the NMC minimum where the curriculum states one.", errs);
    }
    h += field(cat.length ? "Or name it" : "Procedure", "procedure",
      withMic("procedureText", '<input type="text" data-f="procedureText" value="' + attr(d.procedureText) + '" placeholder="e.g. Central venous access">'),
      cat.length ? "" : (easy() ? "Type the procedure. It is counted the same way." : "Your specialty's NMC guidelines list no procedure catalogue, so type it. It is still counted."), errs);
    h += field("Case reference", "caseRef",
      '<input type="text" data-f="caseRef" data-phi-input value="' + attr(d.caseRef) + '" placeholder="MRN / IP number" maxlength="32">',
      "Hospital reference only. Never a patient name.", errs);
    h += '<div class="pgl-field"><label>Setting</label><div class="pgl-chips">' +
      ["ot", "ipd", "emergency", "opd", "bedside", "daycare"].map(function (s) {
        return '<button class="pgl-chip" data-f-chip="setting" data-v="' + s + '" aria-pressed="' + (d.setting === s ? "true" : "false") + '">' +
          esc(easy() ? settingText(s) : s.toUpperCase()) + "</button>";
      }).join("") + "</div></div>";
    h += field("Outcome", "outcome", selectOf("outcome", M().OUTCOMES, d.outcome, outcomeText), "", errs);
    h += field("Complications", "complications",
      '<input type="text" data-f="complications" value="' + attr(arr(d.complications).join(", ")) + '" placeholder="Comma separated, if any">', "", errs);
    return h;
  }
  function clinicalFields(d, errs) {
    var h = '<div class="pgl-field"><label>Setting</label><div class="pgl-chips">' +
      [["opd", "OPD"], ["ipd", "Inpatient"], ["emergency", "Emergency"]].map(function (s) {
        return '<button class="pgl-chip" data-f-chip="setting" data-v="' + s[0] + '" aria-pressed="' + (d.setting === s[0] ? "true" : "false") + '">' +
          esc(s[1]) + "</button>";
      }).join("") + "</div></div>";
    h += field("Case / problem", "title", withMic("title", '<input type="text" data-f="title" value="' + attr(d.title) + '" placeholder="e.g. Community-acquired pneumonia">'), "", errs);
    h += field("Diagnosis / category", "diagnosis", withMic("diagnosis", '<input type="text" data-f="diagnosis" value="' + attr(d.diagnosis) + '" placeholder="Optional">'), "", errs);
    h += field("Case reference", "caseRef", '<input type="text" data-f="caseRef" data-phi-input value="' + attr(d.caseRef) + '" placeholder="MRN / IP number" maxlength="32">',
      "Hospital reference only. Never a patient name.", errs);
    h += '<div class="pgl-field"><label>Age band and sex (optional)</label><div style="display:flex;gap:8px">' +
      selectOf("ageBand", [""].concat(M().AGE_BANDS), d.ageBand, function (v) { return v || "Age band"; }) +
      selectOf("sex", ["", "male", "female", "other"], d.sex, function (v) { return SEX_LABEL[v] || "Sex"; }) + "</div>" +
      '<div class="hint">A band, never a date of birth.</div></div>';
    h += field("Outcome", "outcome", selectOf("outcome", M().OUTCOMES, d.outcome, outcomeText), "", errs);
    return h;
  }
  function academicFields(d, errs) {
    var m = M();
    var h = field("Activity", "academicType",
      '<select data-f="academicType">' + m.ACADEMIC_TYPES.map(function (t) {
        return '<option value="' + t + '"' + (d.academicType === t ? " selected" : "") + ">" + esc(m.ACADEMIC_LABEL[t] || t) + "</option>";
      }).join("") + "</select>",
      easy() ? "Lectures, seminars, journal clubs, clinical meetings, grand rounds and teaching undergraduates all count."
        : "PGMER-2023 5.2(x) names lectures, seminars, journal clubs, group discussions, laboratory work, clinical meetings, grand rounds and CPCs; 5.2(viii) requires teaching undergraduates.", errs);
    h += field("Topic", "topic", withMic("topic", '<input type="text" data-f="topic" value="' + attr(d.topic) + '" placeholder="What was it about?">'), "", errs);
    h += '<div class="pgl-field"><label>Your role</label><div class="pgl-chips">' +
      m.ACADEMIC_ROLES.map(function (r) {
        return '<button class="pgl-chip" data-f-chip="role" data-v="' + r + '" aria-pressed="' + (d.role === r ? "true" : "false") + '">' +
          esc(r.charAt(0).toUpperCase() + r.slice(1)) + "</button>";
      }).join("") + "</div></div>";
    h += field("Where", "scope", selectOf("scope", m.ACADEMIC_SCOPES, d.scope, function (v) { return REP() ? REP().scopeLabel(v) : capWord(v); }), "", errs);
    h += field("Place", "place", '<input type="text" data-f="place" value="' + attr(d.place) + '" placeholder="Department, institution or venue">', "", errs);
    return h;
  }
  function researchFields(d, errs) {
    var m = M(), r = REP();
    var h = field("Type", "subtype", selectOf("subtype", m.RESEARCH_SUBTYPES, d.subtype, capWord), "", errs);
    if (d.subtype === "thesis_milestone") {
      h += field("Milestone", "milestone",
        '<select data-f="milestone">' + m.RESEARCH_MILESTONES.map(function (x) {
          return '<option value="' + x + '"' + (d.milestone === x ? " selected" : "") + ">" + esc(r ? r.milestoneLabel(x) : x) + "</option>";
        }).join("") + "</select>",
        easy() ? "These steps are your institution's thesis milestones." : "PGMER-2023 makes thesis a curriculum component (2.2(iii)) but prescribes no milestone chain. These are your institution's.", errs);
    }
    h += field("Title", "projectTitle", '<input type="text" data-f="projectTitle" value="' + attr(d.projectTitle) + '" placeholder="Thesis or project title">', "", errs);
    h += field("Guide", "guide", '<input type="text" data-f="guide" value="' + attr(d.guide) + '">', "", errs);
    if (d.subtype === "publication") {
      h += field("Journal", "journal", '<input type="text" data-f="journal" value="' + attr(d.journal) + '">', "", errs);
      h += '<div class="pgl-field"><div class="pgl-chips">' +
        '<button class="pgl-chip" data-f-toggle="firstAuthor" aria-pressed="' + (d.firstAuthor ? "true" : "false") + '">First author</button>' +
        '<button class="pgl-chip" data-f-toggle="indexed" aria-pressed="' + (d.indexed ? "true" : "false") + '">Indexed journal</button></div>' +
        '<div class="hint">' + (easy() ? "A publication counts toward the exam requirement only when you are the <b>first author</b>."
          : "PGMER-2023 5.2(x) counts a publication toward the examination pre-requisite only when you are the <b>first author</b>.") + '</div></div>';
    }
    if (d.subtype === "poster" || d.subtype === "conference_paper" || d.subtype === "presentation") {
      h += field("Conference", "conference", '<input type="text" data-f="conference" value="' + attr(d.conference) + '">', "", errs);
      h += field("Level", "conferenceLevel", selectOf("conferenceLevel", ["", "institutional", "state", "zonal", "national", "international"], d.conferenceLevel, function (v) { return v ? capWord(v) : "Choose"; }), "", errs);
    }
    h += field("Identifier", "identifier", '<input type="text" data-f="identifier" value="' + attr(d.identifier) + '" placeholder="DOI / PMID / IEC reference">', "", errs);
    if (d.milestone === "ethics_approval") {
      h += banner("warn", "gavel", "Attach the ethics-committee approval letter. A milestone claiming IEC approval with nothing attached will not be accepted.");
    }
    return h;
  }
  function certificationFields(d, errs) {
    var m = M();
    var LBL = { research_methodology: "Research Methodology", ethics_gcp_glp: "Ethics / GCP / GLP", bcls_acls: "BCLS + ACLS" };
    var h = '<div class="pgl-field"><label>Course</label><div class="pgl-chips">' +
      m.CERTIFICATIONS.map(function (x) {
        return '<button class="pgl-chip" data-f-chip="subtype" data-v="' + x + '" aria-pressed="' + (d.subtype === x ? "true" : "false") + '">' +
          esc(LBL[x]) + "</button>";
      }).join("") + "</div>" +
      '<div class="hint">All three are mandatory in the first year and are needed before the final examination. ' +
        (easy() ? whyBox(prov("nmc_regulation", "5.2(xi)")) : prov("nmc_regulation", "5.2(xi)")) + "</div></div>";
    h += field("Issuing institution", "issuer", '<input type="text" data-f="issuer" value="' + attr(d.issuer) + '">', "", errs);
    h += field("Certificate number", "certificateNo", '<input type="text" data-f="certificateNo" value="' + attr(d.certificateNo) + '">',
      "The certificate is the evidence: attach it or enter its number.", errs);
    return h;
  }
  function attendanceFields(d, errs) {
    var m = M();
    var LBL = { present: "Present", leave_paid: "Paid leave", leave_academic: "Academic leave",
      leave_maternity: "Maternity leave", leave_paternity: "Paternity leave", absent: "Absent", holiday: "Holiday" };
    var h = '<div class="pgl-field"><label>Status</label><div class="pgl-chips">' +
      m.ATTENDANCE_STATES.map(function (x) {
        return '<button class="pgl-chip" data-f-chip="state" data-v="' + x + '" aria-pressed="' + (d.state === x ? "true" : "false") + '">' +
          esc(LBL[x]) + "</button>";
      }).join("") + "</div></div>";
    h += field("Until (for a range)", "endDate", '<input type="date" data-f="endDate" value="' + attr(d.endDate || d.occurredAt) + '">',
      "A range expands to one record per day. Re-entering a day corrects it.", errs);
    h += banner("info", "policy",
      "PGMER-2023 5.5 states 80% attendance. The 751 / 501-day figures come from the PGMEB FAQ, a " +
      "<b>secondary source</b> we could not fetch as a primary document. What counts as an attended day " +
      "is your institution's rule. This records, it does not adjudicate.");
    return h;
  }
  function reflectionFields(d, errs) {
    var h = '<div class="pgl-field"><label>Type</label><div class="pgl-chips">' +
      [["critical_incident", "Critical incident"], ["learning_point", "Learning point"], ["feedback_received", "Feedback received"], ["other", "Other"]].map(function (x) {
        return '<button class="pgl-chip" data-f-chip="subtype" data-v="' + x[0] + '" aria-pressed="' + (d.subtype === x[0] ? "true" : "false") + '">' + esc(x[1]) + "</button>";
      }).join("") + "</div>" +
      '<div class="hint">The 2022-revised NMC curricula ask PG students to “reflect and record their reflections in log book particularly of the critical incidents”.</div></div>';
    h += field("Reflection", "body", withMic("body", '<textarea data-f="body" style="min-height:150px" placeholder="What happened, what you thought, what you would do differently">' + esc(d.body) + "</textarea>"), "", errs);
    return h;
  }
  /* A select whose CURRENT value is shown truthfully. With no blank option, a blank outcome rendered
   * as the first choice ("improved") while the draft still held "" - the form showed a claim the
   * record did not make. A blank current value now gets a visible "Choose" option. */
  function selectOf(name, values, current, labelFn) {
    var vals = arr(values);
    var cur = current == null ? "" : String(current);
    var lead = vals.indexOf(cur) < 0 ? '<option value="" selected>Choose</option>' : "";
    return '<select data-f="' + attr(name) + '">' + lead + vals.map(function (v) {
      var lbl = labelFn ? labelFn(v) : (v || "Not stated");
      return '<option value="' + attr(v) + '"' + (cur === v ? " selected" : "") + ">" + esc(lbl) + "</option>";
    }).join("") + "</select>";
  }

  function requirementPicker(d) {
    var sel = {}; arr(d.requirementIds).forEach(function (id) { sel[id] = 1; });
    var sug = state.suggestions;
    var h = '<div class="pgl-field"><label>Training requirement</label>';
    if (!state.requirements.length) {
      h += '<div class="hint">No curriculum pack is loaded, so there is nothing to map to yet.</div></div>';
      return h;
    }
    if (sug.length) {
      h += '<div class="pgl-chips">' + sug.map(function (s) {
        return '<button class="pgl-chip" data-f-req="' + attr(s.id) + '" aria-pressed="' + (sel[s.id] ? "true" : "false") + '">' +
          (s.source === "ai" ? ic("auto_awesome") : "") + esc(s.label) + "</button>";
      }).join("") + "</div>";
      var why = sug.filter(function (s) { return s.why; })[0];
      if (why) h += '<div class="hint">Suggested because: ' + esc(why.why) + ". Tap to accept, nothing is tagged automatically.</div>";
      if (sug.some(function (s) { return s.source === "ai"; })) {
        h += banner("ai", "auto_awesome", "<b>" + esc(AI() ? AI().LABEL : "Suggestion") + "</b>: a suggestion is never a completed competency. Only a faculty verification makes an entry count.");
      }
    } else {
      h += '<button class="pgl-btn ghost" data-pgl="suggest">' + ic("auto_awesome") + "Suggest requirement</button>";
    }
    var chosen = arr(d.requirementIds);
    if (chosen.length) {
      h += '<div class="hint">Tagged: ' + chosen.map(function (id) {
        var r = state.requirements.filter(function (x) { return x.id === id; })[0];
        return esc(r ? r.label : id);
      }).join(" · ") + "</div>";
    }
    h += '<button class="pgl-btn ghost" data-pgl="pick-req" style="margin-top:8px">' + ic("list") + "Choose from the full list</button>";
    return h + "</div>";
  }

  /* ── ENTRY DETAIL + audit trail ──────────────────────────────────────────── */
  function screenEntry(id) {
    var m = M(), st = ST(), r = REP();
    var local = st ? st.getDraft(id) : null;
    var e = local || arr(state.dash && state.dash.entries).filter(function (x) { return x.id === id; })[0];
    if (!e) return wrap(errorState("That entry is not in this device's copy."));
    var lastErr = local ? draftError(id) : null;
    var status = local ? (lastErr ? "failed" : isQueued(id) ? "queued" : "draft") : e.status;
    var h = [];

    if (lastErr) {
      /* The SERVER refused this. Say so, in its words, and offer the fix. Never "it will be submitted
       * when you are online": nothing about the network will change the answer. */
      h.push(banner("bad", "error", "<b>Not submitted.</b> " + esc(lastErr.message || refusalText(lastErr)) +
        " Fix it and submit again."));
    }
    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(r.activityLabel(e)) + "</div>" +
      '<div class="pgl-row-s" style="margin-top:6px">' + esc(e.occurredAt) + " · " + esc(kindText(e)) +
      (e.role ? " · " + esc(roleText(e)) : "") + "</div>" +
      '<div style="margin-top:10px">' + vstate(status) + "</div>" +
      (e.status === "returned" && e.returnReason
        ? banner("bad", "undo", "<b>Returned for correction.</b> " + esc(e.returnReason))
        : "") +
      (m.latencyDays(e) > 3
        ? '<div class="hint" style="margin-top:8px">Logged ' + m.latencyDays(e) + " days after the event. The curricula ask for real-time entries; the delay is recorded, not penalised.</div>"
        : "") +
      "</div>");

    var rows = [];
    function kv(k, v) { if (v) rows.push([k, v]); }
    kv("Supervisor", personName(e.supervisor));
    kv("Department", e.departmentId);
    kv("Case reference", e.caseRef);
    kv("Diagnosis", e.diagnosis);
    kv("Setting", e.setting ? settingText(e.setting) : "");
    kv("Outcome", e.outcome ? outcomeText(e.outcome) : "");
    kv("Complications", arr(e.complications).join(", "));
    kv("Topic", e.topic);
    kv("Place", e.place);
    kv("Scope", e.scope ? r.scopeLabel(e.scope) : "");
    kv("Milestone", e.milestone ? r.milestoneLabel(e.milestone) : "");
    kv("Journal", e.journal);
    kv("Remarks", e.remarks);
    kv("Reflection", e.body);
    if (rows.length) {
      h.push('<div class="pgl-card"><h3>Details</h3><dl class="pgl-rep-meta">' +
        rows.map(function (kvp) { return "<dt>" + esc(kvp[0]) + "</dt><dd>" + (kvp[0] === "Case reference" ? phi("id", kvp[1]) : esc(kvp[1])) + "</dd>"; }).join("") + "</dl></div>");
    }

    if (arr(e.requirementIds).length) {
      h.push('<div class="pgl-card"><h3>Training requirements</h3>' +
        arr(e.requirementIds).map(function (id2) {
          var req = state.requirements.filter(function (x) { return x.id === id2; })[0];
          if (!req) return '<div class="pgl-row-s">' + esc(id2) + "</div>";
          return '<div style="margin-bottom:8px"><div class="pgl-row-t">' + esc(req.label) + "</div>" +
            '<div class="pgl-row-s">' + prov(req.source, req.clause) + "</div>" +
            (req.quote ? '<div class="pgl-quote">' + esc(req.quote) + "</div>" : "") + "</div>";
        }).join("") + "</div>");
    }

    // The audit trail. This is the part PGMER-2023 9.2(c) makes non-optional.
    if (arr(e.history).length) {
      h.push('<div class="pgl-card"><h3>Audit trail</h3><ul class="pgl-audit">' +
        arr(e.history).map(function (x) {
          return '<li data-a="' + attr(x.action) + '"><b>' + esc(auditLabel(x.action)) + "</b> " +
            '<span class="when">' + esc(m.isoDate(x.at)) + "</span> · " + esc(personName(x.by)) +
            (x.reason ? '<span class="why">' + esc(x.reason) + "</span>" : "") + "</li>";
        }).join("") + "</ul>" +
        (arr(e.revisions).length
          ? '<div class="hint" style="margin-top:8px">' + arr(e.revisions).length +
            " amendment(s). The verified original of each is retained in full and is never overwritten.</div>"
          : "") +
        (e.attestedIn ? '<div class="hint">Covered by the guide\'s authentication for ' + esc(monthLabel(e.attestedIn)) + "." + provHome("nmc_regulation", "5.2(vii)") + "</div>" : "") +
        "</div>");
    }

    if (e.status === "verified") {
      h.push('<div class="pgl-card"><h3>Signature</h3>' +
        '<dl class="pgl-rep-meta">' +
        (e.verifiedName ? "<dt>Verified by</dt><dd>" + esc(e.verifiedName) + "</dd>" : "") +
        (e.verifiedReg ? "<dt>Registration</dt><dd>" + esc(e.verifiedReg) +
          (e.verifiedCouncil ? " · " + esc(e.verifiedCouncil) : "") + "</dd>" : "") +
        "<dt>Signed</dt><dd>" + esc(m.isoDate(e.verifiedAt)) + "</dd></dl>" +
        (e.verifyCode
          ? qrBlock(e.verifyCode, "Anyone can scan this to confirm who signed it and that it has not changed.")
          : banner("warn", "qr_code_2",
              "No verification code was issued for this signature, so it cannot be checked by scanning. " +
              "The signature and the audit trail still stand.")) +
        "</div>");
    }
    var bar = "";
    if (local) {
      bar = '<div class="pgl-actionbar">' +
        '<button class="pgl-btn' + (lastErr ? "" : " ghost") + '" data-pgl="edit-draft" data-id="' + attr(id) + '">' + (lastErr ? ic("build") + "Fix" : "Edit") + "</button>" +
        '<button class="pgl-btn' + (lastErr ? " ghost" : "") + '" data-pgl="submit-existing" data-id="' + attr(id) + '">' + ic("send") + (lastErr ? "Try again" : "Submit") + "</button></div>";
    } else if (e.status === "submitted") {
      bar = '<div class="pgl-actionbar">' +
        '<button class="pgl-btn ghost" data-pgl="withdraw" data-id="' + attr(id) + '">' + ic("undo") + "Withdraw to correct</button></div>";
      h.push(banner("info", "hourglass_top",
        "This is with <b>" + esc(e.supervisor ? personName(e.supervisor) : "your guide") + "</b> for verification and cannot be edited while it is " +
        "there: they would end up signing something different from what they read. Withdraw it first; that clears " +
        "it from their queue and is recorded."));
    } else if (e.status === "returned" || e.status === "draft") {
      bar = '<div class="pgl-actionbar">' +
        '<button class="pgl-btn ghost" data-pgl="edit-server" data-id="' + attr(id) + '">Correct</button>' +
        '<button class="pgl-btn" data-pgl="resubmit" data-id="' + attr(id) + '">' + ic("send") + "Resubmit</button></div>";
    } else if (e.status === "verified") {
      bar = '<div class="pgl-actionbar">' +
        '<button class="pgl-btn ghost" data-pgl="amend" data-id="' + attr(id) + '">' + ic("edit_note") + "Request amendment</button></div>";
      h.push(banner("info", "lock",
        "This entry is verified and is now a fixed record. A correction is made as an <b>amendment</b>: the " +
        "original is kept in full, the change is recorded with your reason, and it goes back to your guide " +
        "for re-verification. It is never overwritten."));
    }
    /* LOG AGAIN (easy mode): the same kind of case, as a new unsaved draft dated today with the role
     * CLEARED. The next case is a different patient and a different claim, so the case reference,
     * outcome, complications and role are never carried over. */
    if (easy() && ["procedure", "clinical", "academic"].indexOf(e.kind) > -1) {
      var again = '<button class="pgl-btn ghost" data-pgl="log-again" data-id="' + attr(id) + '">' + ic("content_copy") + "Log again</button>";
      bar = bar ? bar.replace('<div class="pgl-actionbar">', '<div class="pgl-actionbar">' + again) : '<div class="pgl-actionbar">' + again + "</div>";
    }
    return wrap(h.join("")) + bar;
  }
  function auditLabel(a) {
    return { create: "Created", edit: "Edited", submit: "Submitted", verify: "Verified",
             return: "Returned", amend: "Amended", delete: "Deleted" }[a] || a;
  }

  /* ── ENTRIES list ────────────────────────────────────────────────────────── */
  function screenEntries() {
    var m = M(), st = ST();
    var all = arr(state.dash && state.dash.entries).concat(st ? st.drafts() : []);
    var f = state.filter;
    var rows = all.filter(function (e) {
      if (f.kind && e.kind !== f.kind) return false;
      if (f.status && e.status !== f.status) return false;
      return true;
    }).sort(function (a, b) { return String(b.occurredAt).localeCompare(String(a.occurredAt)); });
    var h = ['<div class="pgl-filters">'];
    h.push(chipFilter("kind", "", "All"));
    m.ENTRY_KINDS.forEach(function (k) { h.push(chipFilter("kind", k, k.charAt(0).toUpperCase() + k.slice(1))); });
    h.push("</div>");
    h.push('<div class="pgl-filters">');
    h.push(chipFilter("status", "", "Any status"));
    ["verified", "submitted", "returned", "draft"].forEach(function (s) { h.push(chipFilter("status", s, VSTATE[s][1])); });
    h.push("</div>");
    if (!rows.length) h.push(emptyState("search_off", "Nothing here", "No entry matches these filters."));
    else rows.forEach(function (e) { h.push(entryRow(e, String(e.id).indexOf("loc_") === 0)); });
    return wrap(h.join("")) +
      '<div class="pgl-actionbar"><button class="pgl-btn" data-pgl="go" data-r="add">' + ic("add") + "Add activity</button></div>";
  }
  function chipFilter(dim, val, label) {
    return '<button class="pgl-chip" data-pgl="filter" data-dim="' + dim + '" data-v="' + attr(val) + '" aria-pressed="' +
      (state.filter[dim] === val ? "true" : "false") + '">' + esc(label) + "</button>";
  }

  /* ── PROGRESS ────────────────────────────────────────────────────────────── */
  function screenProgress() {
    var h = [];
    var elig = state.eligibility;
    if (elig) {
      h.push('<div class="pgl-card"><h3>Examination pre-requisite checklist</h3>' +
        arr(elig.rows).map(function (x) {
          return '<div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--pgl-line)">' +
            ic(x.met === true ? "check_circle" : x.met === false ? "radio_button_unchecked" : "help") +
            "<div style=\"flex:1\"><div class=\"pgl-row-t\" style=\"font-size:13.5px\">" + esc(x.label) + "</div>" +
            '<div class="pgl-row-s">' + (x.detail ? esc(x.detail) + " · " : "") + prov(x.source, x.clause) +
            (x.advisory ? " <span class=\"pgl-clause\">advisory</span>" : "") + "</div></div></div>";
        }).join("") +
        '<div class="hint" style="margin-top:10px">' + esc(elig.disclaimer) + "</div></div>");
    }

    if (state.gaps.length) {
      h.push('<div class="pgl-sec-title"><span>Gaps</span><span>' + state.gaps.length + "</span></div>");
      state.gaps.forEach(function (g) {
        h.push('<div class="pgl-row" style="cursor:default">' +
          '<span class="pgl-row-ic">' + ic(g.severity === "high" ? "priority_high" : "schedule") + "</span>" +
          '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(g.label) + "</span>" +
          '<span class="pgl-row-s">' + esc(g.message) + " " + prov(g.source, g.clause) + "</span></span></div>");
      });
    }

    var groups = [["procedure", "Procedures"], ["academic", "Academic"], ["research", "Research"],
                  ["certification", "Certifications"], ["clinical", "Clinical"], ["reflection", "Reflection"],
                  ["rotation", "Rotations"], ["meta", "Logbook keeping"], ["attendance", "Attendance"]];
    groups.forEach(function (g) {
      var rows = state.progress.filter(function (p) { return p.kind === g[0]; });
      if (!rows.length) return;
      h.push('<div class="pgl-sec-title"><span>' + esc(g[1]) + "</span><span>" + rows.length + "</span></div>");
      rows.forEach(function (p) { h.push(progressRow(p)); });
    });

    if (state.dash && state.dash.attendance && flag("smd_pglog_attendance")) {
      var a = state.dash.attendance;
      h.push('<div class="pgl-card"><h3>Attendance</h3>' +
        '<div class="pgl-stats">' + stat(a.attendedDays, "Days attended") + stat(a.recordedDays, "Days recorded") +
        stat(a.pctOfWorkingDays == null ? "-" : a.pctOfWorkingDays + "%", "Of working days") + "</div>" +
        '<div class="pgl-row-s" style="margin-top:10px">Threshold ' + esc(String(a.thresholdPct)) + "% " + prov("nmc_regulation", "5.5") +
        (a.thresholdDays ? " · " + esc(String(a.thresholdDays)) + " days " + prov("nmc_faq_secondary", "PGMEB FAQ 10.04.2024") : "") + "</div>" +
        '<div class="hint" style="margin-top:8px">' + esc(a.note) + "</div></div>");
    }

    // Attendance left the resident's add list in easy mode (the institution records it); it is here.
    if (easy() && flag("smd_pglog_attendance")) h.push(navRow("attendance", "event_available", "Attendance", attendanceSubtitle()));
    var ai = AI();
    if (ai && ai.isOn()) {
      h.push('<button class="pgl-btn ghost wide" data-pgl="ai-summary" style="margin-top:14px">' + ic("auto_awesome") + "Draft a progress summary</button>");
      if (state.aiSummary) h.push(banner("ai", "auto_awesome", "<b>" + esc(state.aiSummary.label) + "</b><br>" + esc(state.aiSummary.text)));
    }
    return wrap(h.join(""));
  }

  /* ── ROTATIONS ───────────────────────────────────────────────────────────── */
  function screenRotations() {
    var m = M(), rows = arr(state.dash && state.dash.rotations);
    var res = state.dash && state.dash.resident;
    var h = [];
    var drpDays = m.drpDays(rows), drpMonths = m.drpMonths(rows), drpMet = m.drpMeetsThreeMonths(rows);
    h.push('<div class="pgl-card"><h3>District Residency Programme</h3>' +
      '<div class="pgl-row-s">' + esc(drpDays + " days (" + drpMonths.toFixed(1) + " months) of three calendar months recorded ") +
        prov("nmc_regulation", "5.2(xv)V") + "</div>" +
      '<div class="pgl-bar" data-state="' + (drpMet ? "met" : "behind") + '"><i style="width:' +
        Math.min(100, Math.round((drpDays / m.DRP_MIN_DAYS) * 100)) + '%"></i></div>' +
      '<div class="hint" style="margin-top:8px">A compulsory three-month rotation in a District Hospital / District Health System, ' +
      "in the 3rd, 4th or 5th semester. Satisfactory completion is an essential condition before the final examination (5.2(xv)VIII(c)).</div></div>");
    if (!rows.length) {
      h.push(emptyState("route", "No rotations recorded", "Your department records postings. Ask them to add your rotation schedule so entries can be linked to it."));
    }
    rows.forEach(function (rot) {
      var w = res ? m.drpWindowOk(rot, res, state.dash && state.dash.programme) : { ok: true };
      var active = rot.startDate && m.daysBetween(rot.startDate, todayISO()) >= 0 && (!rot.endDate || m.daysBetween(todayISO(), rot.endDate) >= 0);
      var count = arr(state.dash.entries).filter(function (e) { return e.rotationId === rot.id; });
      h.push('<div class="pgl-card tight"><div class="pgl-row-t">' + esc(rot.name) +
        (active ? ' <span class="pgl-vstate" data-s="submitted">' + ic("pin_drop") + "Current</span>" : "") + "</div>" +
        '<div class="pgl-row-s">' + esc(rot.startDate) + (rot.endDate ? " to " + esc(rot.endDate) : "") +
        " · " + esc(rot.kind) + (rot.unit || rot.externalSite ? " · " + esc(rot.unit || rot.externalSite) : "") + "</div>" +
        '<div class="pgl-row-s">' + count.length + " entries · " +
          count.filter(function (e) { return e.status === "verified"; }).length + " verified</div>" +
        (w.ok ? "" : banner("warn", "gavel", esc(w.warning) + " " + prov(w.source, w.clause))) +
        "</div>");
    });
    return wrap(h.join(""));
  }

  /* ── RESEARCH ────────────────────────────────────────────────────────────── */
  function screenResearch() {
    var m = M(), r = REP();
    var rows = arr(state.dash && state.dash.entries).filter(function (e) { return e.kind === "research"; });
    var done = {}; rows.forEach(function (e) { if (e.milestone && e.status === "verified") done[e.milestone] = e; });
    var chain = (state.dash && state.dash.programme && state.dash.programme.config && state.dash.programme.config.researchMilestones) || m.RESEARCH_MILESTONES;
    var h = [];
    h.push('<div class="pgl-card"><h3>Thesis milestones</h3>' +
      chain.map(function (x) {
        var e = done[x];
        return '<div style="display:flex;gap:9px;align-items:flex-start;padding:8px 0;border-bottom:1px solid var(--pgl-line)">' +
          ic(e ? "check_circle" : "radio_button_unchecked") +
          '<div style="flex:1"><div class="pgl-row-t" style="font-size:13.5px">' + esc(r.milestoneLabel(x)) + "</div>" +
          '<div class="pgl-row-s">' + (e ? esc(e.occurredAt) + " · verified" : "Not recorded") + "</div></div></div>";
      }).join("") +
      '<div class="hint" style="margin-top:10px">PGMER-2023 makes thesis a curriculum component (2.2(iii)) and gives it ' +
      "5% of the practical marks (8.1). It prescribes no milestone chain, this one is your institution's, and the " +
      "Academic Cell can change it.</div></div>");
    ["publication", "poster", "conference_paper", "additional_project"].forEach(function (st) {
      var sub = rows.filter(function (e) { return e.subtype === st; });
      if (!sub.length) return;
      h.push('<div class="pgl-sec-title"><span>' + esc({ publication: "Publications", poster: "Posters",
        conference_paper: "Conference papers", additional_project: "Additional projects" }[st]) + "</span><span>" + sub.length + "</span></div>");
      sub.forEach(function (e) { h.push(entryRow(e)); });
    });
    var elig = state.eligibility;
    if (elig) {
      var diss = arr(elig.rows).filter(function (x) { return x.key === "dissemination"; })[0];
      if (diss) {
        h.push('<div class="pgl-card"><h3>Examination pre-requisite</h3>' +
          '<div class="pgl-row-t" style="font-size:13.5px">' + esc(diss.label) + "</div>" +
          '<div class="pgl-row-s">' + (diss.met ? "Met via " + esc(diss.via) : "Not yet met") + " " + prov("nmc_regulation", "5.2(x)") + "</div>" +
          '<div class="hint" style="margin-top:8px">The regulation states this as <b>one</b> requirement with three alternatives ' +
          "(poster <b>or</b> paper read <b>or</b> first-author publication). Your specialty curriculum may ask for more; where it " +
          "does, it appears separately under Progress.</div></div>");
      }
    }
    return wrap(h.join("")) +
      '<div class="pgl-actionbar"><button class="pgl-btn" data-pgl="go" data-r="add/research">' + ic("add") + "Add research record</button></div>";
  }

  /* ── ATTENDANCE ──────────────────────────────────────────────────────────── */
  function screenAttendance() {
    var a = state.dash && state.dash.attendance;
    var h = [];
    if (!a) return wrap(errorState("Attendance is not available."));
    h.push('<div class="pgl-card"><div class="pgl-stats">' +
      stat(a.attendedDays, "Days attended") +
      stat(a.workingDaysElapsed, "Working days so far") +
      stat(a.pctOfWorkingDays == null ? "-" : a.pctOfWorkingDays + "%", "Of working days") +
      stat(a.requiredDays || "-", "Needed for the course") + "</div>" +
      '<div class="pgl-row-s" style="margin-top:10px">' +
        esc("The PGMEB FAQ defines the 80% as a percentage of WORKING days, calendar days minus 52 weekly offs a year. " +
            "A three-year course has " + (a.courseWorkingDays || 939) + " working days, of which 80% is " + (a.requiredDays || 751) + ".") +
        " " + prov("nmc_faq", "FAQ 10.04.2024 Q2") + "</div>" +
      (a.termExtension && a.termExtension.totalDays
        ? banner("info", "event_repeat", "Your training is extended by <b>" + a.termExtension.totalDays +
            " days</b> (" + a.termExtension.maternity + " maternity, " + a.termExtension.paternity +
            " paternity, " + a.termExtension.excessCasual + " excess casual leave). This does <b>not</b> " +
            "reduce your attendance percentage, it moves the end of training. " + prov("nmc_faq", "FAQ Q1, Q2"))
        : "") +
      '<div class="pgl-row-s" style="margin-top:12px">Threshold ' + esc(String(a.thresholdPct)) + "% " + prov("nmc_regulation", "5.5") + "</div>" +
      (a.thresholdDays ? '<div class="pgl-row-s">Day count ' + esc(String(a.thresholdDays)) + " " + prov("nmc_faq_secondary", "PGMEB FAQ 10.04.2024") + "</div>" : "") +
      '<div class="hint" style="margin-top:10px">' + esc(a.note) + "</div></div>");
    var counts = a.counts || {};
    h.push('<div class="pgl-card"><h3>By status</h3>' +
      Object.keys(counts).filter(function (k) { return counts[k]; }).map(function (k) {
        return '<div class="pgl-row-s" style="justify-content:space-between;padding:5px 0"><span>' + esc(k.replace(/_/g, " ")) +
          "</span><b>" + counts[k] + "</b></div>";
      }).join("") + "</div>");
    h.push(banner("info", "policy",
      "PGMER-2023 5.5 also sets your entitlements: a minimum of <b>20 days paid leave per year</b> (5.5(a)), " +
      "<b>one weekly holiday</b> subject to exigencies (5.5(b)) and <b>5 days academic leave per year</b> (5.5(e)). " +
      "This module records what you enter; it does not approve or refuse leave."));
    return wrap(h.join("")) +
      '<div class="pgl-actionbar"><button class="pgl-btn" data-pgl="go" data-r="add/attendance">' + ic("add") + "Record attendance</button></div>";
  }

  /* ── REPORTS ─────────────────────────────────────────────────────────────── */
  var REPORT_LIST = [
    ["resident_logbook", "receipt_long", "Individual logbook", "The complete record, in date order"],
    ["progress_report", "insights", "Training progress", "Against the applicable NMC requirements"],
    ["procedure_report", "content_cut", "Procedures and operations", "Consolidated, in the NMC's own columns"],
    ["clinical_report", "stethoscope", "Clinical activity", "OPD, inpatient and emergency"],
    ["academic_report", "school", "Academic activity", "Seminars, journal clubs, teaching"],
    ["research_report", "science", "Research and thesis", "Milestones, publications, presentations"],
    ["rotation_report", "route", "Rotations", "Including the District Residency Programme"],
    ["assessment_report", "fact_check", "Assessments", "Formative assessment and outcomes"],
    ["feedback_report", "forum", "Faculty feedback", "Narrative feedback and returns"],
    ["final_portfolio", "menu_book", "Final training portfolio", "Everything, in examiner order"],
    ["certified_logbook", "verified_user", "Certified logbook", "The signed document, with its verification QR"]
  ];
  /* ── Quick log — the 15-to-20-second path ────────────────────────────────────────────────
   * Three taps and Save: what, which rung of the role ladder, done. Everything else is a default
   * the resident can see and change. It writes the same draft the long form writes, through the
   * same store and the same validation - see pglog-quick.js for why that matters. */
  function quickState() {
    if (!state.quick) {
      var st = ST(), prefs = (st && st.prefs()) || {};
      state.quick = {
        kind: prefs.lastKind === "academic" ? "academic" : (prefs.lastKind || "procedure"),
        query: "", title: "", role: "", setting: "",
        // Easy mode prefills the resident's GUIDE (the person their entries go to), shown by name.
        supervisor: easy() ? (guideOf() || prefs.lastSupervisor || "") : (prefs.lastSupervisor || ""),
        date: todayISO(), supEdit: false,
        complications: [], notes: "", heard: [], photos: [], listening: false, saving: false
      };
    }
    return state.quick;
  }
  function screenQuick() {
    var q = quickState(), qk = QK(), m = M();
    if (!qk || !m) return wrap(errorState("The quick logger is still loading."));
    var spec = specialtyId();
    var kinds = [["procedure", "content_cut", "Procedure"], ["clinical", "stethoscope", "Case"], ["academic", "school", "Academic"]];
    var h = [];

    h.push('<div class="pgl-quick-head">' +
      '<div class="pgl-quick-t">Log it now</div>' +
      '<div class="pgl-quick-s">' + (easy() ? "Three taps. It goes to your guide to verify." :
        "Three taps. It saves as a draft on this device and goes to your guide when you submit.") + "</div></div>");

    if (easy()) {
      // When: Today / Yesterday / a date. Most entries are made the same day or the next morning.
      var yday = m.addDays ? m.addDays(todayISO(), -1) : "";
      var dsel = q.date || todayISO();
      var other = dsel !== todayISO() && dsel !== yday;
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">When</div><div class="pgl-chips">' +
        '<button class="pgl-chip sm' + (dsel === todayISO() ? " on" : "") + '" data-pgl="q-date" data-v="today" aria-pressed="' + (dsel === todayISO()) + '">Today</button>' +
        '<button class="pgl-chip sm' + (dsel === yday ? " on" : "") + '" data-pgl="q-date" data-v="yesterday" aria-pressed="' + (dsel === yday) + '">Yesterday</button>' +
        '<label class="pgl-chip sm pgl-datepick' + (other ? " on" : "") + '">' + ic("event") + "<span>" + esc(other ? dsel : "Pick a date") + "</span>" +
          '<input id="pglQuickDate" type="date" max="' + attr(todayISO()) + '" value="' + attr(dsel) + '" aria-label="Pick a date"></label>' +
        "</div></div>");
    }

    // 1 — what kind
    h.push('<div class="pgl-qsec"><div class="pgl-qlbl">1 · What are you logging?</div><div class="pgl-chips">' +
      kinds.map(function (k) {
        return '<button class="pgl-chip' + (q.kind === k[0] ? " on" : "") + '" data-pgl="q-kind" data-v="' + k[0] + '" aria-pressed="' + (q.kind === k[0]) + '">' +
          ic(k[1]) + esc(k[2]) + "</button>";
      }).join("") + "</div></div>");

    // 2 — what, from this specialty's own list
    var list = qk.search(spec, q.kind, q.query, recentsFor(q.kind), 12);
    h.push('<div class="pgl-qsec"><div class="pgl-qlbl">2 · ' +
      (q.kind === "procedure" ? "Which procedure?" : q.kind === "academic" ? "Which activity?" : "What did you see?") + "</div>");
    h.push('<div class="pgl-qsearch">' + ic("search") +
      '<input id="pglQuickQ" type="text" autocomplete="off" placeholder="' +
      attr(q.kind === "procedure" ? "Type or pick below" : "Type or pick below") + '" value="' + attr(q.query) + '">' +
      (voiceAvailable() ? '<button class="pgl-qmic' + (q.listening ? " on" : "") + '" data-pgl="q-mic" aria-label="Dictate this entry">' + ic(q.listening ? "graphic_eq" : "mic") + "</button>" : "") +
      "</div>");
    if (q.title) {
      h.push('<div class="pgl-qpicked">' + ic("check_circle") + "<b>" + esc(q.title) + "</b>" +
        '<button class="pgl-qclear" data-pgl="q-unpick" aria-label="Choose something else">' + ic("close") + "</button></div>");
    } else {
      h.push('<div class="pgl-qlist">' + list.map(function (it) {
        return '<button class="pgl-qitem' + (it.recent ? " recent" : "") + '" data-pgl="q-pick" data-v="' + attr(it.title) + '">' +
          (it.recent ? ic("history") : ic("add")) + "<span>" + esc(it.title) + "</span></button>";
      }).join("") + "</div>");
      if (q.query && !list.length) {
        h.push('<button class="pgl-qitem" data-pgl="q-pick" data-v="' + attr(q.query) + '">' + ic("edit") + "<span>Use &ldquo;" + esc(q.query) + "&rdquo;</span></button>");
      }
    }
    h.push("</div>");

    // 3 — the role ladder. Never defaulted: this is the claim the examiner relies on.
    if (q.kind !== "academic") {
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">3 · Your role</div><div class="pgl-chips">' +
        m.ROLES.map(function (r) {
          return '<button class="pgl-chip' + (q.role === r ? " on" : "") + '" data-pgl="q-role" data-v="' + r + '" aria-pressed="' + (q.role === r) + '">' +
            esc(m.ROLE_LABEL[r] || r) + "</button>";
        }).join("") + "</div></div>");
    }

    // The defaults, visible and changeable, in one compact strip.
    var st = ST(), prefs = (st && st.prefs()) || {};
    var setting = q.setting || (q.kind === "procedure" ? "ot" : (prefs.lastSetting || "opd"));
    var SET_LABEL = { opd: "OPD", ipd: "Ward / IPD", emergency: "Emergency", ot: "Theatre", daycare: "Day care", bedside: "Bedside" };
    var settings = q.kind === "procedure" ? ["ot", "opd", "ipd", "emergency", "bedside"] : ["opd", "ipd", "emergency"];
    h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Where</div><div class="pgl-chips">' +
      settings.map(function (sx) {
        return '<button class="pgl-chip sm' + (setting === sx ? " on" : "") + '" data-pgl="q-setting" data-v="' + sx + '">' + esc(SET_LABEL[sx] || sx) + "</button>";
      }).join("") + "</div></div>");

    if (easy()) {
      h.push(quickSupervisorHtml(q, prefs));
    } else if (q.kind === "procedure" && quickNeedsSupervisor()) {
      // PGMER-2023 5.2(vi): for MS and MCh a procedure entry must name the supervising consultant.
      // The quick path asks for it here rather than bouncing the resident into the long form.
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Supervising consultant</div>' +
        '<input id="pglQuickSup" class="pgl-qinput" type="text" placeholder="Who supervised this?" value="' + attr(q.supervisor || prefs.lastSupervisor || "") + '">' +
        '<div class="pgl-qhint">Required for ' + esc(((state.dash && state.dash.programme) || {}).degree || "this degree") +
        " procedure entries. It is remembered for your next entry.</div></div>");
    }
    if (q.kind === "procedure") {
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Complications</div>' +
        '<div class="pgl-chips"><button class="pgl-chip sm' + (q.complications.length ? "" : " on") + '" data-pgl="q-nocomp">None</button></div>' +
        '<input id="pglQuickComp" class="pgl-qinput" type="text" placeholder="If any, comma separated" value="' + attr(q.complications.join(", ")) + '"></div>');
    }

    // Photographs — consent-gated, device-local. See pglog-photos.js.
    h.push(quickPhotosHtml(q));

    h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Note <span style="opacity:.6">· optional</span></div>' +
      '<textarea id="pglQuickNote" class="pgl-qinput" rows="2" placeholder="Anything worth remembering about this case">' + esc(q.notes) + "</textarea></div>");

    if (q.heard.length) {
      h.push('<div class="pgl-banner" data-t="ai">' + ic("hearing") + "<div><b>Heard:</b> " +
        q.heard.map(function (x) { return esc(x.field) + " = " + esc(x.phrase); }).join(" · ") +
        ". Check each field before you save.</div></div>");
    }

    var draft = qk.quickDraft({
      kind: q.kind, title: q.title || q.query, role: q.role, setting: setting,
      complications: q.complications, notes: q.notes, occurredAt: q.date || todayISO()
    }, { prefs: prefs, today: todayISO(), localId: st ? st.localId() : "loc_tmp",
      residentId: (state.dash && state.dash.resident && state.dash.resident.id) || "",
      programmeId: (state.dash && state.dash.programme && state.dash.programme.id) || "" });
    var needSup = quickNeedsSupervisor();
    if (easy()) draft.supervisor = q.supervisor || "";
    else if (q.supervisor || prefs.lastSupervisor) draft.supervisor = q.supervisor || prefs.lastSupervisor;
    var missing = qk.missingFor(draft, { requiresSupervisor: needSup && q.kind === "procedure" });
    var ready = missing.length === 0;

    var bar = '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="go" data-r="add">' + ic("tune") + "Full form</button>" +
      '<button class="pgl-btn" data-pgl="q-save"' + (ready ? "" : " disabled") + ">" + ic("bolt") +
      (ready ? "Save entry"
        : missing.indexOf("title") >= 0 ? "Pick what you did"
        : missing.indexOf("role") >= 0 ? "Choose your role"
        : missing.indexOf("supervisor") >= 0 ? "Name your supervisor" : "One more field") + "</button></div>";
    return wrap(h.join("")) + bar;
  }

  /* Who gets it, as a NAME. MS / M.Ch procedures must name the supervising consultant (PGMER-2023
   * 5.2(vi)); for everyone else it is the guide unless the resident changes it, and the server falls
   * back to the guide when no supervisor is sent, so an MD resident is never asked. */
  function quickSupervisorHtml(q, prefs) {
    var must = q.kind === "procedure" && quickNeedsSupervisor();
    var roster = arr(state.roster), guide = guideOf();
    var lbl = must ? "Supervising consultant" : "Goes to";
    if (q.supEdit || (must && !q.supervisor)) {
      var ctl = roster.length
        ? '<select id="pglQuickSupSel" class="pgl-qinput"><option value="">' + (must ? "Choose" : "My guide") + "</option>" +
          roster.map(function (r) {
            return '<option value="' + attr(r.identity) + '"' + (sameId(q.supervisor, r.identity) ? " selected" : "") + ">" +
              esc(rosterLabel(r)) + (r.role === "pg_hod" ? " (HOD)" : "") + (guide && sameId(guide, r.identity) ? " · your guide" : "") + "</option>";
          }).join("") + "</select>"
        : '<input id="pglQuickSup" class="pgl-qinput" type="text" placeholder="Who supervised this?" value="' + attr(q.supervisor || "") + '">';
      return '<div class="pgl-qsec"><div class="pgl-qlbl">' + lbl + "</div>" + ctl +
        '<div class="pgl-qhint">' + (must ? "Required for " + esc(((state.dash && state.dash.programme) || {}).degree || "this degree") +
          " procedure entries. It is remembered for next time." : "Leave it as your guide unless someone else supervised this.") + "</div></div>";
    }
    if (q.supervisor) {
      return '<div class="pgl-qsec"><div class="pgl-qlbl">' + lbl + "</div>" +
        '<button class="pgl-supchip" data-pgl="q-sup-change">' + ic("person") + "<b>" + esc(personName(q.supervisor)) + "</b>" +
        (guide && sameId(guide, q.supervisor) ? "<small>your guide</small>" : "") + '<span class="chg">Change</span></button></div>';
    }
    return '<div class="pgl-qsec"><div class="pgl-qlbl">' + lbl + "</div>" +
      '<button class="pgl-supchip" data-pgl="q-sup-change">' + ic("person") + "<b>Your guide</b>" +
      '<span class="chg">Pick someone else</span></button></div>';
  }

  function quickPhotosHtml(q) {
    var ph = PH();
    if (!ph || !ph.available()) return "";
    var shots = q.photos.map(function (p, i) {
      return '<div class="pgl-qshot">' + ic("image") + "<span>Photo " + (i + 1) + "</span>" +
        '<button data-pgl="q-photo-del" data-v="' + attr(p.id) + '" aria-label="Remove photograph">' + ic("close") + "</button></div>";
    }).join("");
    return '<div class="pgl-qsec"><div class="pgl-qlbl">Clinical photograph <span style="opacity:.6">· optional</span></div>' +
      (shots ? '<div class="pgl-qshots">' + shots + "</div>" : "") +
      '<button class="pgl-btn ghost" data-pgl="q-photo">' + ic("photo_camera") + "Add a photograph</button>" +
      '<div class="pgl-qhint">' + esc(ph.STORAGE_WARNING) + "</div></div>";
  }

  /* Keep the Save button honest without a re-render: same question missingFor() answers. */
  function quickSyncSaveButton() {
    var q = state.quick, qk = QK(), st = ST();
    if (!q || !qk || !st) return;
    var btn = document.querySelector('#pglogRoot [data-pgl="q-save"]');
    if (!btn) return;
    var prefs = st.prefs() || {};
    var draft = qk.quickDraft({
      kind: q.kind, title: q.title || q.query, role: q.role,
      setting: q.setting || (q.kind === "procedure" ? "ot" : (prefs.lastSetting || "opd")),
      complications: q.complications, notes: q.notes,
      supervisor: q.supervisor || prefs.lastSupervisor || ""
    }, { prefs: prefs, today: todayISO(), localId: "loc_preview" });
    var missing = qk.missingFor(draft, { requiresSupervisor: quickNeedsSupervisor() && q.kind === "procedure" });
    var ready = missing.length === 0;
    btn.disabled = !ready;
    var label = ready ? "Save entry"
      : missing.indexOf("title") >= 0 ? "Pick what you did"
      : missing.indexOf("role") >= 0 ? "Choose your role"
      : missing.indexOf("supervisor") >= 0 ? "Name your supervisor" : "One more field";
    var txtNode = btn.lastChild;
    if (txtNode && txtNode.nodeType === 3) txtNode.nodeValue = label;
  }
  /* Retype the suggestion list under the search box without touching the input itself. */
  function quickSyncList() {
    var q = state.quick, qk = QK();
    if (!q || !qk || q.title) return;
    var host = document.querySelector("#pglogRoot .pgl-qlist");
    if (!host) return;
    var list = qk.search(specialtyId(), q.kind, q.query, recentsFor(q.kind), 12);
    host.innerHTML = list.map(function (it) {
      return '<button class="pgl-qitem' + (it.recent ? " recent" : "") + '" data-pgl="q-pick" data-v="' + attr(it.title) + '">' +
        (it.recent ? ic("history") : ic("add")) + "<span>" + esc(it.title) + "</span></button>";
    }).join("") || '<button class="pgl-qitem" data-pgl="q-pick" data-v="' + attr(q.query) + '">' + ic("edit") + "<span>Use &ldquo;" + esc(q.query) + "&rdquo;</span></button>";
  }
  function quickNeedsSupervisor() {
    var m = M(); if (!m || !m.requiresProcedureLog) return false;
    var prog = (state.dash && state.dash.programme) || (state.ctx && state.ctx.programme) || {};
    return !!m.requiresProcedureLog(prog.degree);
  }
  function voiceAvailable() {
    try { return !!(window.SMD_VOICE && window.SMD_VOICE.listen); } catch (e) { return false; }
  }

  /* ── Analytics — the numbers, counted rather than estimated ─────────────────────────────── */
  function analyticsEntries() {
    var d = state.dash || {};
    var list = arr(d.entries);
    if (!list.length && d.recent) list = arr(d.recent);
    return list;
  }
  function screenAnalytics() {
    var an = AN(), m = M();
    if (!an) return wrap(errorState("The analytics engine is still loading."));
    var entries = analyticsEntries();
    if (!entries.length) {
      return wrap(banner("info", "insights",
        "Nothing to count yet. Log a few cases and this page shows your real numbers: what you have seen, " +
        "how often you did it yourself, and how that is changing year on year."));
    }
    var res = (state.dash && state.dash.resident) || {};
    var startYear = String(res.startDate || "").slice(0, 4);
    var d = an.dashboard(entries, {
      yearOf: startYear ? function (e) {
        var y = String(e.occurredAt || "").slice(0, 4);
        if (!y) return "";
        var n = (Number(y) - Number(startYear)) + 1;
        return n >= 1 ? ("Year " + n) : "";
      } : null,
      limit: 8
    });
    var h = [];

    h.push('<div class="pgl-stats">' +
      stat(d.caseload.total, "Verified entries") +
      stat(d.procedures.total, "Procedures") +
      stat(d.caseload.perMonth == null ? "-" : d.caseload.perMonth, "Per month") +
      stat(d.unverified, "Not yet verified") +
      "</div>");

    // Independence — the question a guide actually asks.
    h.push('<div class="pgl-card"><div class="pgl-row-t">Doing it yourself</div>' +
      '<div class="pgl-row-s">' + (d.independence.basis === "training_year" ? "By training year" : "By calendar year") +
      " · procedures with a role recorded</div>");
    if (!d.independence.years.length) {
      h.push('<div class="pgl-row-s" style="margin-top:8px">No verified procedure carries a role yet.</div>');
    } else {
      h.push('<div class="pgl-bars">' + d.independence.years.map(function (y) {
        var pct = y.independentShare == null ? 0 : y.independentShare;
        return '<div class="pgl-bar"><span class="pgl-bar-l">' + esc(y.year) + "</span>" +
          '<span class="pgl-bar-t"><span style="width:' + pct + '%"></span></span>' +
          '<span class="pgl-bar-v">' + (y.independentShare == null ? "-" : y.independentShare + "%") +
          '<small>' + y.n + (y.lowN ? " cases · few" : " cases") + "</small></span></div>";
      }).join("") + "</div>");
      var dir = { rising: "Rising: you are operating independently more often than last year.",
        falling: "Falling: you logged a smaller share independently than last year.",
        flat: "Level with last year.", insufficient_data: "Not enough years logged to show a trend yet." };
      h.push('<div class="pgl-row-s" style="margin-top:8px">' + esc(dir[d.independence.direction] || "") + "</div>");
    }
    h.push("</div>");

    // Complications — rule 2 of pglog-analytics: a rate with no denominator is not shown.
    h.push('<div class="pgl-card"><div class="pgl-row-t">Complications recorded</div>');
    if (!d.complications) {
      h.push('<div class="pgl-row-s">No verified procedures yet.</div>');
    } else {
      var c = d.complications;
      h.push('<div class="pgl-bignum">' + (c.pct == null ? (c.withComplication + " of " + c.n) : (c.pct + "%")) + "</div>" +
        '<div class="pgl-row-s">' + (c.lowN
          ? ("Shown as a count, not a percentage: " + c.n + " procedures is too few for a rate to mean anything.")
          : (c.withComplication + " of " + c.n + " procedures")) + "</div>");
      if (c.types.length) {
        h.push('<div class="pgl-taglist">' + c.types.slice(0, 8).map(function (t) {
          return '<span class="pgl-tag">' + esc(t.complication) + " · " + t.n + "</span>";
        }).join("") + "</div>");
      }
      h.push('<div class="pgl-qhint">' + esc(c.disclaimer) + "</div>");
    }
    h.push("</div>");

    // What they see most.
    if (d.topProcedures.length) h.push(topCard("Procedures you log most", d.topProcedures, m));
    if (d.topDiagnoses.length) h.push(topCard("Presentations you see most", d.topDiagnoses, m));

    // Caseload by month.
    if (d.caseload.months.length > 1) {
      var max = d.caseload.months.reduce(function (a, x) { return Math.max(a, x.n); }, 0) || 1;
      h.push('<div class="pgl-card"><div class="pgl-row-t">Month by month</div>' +
        '<div class="pgl-spark">' + d.caseload.months.map(function (mm) {
          return '<span title="' + attr(mm.month + ": " + mm.n) + '" style="height:' + Math.max(3, Math.round(mm.n / max * 100)) + '%"></span>';
        }).join("") + "</div>" +
        '<div class="pgl-row-s">' + esc(d.caseload.months[0].month) + " to " + esc(d.caseload.months[d.caseload.months.length - 1].month) +
        (d.caseload.busiestMonth ? " · busiest " + esc(d.caseload.busiestMonth.month) + " (" + d.caseload.busiestMonth.n + ")" : "") + "</div></div>");
    }

    h.push(banner("info", "fact_check",
      "Counted from verified entries only. An entry your guide has not verified is a claim, not a record, " +
      "so it is listed above as “not yet verified” and left out of every figure on this page."));

    var bar = '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="csv" data-id="all">' + ic("table_view") + "Export CSV</button>" +
      '<button class="pgl-btn ghost" data-pgl="go" data-r="reports">' + ic("description") + "Reports</button></div>";
    return wrap(h.join("")) + bar;
  }
  function topCard(title, rows, m) {
    var max = rows.reduce(function (a, r) { return Math.max(a, r.n); }, 0) || 1;
    return '<div class="pgl-card"><div class="pgl-row-t">' + esc(title) + "</div>" +
      '<div class="pgl-bars">' + rows.map(function (r) {
        var ind = (r.roles && r.roles.performed_independent) || 0;
        return '<div class="pgl-bar"><span class="pgl-bar-l">' + esc(r.title) + "</span>" +
          '<span class="pgl-bar-t"><span style="width:' + Math.round(r.n / max * 100) + '%"></span></span>' +
          '<span class="pgl-bar-v">' + r.n + (ind ? '<small>' + ind + " solo</small>" : "") + "</span></div>";
      }).join("") + "</div></div>";
  }

  /* ── Backup to the resident's own Google Drive ─────────────────────────────────────────── */
  function screenBackup() {
    var bk = BK();
    if (!bk) return wrap(errorState("Backup is still loading."));
    var s = bk.status();
    var h = [];
    h.push('<div class="pgl-card"><div class="pgl-row-t">Backup to your Google Drive</div>' +
      '<div class="pgl-row-s">' + esc(bk.describe()) + "</div></div>");
    if (!s.available) {
      h.push(banner("warn", "cloud_off", "This needs the StewardMD app on your phone, signed in to Google."));
      return wrap(h.join(""));
    }
    h.push(banner("info", "lock",
      "The file in your Drive is encrypted with a password only you know. StewardMD never sees it and keeps no " +
      "copy, so there is no way to recover the backup if you forget it. Your drafts and your clinical " +
      "photographs are what this protects: they exist only on this phone until they are backed up."));
    if (!s.configured) {
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Choose a backup password</div>' +
        '<input id="pglBkP1" class="pgl-qinput" type="password" autocomplete="new-password" placeholder="At least 8 characters">' +
        '<input id="pglBkP2" class="pgl-qinput" type="password" autocomplete="new-password" placeholder="Type it again" style="margin-top:8px"></div>');
      h.push('<div class="pgl-actionbar"><button class="pgl-btn" data-pgl="bk-setup">' + ic("lock") + "Set up backup</button></div>");
      return wrap(h.join(""));
    }
    if (!s.unlocked) {
      h.push('<div class="pgl-qsec"><div class="pgl-qlbl">Enter your backup password</div>' +
        '<input id="pglBkP1" class="pgl-qinput" type="password" autocomplete="current-password" placeholder="Backup password"></div>');
      h.push('<div class="pgl-actionbar"><button class="pgl-btn" data-pgl="bk-unlock">' + ic("lock_open") + "Unlock</button></div>");
      return wrap(h.join(""));
    }
    h.push('<label class="pgl-switch"><input type="checkbox" data-pgl="bk-auto"' + (s.auto ? " checked" : "") + ">" +
      "<span><b>Back up automatically</b><small>While the app is open and unlocked, changes are backed up in the " +
      "background. It locks again when you close the app, because the password is never stored.</small></span></label>");
    if (s.lastCounts) {
      h.push('<div class="pgl-stats">' + stat(s.lastCounts.drafts || 0, "Drafts") + stat(s.lastCounts.photos || 0, "Photographs") +
        stat(s.lastCounts.onServer || 0, "Already on the server") + "</div>");
    }
    h.push('<div class="pgl-actionbar">' +
      '<button class="pgl-btn"' + (state.backupBusy ? " disabled" : "") + ' data-pgl="bk-now">' + ic("cloud_upload") + (state.backupBusy ? "Working…" : "Back up now") + "</button>" +
      '<button class="pgl-btn ghost" data-pgl="bk-restore">' + ic("cloud_download") + "Restore</button></div>");
    return wrap(h.join(""));
  }

  function screenReports() {
    var h = REPORT_LIST.map(function (r) {
      return '<button class="pgl-row" data-pgl="go" data-r="report/' + r[0] + '">' +
        '<span class="pgl-row-ic">' + ic(r[1]) + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(r[2]) + "</span>" +
        '<span class="pgl-row-s">' + esc(r[3]) + "</span></span>" + ic("chevron_right") + "</button>";
    });
    if (canDept()) {
      h.unshift('<button class="pgl-row" data-pgl="go" data-r="report/department_summary">' +
        '<span class="pgl-row-ic">' + ic("corporate_fare") + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">Department summary</span>' +
        '<span class="pgl-row-s">Progress across residents, no clinical detail</span></span>' + ic("chevron_right") + "</button>");
    }
    h.push(banner("info", "shield_person",
      "Reports carry their verification state: which entries are verified, by whom, which months your guide " +
      "authenticated, and how many records were amended. Patient references appear only in your own logbook " +
      "and procedure report, and never in a department or institution document."));
    return wrap(h.join(""));
  }

  function screenReport(id) {
    var rep = buildReport(id);
    if (!rep) return wrap(errorState("That report is not available yet."));
    return (state.includeCaseRef ? '<div data-phi-unmasked>' + wrap(REP().toHtml(rep)) + "</div>" : wrap(REP().toHtml(rep))) +
      '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="print" data-id="' + attr(id) + '">' + ic("print") + "Print / PDF</button>" +
      // CSV is the format a department re-analyses in a spreadsheet; Excel needs the BOM, which
      // exportCsv adds. Offered on the entry-level reports, where rows exist to export.
      ((id === "resident_logbook" || id === "procedure_report" || id === "clinical_report")
        ? '<button class="pgl-btn ghost" data-pgl="csv" data-id="' + attr(id === "procedure_report" ? "procedure" : id === "clinical_report" ? "clinical" : "all") + '">' + ic("table_view") + "CSV / Excel</button>"
        : "") +
      '<button class="pgl-btn ghost" data-pgl="share" data-id="' + attr(id) + '">' + ic("ios_share") + "Share</button>" +
      (id === "resident_logbook" || id === "procedure_report"
        ? '<button class="pgl-btn ghost" data-pgl="toggle-ref" data-id="' + attr(id) + '">' +
          ic(state.includeCaseRef ? "visibility_off" : "visibility") + (state.includeCaseRef ? "Hide refs" : "Show refs") + "</button>"
        : "") +
      "</div>";
  }
  function buildReport(id) {
    var r = REP(), m = M();
    if (!r) return null;
    /* BEFORE the state.dash guard. The department summary is a REVIEWER's document, and a guide,
     * HOD or Academic Cell has no resident record - so state.dash is null for exactly the people
     * this report is for, and it returned "not available yet" every time. It needs state.dept, which
     * the navigation path now loads. orgName, not orgId: this prints in the header. */
    if (id === "department_summary") {
      if (!state.dept) return null;
      return r.departmentSummary({
        residents: state.dept.residents, today: todayISO(),
        departmentName: state.deptFilter.departmentId,
        orgName: (state.ctx && state.ctx.orgName) || (ST() ? ST().context().orgId : ""),
      });
    }
    if (!state.dash) return null;
    var res = state.dash.resident;
    var ctx = {
      resident: res, programme: state.dash.programme, entries: state.dash.entries,
      rotations: state.dash.rotations, assessments: state.dash.assessments,
      months: state.dash.months, attestations: state.dash.attestations || [],
      attendance: state.dash.attendance, weekly: state.dash.weekly,
      requirementProgress: state.progress, gaps: state.gaps, eligibility: state.eligibility,
      procedureCatalog: state.pack ? state.pack.procedureCatalog : [],
      today: todayISO(), // The NAME, not the database id. This printed "349cdc32210144cca031cccd1e0e20d4" in the header of
      // a document a resident hands to their university. /me already returns orgName.
      orgName: (state.ctx && state.ctx.orgName) || (res && res.orgId),
      departmentName: (res && (res.departmentName || res.departmentId))
    };
    var opts = { includeCaseRef: !!state.includeCaseRef };
    var fn = {
      resident_logbook: function () { return r.residentLogbook(ctx, opts); },
      progress_report: function () { return r.progressReport(ctx); },
      procedure_report: function () { return r.procedureReport(ctx, opts); },
      clinical_report: function () { return r.clinicalReport(ctx, opts); },
      academic_report: function () { return r.academicReport(ctx); },
      research_report: function () { return r.researchReport(ctx); },
      rotation_report: function () { return r.rotationReport(ctx); },
      assessment_report: function () { return r.assessmentReport(ctx); },
      feedback_report: function () { return r.feedbackReport(ctx); },
      final_portfolio: function () { return r.finalPortfolio(ctx); },
      certified_logbook: function () { return r.certifiedLogbook(Object.assign({}, ctx, { certificate: state.cert })); }
    }[id];
    return fn ? fn() : null;
  }

  /* ── FACULTY ─────────────────────────────────────────────────────────────── */
  function canFaculty() { return arr(state.ctx && state.ctx.caps).indexOf("pglog.verify") > -1 || arr(state.ctx && state.ctx.caps).indexOf("pglog.view.assigned") > -1; }
  function canDept() { return arr(state.ctx && state.ctx.caps).indexOf("pglog.view.dept") > -1 || arr(state.ctx && state.ctx.caps).indexOf("pglog.view.institution") > -1; }

  function countOf(x) { return Array.isArray(x) ? x.length : (Number(x) || 0); }
  function residentRowFor(id) {
    var lists = [arr(state.faculty && state.faculty.residents), arr(state.dept && state.dept.residents)];
    for (var i = 0; i < lists.length; i++) {
      var x = lists[i].filter(function (y) { return (y.resident || {}).id === id; })[0];
      if (x) return x;
    }
    return null;
  }
  function residentNameFor(id, e) {
    if (e && e.residentName) return e.residentName;
    var x = residentRowFor(id);
    return (x && x.resident && x.resident.name) || "Resident " + String(id || "").slice(0, 6);
  }
  function canSignNow() { var sg = state.ctx && state.ctx.signer; return !sg || sg.ok; }

  /* GUIDE BATCH REVIEW (easy mode). The queue is grouped by resident and then by month, because
   * that is how a guide thinks about it and how PGMER-2023 5.2(vii) asks them to sign. "Verify
   * selected" is only a loop over the existing single-entry verify call, one at a time: every entry
   * still gets its own server-side signature, its own registration stamp and its own audit row, and
   * the self-verify / named-guide / registration gates run for each one exactly as before. */
  function screenFacultyEasy(f) {
    var h = [];
    h.push(signerBanner());
    var due = arr(f.residents).reduce(function (a, x) { return a + countOf(x.attestationOverdue); }, 0);
    h.push('<div class="pgl-stats">' +
      stat(arr(f.pending).length, "To verify") +
      stat(arr(f.residents).length, "Residents") +
      stat(due, "Months to authenticate") + "</div>");
    if (arr(f.overdue).length) {
      h.push(banner("warn", "hourglass_bottom",
        "<b>" + arr(f.overdue).length + " entries</b> have waited more than " + fint("smd_pglog_verify_sla_days") +
        " days. <span class=\"pgl-clause\">Your institution's target, not an NMC rule.</span>"));
    }
    // resident -> { name, months: { period: { entries:[], due } } }
    var groups = {}, order = [];
    function g(id, name) {
      if (!groups[id]) { groups[id] = { id: id, name: name, months: {} }; order.push(id); }
      return groups[id];
    }
    arr(f.pending).forEach(function (e) {
      var gr = g(e.residentId, residentNameFor(e.residentId, e));
      var p = monthOf(e) || "unknown";
      (gr.months[p] = gr.months[p] || { entries: [], due: false }).entries.push(e);
    });
    arr(f.residents).forEach(function (x) {
      var r = x.resident || {};
      arr(x.attestationOverdue).forEach(function (p) {
        var gr = g(r.id, r.name || residentNameFor(r.id));
        (gr.months[p] = gr.months[p] || { entries: [], due: false }).due = true;
      });
    });
    if (!order.length) {
      h.push(emptyState("task_alt", "Nothing waiting", "Every entry submitted to you has been reviewed, and every completed month is signed."));
    }
    order.sort(function (a, b) { return String(groups[a].name).localeCompare(String(groups[b].name)); });
    order.forEach(function (rid) {
      var gr = groups[rid];
      var n = Object.keys(gr.months).reduce(function (a, p) { return a + gr.months[p].entries.length; }, 0);
      h.push('<div class="pgl-sec-title pgl-resgrp"><span>' + esc(gr.name) + "</span><span>" + n + " to verify</span></div>");
      Object.keys(gr.months).sort().forEach(function (p) {   // oldest first: months are signed in order
        h.push(monthCard(rid, gr.name, p, gr.months[p].entries, gr.months[p].due));
      });
    });
    if (arr(f.residents).length) {
      h.push('<div class="pgl-sec-title"><span>Your residents</span><span>' + arr(f.residents).length + "</span></div>");
      arr(f.residents).forEach(function (x) {
        h.push('<button class="pgl-row" data-pgl="go" data-r="resident/' + attr(x.resident.id) + '">' +
          '<span class="pgl-row-ic">' + ic("person") + "</span>" +
          '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(x.resident.name || x.resident.id) + "</span>" +
          '<span class="pgl-row-s">Year ' + esc(String(x.resident.trainingYear || "")) +
          " · " + esc(String((x.summary || {}).verified || 0)) + " verified" +
          (countOf(x.attestationOverdue) ? " · " + countOf(x.attestationOverdue) + " month(s) to sign" : "") +
          (x.needsGuide ? " · needs a guide" : "") +
          "</span></span>" + ic("chevron_right") + "</button>");
      });
    }
    h.push(whyBox("The guide checks and authenticates the logbook every month (PGMER-2023 5.2(vii)). Verifying signs each entry " +
      "with your council registration; authenticating a month records it against that month."));
    return wrap(h.join(""));
  }

  /* One month of one resident: its entries, checkboxes on the ones still waiting, Verify selected,
   * then Authenticate month. Used by the faculty queue and by the resident detail screen. */
  function monthCard(rid, name, period, entries, due) {
    var r = REP(), key = rid + "|" + period;
    var sel = state.batchSel || {};
    var waiting = entries.filter(function (e) { return !e.status || e.status === "submitted"; });
    var picked = waiting.filter(function (e) { return sel[e.id]; }).length;
    var busy = state.batchBusy && state.batchBusy.key === key ? state.batchBusy : null;
    var signing = state.attesting === rid + period;
    var h = '<div class="pgl-card pgl-month" data-key="' + attr(key) + '">' +
      '<div class="pgl-month-h"><div><div class="pgl-row-t">' + esc(monthLabel(period)) + "</div>" +
      '<div class="pgl-row-s">' + entries.length + " entr" + (entries.length === 1 ? "y" : "ies") +
        (waiting.length ? " · " + waiting.length + " waiting" : "") + (due ? " · month ready to sign" : "") + "</div></div>" +
      (waiting.length ? '<button class="pgl-chip sm" data-pgl="batch-all" data-key="' + attr(key) + '">' + (picked === waiting.length ? "Clear" : "Select all") + "</button>" : "") +
      "</div>";
    entries.forEach(function (e) {
      var isWaiting = !e.status || e.status === "submitted";
      h += '<div class="pgl-bitem">' +
        (isWaiting
          ? '<label class="pgl-bchk"><input type="checkbox" data-bsel="' + attr(e.id) + '" data-key="' + attr(key) + '"' + (sel[e.id] ? " checked" : "") + (busy ? " disabled" : "") + '><span class="sr">Select</span></label>'
          : '<span class="pgl-bchk">' + ic("task_alt") + "</span>") +
        '<button class="pgl-bmain" data-pgl="go" data-r="' + (isWaiting ? "review/" + attr(e.id) : "") + '"' + (isWaiting ? "" : " disabled") + ">" +
          '<span class="pgl-row-t">' + esc(r ? r.activityLabel(e) : (e.title || e.kind)) + "</span>" +
          '<span class="pgl-row-s">' + esc(e.occurredAt || "") + " · " + esc(kindText(e)) + (e.role ? " · " + esc(roleText(e)) : "") +
          (e.unassigned ? " · no guide assigned yet" : "") +
          (isWaiting ? "" : " " + vstate(e.status)) + "</span></button></div>";
    });
    var canSign = canSignNow();
    if (waiting.length) {
      h += '<button class="pgl-btn wide" data-pgl="verify-selected" data-id="' + attr(rid) + '" data-p="' + attr(period) + '" data-key="' + attr(key) + '"' +
        (!canSign || !picked || busy ? " disabled" : "") + ">" + ic("task_alt") +
        (busy ? "Verifying " + busy.done + " of " + busy.total + "…" : "Verify selected (" + picked + ")") + "</button>";
    }
    if (due) {
      var fresh = state.justVerified && state.justVerified[key];
      h += '<button class="pgl-btn wide' + (fresh || !waiting.length ? "" : " ghost") + '" style="margin-top:8px" data-pgl="attest-month" data-id="' + attr(rid) + '" data-p="' + attr(period) + '"' +
        (signing || !canSign ? " disabled" : "") + ">" + ic("event_available") +
        (signing ? "Signing…" : "Authenticate " + monthLabel(period)) + "</button>";
    }
    return h + "</div>";
  }
  function batchSync(key) {
    // Update the Verify button in place: a checkbox tap should not repaint the screen.
    var host = state.host; if (!host) return;
    var btn = host.querySelector('[data-pgl="verify-selected"][data-key="' + key + '"]');
    var boxes = host.querySelectorAll('[data-bsel][data-key="' + key + '"]');
    var n = 0; Array.prototype.forEach.call(boxes, function (b) { if (b.checked) n++; });
    if (btn) {
      btn.disabled = !n || !canSignNow();
      var tn = btn.lastChild; if (tn && tn.nodeType === 3) tn.nodeValue = "Verify selected (" + n + ")";
    }
    var all = host.querySelector('[data-pgl="batch-all"][data-key="' + key + '"]');
    if (all) all.textContent = n && n === boxes.length ? "Clear" : "Select all";
  }
  function batchEntries(rid, period) {
    var fromRes = state.resEntries && state.resEntries[rid];
    var list = arr(fromRes).concat(arr(state.faculty && state.faculty.pending).filter(function (e) {
      return e.residentId === rid && !arr(fromRes).some(function (x) { return x.id === e.id; });
    }));
    return list.filter(function (e) { return monthOf(e) === period; });
  }
  function verifySelected(rid, period) {
    var st = ST(), key = rid + "|" + period, sel = state.batchSel || {};
    var ids = batchEntries(rid, period).filter(function (e) { return (!e.status || e.status === "submitted") && sel[e.id]; })
      .map(function (e) { return e.id; });
    if (!ids.length) return toast("Tick the entries you have checked.");
    if (!canSignNow()) return toast("Verify your council registration first.");
    var ok = 0, fails = [];
    state.batchBusy = { key: key, done: 0, total: ids.length };
    render();
    // SEQUENTIAL, through the existing single-entry call: one signature, one audit row per entry.
    return ids.reduce(function (chain, id) {
      return chain.then(function () {
        return st.verify(id, "").then(function () { ok++; delete sel[id]; }, function (e) {
          fails.push((e && e.userMessage) || (e && e.code === "pglog_self_verify_forbidden" ? "You cannot verify your own entry." : "Could not verify one entry."));
        }).then(function () { state.batchBusy.done++; render(); });
      });
    }, Promise.resolve()).then(function () {
      state.batchBusy = null;
      state.justVerified = state.justVerified || {};
      if (ok) state.justVerified[key] = true;
      haptic(fails.length ? "warning" : "success");
      toast("Verified " + ok + " of " + ids.length + "." + (fails.length ? " " + fails[0] : ""));
      var rr = state.resEntries && state.resEntries[rid] ? loadResidentEntries(rid) : Promise.resolve();
      return Promise.all([loadFaculty(), rr]).then(render, render);
    });
  }
  function loadResidentEntries(rid) {
    var st = ST();
    state.resEntries = state.resEntries || {};
    if (!st || !st.entries) return Promise.resolve([]);
    return st.entries(rid).then(function (r) {
      state.resEntries[rid] = arr(r && (r.entries || r.items || r)).filter(function (e) { return e && e.id; });
      state.resEntriesErr = null;
      return state.resEntries[rid];
    }, function (e) { state.resEntriesErr = e || new Error("unknown"); return []; });
  }

  function screenFaculty() {
    var f = state.faculty, r = REP();
    if (!f) return loading();
    if (easy()) return screenFacultyEasy(f);
    var h = [];
    h.push(signerBanner());
    h.push('<div class="pgl-stats">' +
      stat(arr(f.pending).length, "To verify") +
      stat(arr(f.overdue).length, "Overdue") +
      stat(arr(f.residents).length, "Residents") +
      stat(arr(f.residents).reduce(function (a, x) { return a + arr(x.attestationOverdue).length; }, 0), "Months to authenticate") +
      "</div>");
    if (arr(f.overdue).length) {
      h.push(banner("warn", "hourglass_bottom",
        "<b>" + arr(f.overdue).length + " entries</b> have been waiting beyond your institution's " +
        fint("smd_pglog_verify_sla_days") + "-day review target. " +
        "<span class=\"pgl-clause\">Institutional policy: NMC sets no per-entry SLA, only the monthly authentication in 5.2(vii).</span>"));
    }
    h.push('<div class="pgl-sec-title"><span>Awaiting your verification</span><span>' + arr(f.pending).length + "</span></div>");
    if (!arr(f.pending).length) h.push(emptyState("task_alt", "Nothing waiting", "Every entry submitted to you has been reviewed."));
    arr(f.pending).forEach(function (e) {
      h.push('<button class="pgl-row" data-pgl="go" data-r="review/' + attr(e.id) + '">' +
        '<span class="pgl-row-ic">' + ic(kindIcon(e)) + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(r.activityLabel(e)) + "</span>" +
        '<span class="pgl-row-s">' + esc(e.occurredAt) + " · " + esc(kindText(e)) +
        (e.role ? " · " + esc(roleText(e)) : "") + "</span></span>" + ic("chevron_right") + "</button>");
    });
    h.push('<div class="pgl-sec-title"><span>Your residents</span><span>' + arr(f.residents).length + "</span></div>");
    arr(f.residents).forEach(function (x) {
      var behind = x.weekly && x.weekly.pct != null && x.weekly.pct < 70;
      h.push('<button class="pgl-row" data-pgl="go" data-r="resident/' + attr(x.resident.id) + '">' +
        '<span class="pgl-row-ic">' + ic(behind ? "priority_high" : "person") + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(x.resident.name || x.resident.id) + "</span>" +
        '<span class="pgl-row-s">Year ' + esc(String(x.resident.trainingYear || "")) +
        " · " + esc(String((x.summary || {}).verified || 0)) + " verified" +
        (x.weekly && x.weekly.pct != null ? " · weekly " + x.weekly.pct + "%" : "") +
        (arr(x.attestationOverdue).length ? " · " + arr(x.attestationOverdue).length + " month(s) to authenticate" : "") +
        "</span></span>" + ic("chevron_right") + "</button>");
    });

    /* MONTHLY AUTHENTICATION - PGMER-2023 5.2(vii). store.attest() existed with no callers anywhere,
     * so the app counted these months as overdue on four screens and gave nobody a way to sign one.
     * The server decides whether this caller may: the guide or a co-guide, or the head of department
     * when a guide has left, never the resident, and a month can be signed exactly once. */
    var due = [];
    arr(f.residents).forEach(function (x) {
      arr(x.attestationOverdue).forEach(function (p) { due.push({ res: x.resident, period: p }); });
    });
    h.push('<div class="pgl-sec-title"><span>Months to authenticate</span><span>' + due.length + "</span></div>");
    if (!due.length) {
      h.push(emptyState("verified", "Nothing to authenticate",
        "Every completed month for your residents carries your authentication."));
    } else {
      h.push('<p style="font-size:12.5px;line-height:1.55;color:var(--pgl-muted);margin:0 0 10px">' +
        "PGMER-2023 5.2(vii): the guide authenticates the logbook every month. Signing records your " +
        "council registration against that month's entries." + "</p>");
      due.forEach(function (d) {
        var busy = state.attesting === d.res.id + d.period;
        h.push('<div class="pgl-row static"><span class="pgl-row-ic">' + ic("event_available") + "</span>" +
          '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(d.res.name || d.res.id) + "</span>" +
          '<span class="pgl-row-s">' + esc(monthLabel(d.period)) + "</span></span>" +
          '<button class="pgl-chip" data-pgl="attest-month" data-id="' + attr(d.res.id) +
          '" data-p="' + attr(d.period) + '"' + (busy ? " disabled" : "") + ">" +
          (busy ? "Signing…" : "Authenticate") + "</button></div>");
      });
    }
    return wrap(h.join(""));
  }

  /** "2026-08" -> "August 2026". The period itself is what the server keys the signature on. */
  function monthLabel(p) {
    var mm = /^(\d{4})-(\d{2})$/.exec(String(p || ""));
    if (!mm) return String(p || "");
    var names = ["January", "February", "March", "April", "May", "June",
                 "July", "August", "September", "October", "November", "December"];
    return (names[parseInt(mm[2], 10) - 1] || mm[2]) + " " + mm[1];
  }

  // The review sheet: Open -> Review -> Assess -> Feedback -> Verify / Return.
  function screenReview(id) {
    var f = state.faculty, r = REP(), m = M();
    var e = arr(f && f.pending).filter(function (x) { return x.id === id; })[0] || state.review;
    if (!e) return wrap(errorState("That entry is no longer pending."));
    var h = [];
    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(r.activityLabel(e)) + "</div>" +
      '<div class="pgl-row-s" style="margin-top:6px">' + esc(e.occurredAt) + " · " + esc(kindText(e)) +
      (e.role ? " · " + esc(roleText(e)) : "") + "</div>" +
      (m.latencyDays(e) > 3 ? '<div class="hint" style="margin-top:6px">Logged ' + m.latencyDays(e) + " days after the event.</div>" : "") +
      "</div>");
    var rows = [];
    [["Resident", e.residentName || (e.residentId ? residentNameFor(e.residentId, e) : "")],
     ["Case reference", e.caseRef], ["Diagnosis", e.diagnosis], ["Setting", e.setting ? settingText(e.setting) : ""], ["Outcome", e.outcome ? outcomeText(e.outcome) : ""],
     ["Complications", arr(e.complications).join(", ")], ["Topic", e.topic], ["Remarks", e.remarks]]
      .forEach(function (kv) { if (kv[1]) rows.push(kv); });
    if (rows.length) {
      h.push('<div class="pgl-card"><dl class="pgl-rep-meta">' +
        rows.map(function (kv) { return "<dt>" + esc(kv[0]) + "</dt><dd>" + (kv[0] === "Case reference" ? phi("id", kv[1]) : esc(kv[1])) + "</dd>"; }).join("") + "</dl></div>");
    }
    if (arr(e.requirementIds).length) {
      h.push('<div class="pgl-card"><h3>Claimed requirements</h3>' +
        arr(e.requirementIds).map(function (rid) {
          var req = state.requirements.filter(function (x) { return x.id === rid; })[0];
          return '<div class="pgl-row-t" style="font-size:13.5px">' + esc(req ? req.label : rid) + "</div>" +
            '<div class="pgl-row-s">' + (req ? prov(req.source, req.clause) : "") + "</div>";
        }).join("") +
        '<div class="hint" style="margin-top:8px">Verifying this entry is what makes it count toward these requirements. Nothing else does.</div></div>');
    }
    h.push('<div class="pgl-field"><label>Note (optional, visible to the resident)</label>' +
      '<textarea data-f-review="note" placeholder="A sentence of feedback"></textarea></div>');
    h.push('<div class="pgl-field"><label>If returning, what needs correcting?</label>' +
      '<textarea data-f-review="reason" placeholder="Required to return the entry"></textarea>' +
      '<div class="hint">A return without a reason is refused, the resident has to know what to fix.</div></div>');
    if (state.templates) {
      var applicable = arr(state.templates.templates).filter(function (t) { return t.appliesTo === e.kind; });
      if (applicable.length) {
        h.push('<div class="pgl-sec-title"><span>Assess</span></div>');
        applicable.forEach(function (t) {
          h.push('<button class="pgl-row" data-pgl="assess" data-id="' + attr(e.id) + '" data-t="' + attr(t.id) + '">' +
            '<span class="pgl-row-ic">' + ic("fact_check") + "</span>" +
            '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(t.label) + "</span>" +
            '<span class="pgl-row-s">' + esc(t.totalLabel || "") + " " + prov(t.source, "") + "</span></span>" +
            ic("chevron_right") + "</button>");
        });
      }
    }
    var sg = state.ctx && state.ctx.signer;
    if (sg && !sg.ok) h.push(signerBanner());
    else if (sg && sg.ok) {
      h.push(banner("info", "verified_user",
        "Verifying signs this record as <b>" + esc(sg.name || REP().person(state.ctx.uid)) +
        "</b>, registration <b>" + esc(sg.regNo) + "</b>" + (sg.council ? " (" + esc(sg.council) + ")" : "") +
        ". That number is recorded on the entry and printed on its verification QR."));
    }
    var canSign = !sg || sg.ok;
    return wrap(h.join("")) +
      '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="do-return" data-id="' + attr(e.id) + '"' + (canSign ? "" : " disabled") + ">" + ic("undo") + "Return</button>" +
      '<button class="pgl-btn" data-pgl="do-verify" data-id="' + attr(e.id) + '"' + (canSign ? "" : " disabled") + ">" + ic("task_alt") + "Verify</button></div>";
  }

  // The assessment form, rendered from the NMC proforma in pglog/assessment-templates.json.
  function screenAssess() {
    var a = state.assessment;
    if (!a || !a.template) return wrap(errorState("No assessment open."));
    var t = a.template, scale = (state.templates && state.templates.scales && state.templates.scales[t.scaleId]) || null;
    var h = [];
    h.push('<div class="pgl-card tight"><div class="pgl-row-t">' + esc(t.label) + "</div>" +
      '<div class="pgl-row-s">' + esc(t.totalLabel || "") + " " + prov(t.source, "") + "</div>" +
      '<div class="hint" style="margin-top:6px">' + esc(t.sourceTitle) + "</div></div>");
    var groups = {};
    arr(t.criteria).forEach(function (c) { (groups[c.group || ""] = groups[c.group || ""] || []).push(c); });
    Object.keys(groups).forEach(function (g) {
      if (g) {
        var gl = arr(t.groups).filter(function (x) { return x.key === g; })[0];
        h.push('<div class="pgl-sec-title"><span>' + esc(gl ? gl.label : g) + "</span></div>");
      }
      h.push('<div class="pgl-card">' + groups[g].map(function (c) {
        var v = a.scores[c.key];
        var buttons = [];
        for (var i = t.scaleMin; i <= t.scaleMax; i++) {
          buttons.push('<button data-f-score="' + attr(c.key) + '" data-v="' + i + '" aria-pressed="' + (v === i ? "true" : "false") + '">' + i + "</button>");
        }
        return '<div class="pgl-crit"><div class="lbl">' + esc(c.label) + "</div>" +
          (c.hint ? '<div class="hint">' + esc(c.hint) + "</div>" : "") +
          '<div class="pgl-scale">' + buttons.join("") + "</div>" +
          '<div class="pgl-anchor">' + esc(anchorFor(scale, v)) + "</div></div>";
      }).join("") + "</div>");
    });
    if (t.logbookMax) {
      h.push('<div class="pgl-field"><label>Logbook marks (out of ' + t.logbookMax + ")</label>" +
        '<input type="number" data-f-lb="1" min="0" max="' + t.logbookMax + '" value="' + (a.logbookScore == null ? "" : a.logbookScore) + '">' +
        '<div class="hint">The NMC proforma allots ' + t.logbookMax + " marks to the logbook itself.</div></div>");
    }
    arr(t.freeText).forEach(function (ft) {
      h.push('<div class="pgl-field"><label>' + esc(ft.label) + "</label>" +
        '<textarea data-f-ft="' + attr(ft.key) + '">' + esc(a.free[ft.key] || "") + "</textarea></div>");
    });
    h.push('<div class="pgl-field"><label>Outcome</label><div class="pgl-chips">' +
      [["satisfactory", "Satisfactory"], ["needs_improvement", "Needs improvement"], ["remediation", "Remediation"]].map(function (o) {
        return '<button class="pgl-chip" data-f-outcome="' + o[0] + '" aria-pressed="' + (a.outcome === o[0] ? "true" : "false") + '">' + esc(o[1]) + "</button>";
      }).join("") + "</div></div>");
    if (a.outcome === "remediation") {
      h.push('<div class="pgl-field"><label>Remediation / action plan</label>' +
        '<textarea data-f-plan="1" placeholder="What the resident will do, and by when">' + esc(a.actionPlan || "") + "</textarea>" +
        '<div class="hint">Required: a remediation outcome without a plan is refused.</div></div>');
    }
    if (t.requireDiscussed) {
      h.push('<div class="pgl-field"><label>' + esc(t.discussedLabel || "Has this assessment been discussed with the trainee?") + "</label>" +
        '<div class="pgl-chips">' +
        '<button class="pgl-chip" data-f-disc="yes" aria-pressed="' + (a.discussed === true ? "true" : "false") + '">Yes</button>' +
        '<button class="pgl-chip" data-f-disc="no" aria-pressed="' + (a.discussed === false ? "true" : "false") + '">No</button></div>' +
        '<div class="hint">The NMC form asks this question, so it is required. An assessment the trainee never saw is not feedback.</div></div>');
    }
    var ai = AI();
    if (ai && ai.isOn()) {
      h.push('<button class="pgl-btn ghost wide" data-pgl="ai-review">' + ic("auto_awesome") + "Draft the feedback</button>");
      if (a.aiDraft) h.push(banner("ai", "auto_awesome", "<b>" + esc(a.aiDraft.label) + "</b><br>" + esc(a.aiDraft.text) +
        "<br><button class=\"pgl-chip\" data-pgl=\"use-ai-draft\" style=\"margin-top:8px\">Use as a starting point</button>"));
    }
    return wrap(h.join("")) +
      '<div class="pgl-actionbar"><button class="pgl-btn wide" data-pgl="save-assessment">' + ic("check") + "Save assessment</button></div>";
  }
  function anchorFor(scale, v) {
    if (!scale || v == null) return "";
    var a = arr(scale.anchors).filter(function (x) { return x.value === v; })[0];
    if (a) return a.label;
    var b = arr(scale.bands).filter(function (x) { return v >= x.from && v <= x.to; })[0];
    return b ? b.label : "";
  }

  /* ── DEPARTMENT / ACADEMIC CELL ──────────────────────────────────────────── */
  function screenDept() {
    var d = state.dept;
    if (!d) return loading();
    var rows = arr(d.residents);
    var attention = rows.filter(function (x) {
      return (x.weekly && x.weekly.pct != null && x.weekly.pct < 70) || countOf(x.attestationOverdue) > 0 || countOf(x.overdueVerifications) > 0;
    });
    var h = [];
    h.push('<div class="pgl-stats">' +
      stat(rows.length, "Residents") +
      stat(attention.length, "Need intervention") +
      stat(rows.reduce(function (a, x) { return a + ((x.summary || {}).submitted || 0); }, 0), "Awaiting verification") +
      stat(rows.reduce(function (a, x) { return a + countOf(x.attestationOverdue); }, 0), "Months unauthenticated") +
      "</div>");
    if (d.audience === "aggregate") {
      h.push(banner("info", "shield_person",
        "Institution-wide view. It shows training completeness only, no case reference, diagnosis or clinical " +
        "detail reaches this screen. PGMER-2023 5.2(iv) asks the Academic Cell to <b>ensure and monitor the " +
        "implementation of training programmes</b>, which is a completeness question."));
    }
    h.push('<div class="pgl-filters">');
    h.push(deptChip("trainingYear", "", "All years"));
    ["1", "2", "3"].forEach(function (y) { h.push(deptChip("trainingYear", y, "Year " + y)); });
    h.push("</div>");
    if (attention.length) {
      h.push('<div class="pgl-sec-title"><span>Requires intervention</span><span>' + attention.length + "</span></div>");
      attention.forEach(function (x) { h.push(deptRow(x, true)); });
    }
    h.push('<div class="pgl-sec-title"><span>All residents</span><span>' + rows.length + "</span></div>");
    rows.forEach(function (x) { h.push(deptRow(x, false)); });
    return wrap(h.join("")) +
      (flag("smd_pglog_reports")
        ? '<div class="pgl-actionbar"><button class="pgl-btn ghost" data-pgl="go" data-r="report/department_summary">' + ic("description") + "Department summary</button></div>"
        : "");
  }
  function deptChip(dim, v, label) {
    return '<button class="pgl-chip" data-pgl="deptfilter" data-dim="' + dim + '" data-v="' + attr(v) + '" aria-pressed="' +
      (state.deptFilter[dim] === v ? "true" : "false") + '">' + esc(label) + "</button>";
  }
  function deptRow(x, warn) {
    var res = x.resident || {};
    var why = [];
    if (x.weekly && x.weekly.pct != null && x.weekly.pct < 70) why.push("weekly cadence " + x.weekly.pct + "%");
    if (countOf(x.attestationOverdue)) why.push(countOf(x.attestationOverdue) + " month(s) unauthenticated");
    if (countOf(x.overdueVerifications)) why.push(countOf(x.overdueVerifications) + " overdue verifications");
    return '<button class="pgl-row" data-pgl="go" data-r="resident/' + attr(res.id) + '">' +
      '<span class="pgl-row-ic">' + ic(warn ? "priority_high" : "person") + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(res.name || res.id) + "</span>" +
      '<span class="pgl-row-s">Year ' + esc(String(res.trainingYear || "")) + (res.unit ? " · " + esc(res.unit) : "") +
      " · " + esc(String((x.summary || {}).verified || 0)) + " verified" +
      (x.drpMonths ? " · DRP " + Number(x.drpMonths).toFixed(1) + "m" : "") + "</span>" +
      (why.length ? '<span class="pgl-row-s" style="color:var(--pgl-warn)">' + esc(why.join(" · ")) + "</span>" : "") +
      "</span>" + ic("chevron_right") + "</button>";
  }

  function screenResidentDetail(id) {
    var d = state.dept || state.faculty;
    var x = arr(d && d.residents).filter(function (y) { return (y.resident || {}).id === id; })[0] || residentRowFor(id);
    if (!x) return wrap(errorState("That resident is not in the current list."));
    var res = x.resident;
    var caps = arr(state.ctx && state.ctx.caps);
    var h = [];
    var guide = (state.guideSet && state.guideSet[id] != null) ? state.guideSet[id] : res.guide;
    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(res.name || res.id) + "</div>" +
      '<div class="pgl-row-s">Year ' + esc(String(res.trainingYear || "")) + (res.unit ? " · " + esc(res.unit) : "") +
      (guide ? " · guide " + esc(res.guideName && guide === res.guide ? res.guideName : personName(guide)) : " · no guide assigned") + "</div></div>");
    // A COUNT. attestationOverdue is a list of periods; printing it gave "2026-072026-08" in a stat tile.
    h.push('<div class="pgl-stats">' +
      stat((x.summary || {}).verified || 0, "Verified") +
      stat((x.summary || {}).submitted || 0, "Awaiting") +
      stat(x.weekly && x.weekly.pct != null ? x.weekly.pct + "%" : "-", "Weekly cadence") +
      stat(countOf(x.attestationOverdue), "Months to authenticate") + "</div>");
    if (x.attendance) {
      h.push('<div class="pgl-card tight"><div class="pgl-row-s">Attendance ' +
        (x.attendance.pctOfRecorded == null ? "not recorded" : x.attendance.pctOfRecorded + "% of recorded days") +
        " " + prov("nmc_regulation", "5.5") + "</div></div>");
    }
    /* ASSIGN GUIDE. The enrol form never asked for one, so most residents had none and every entry
     * needed a hand-picked supervisor. The server decides who may change it. */
    if (caps.indexOf("pglog.configure") > -1 || caps.indexOf("pglog.view.dept") > -1) {
      var fac = arr(state.inst && state.inst.faculty).length ? state.inst.faculty : state.roster;
      h.push('<div class="pgl-card"><h3>' + (guide ? "Change guide" : "Assign guide") + "</h3>" +
        '<div class="pgl-field" style="margin-top:6px">' + guideSelect("pglAssignGuide", guide, fac) + "</div>" +
        '<button class="pgl-btn wide" data-pgl="assign-guide" data-id="' + attr(res.id) + '"' + (state.guideBusy ? " disabled" : "") + ">" +
          (state.guideBusy ? "Saving…" : (guide ? "Save guide" : "Assign guide")) + "</button></div>");
    }
    /* THE ENTRIES, month by month, with the month's Authenticate action beside them. A guide used to
     * be asked to sign a month from a list of period keys without seeing a single entry in it. */
    var due = {}; arr(x.attestationOverdue).forEach(function (p) { due[p] = 1; });
    var list = state.resEntries && state.resEntries[id];
    if (list == null && !state.resEntriesErr) {
      h.push('<div class="pgl-sec-title"><span>Entries</span></div>' + loading());
    } else if (state.resEntriesErr && list == null) {
      h.push(banner("warn", "error", "Could not load this resident's entries. Opening an entry's detail needs you to be their guide, " +
        "the supervisor named on it, or the Head of Department."));
    } else {
      var byMonth = {};
      arr(list).forEach(function (e) { var p = monthOf(e) || "unknown"; (byMonth[p] = byMonth[p] || []).push(e); });
      Object.keys(due).forEach(function (p) { byMonth[p] = byMonth[p] || []; });
      var months = Object.keys(byMonth).sort().reverse();
      h.push('<div class="pgl-sec-title"><span>Entries</span><span>' + arr(list).length + "</span></div>");
      if (!months.length) h.push(emptyState("history_edu", "No entries yet", "Nothing has been logged by this resident."));
      months.forEach(function (p) {
        h.push(canFaculty() ? monthCard(id, res.name, p, byMonth[p], !!due[p])
          : '<div class="pgl-card tight"><div class="pgl-row-t">' + esc(monthLabel(p)) + "</div>" +
            '<div class="pgl-row-s">' + byMonth[p].length + " entries · " +
            byMonth[p].filter(function (e) { return e.status === "verified"; }).length + " verified</div></div>");
      });
    }
    /* POSTINGS. store.createRotation() had no callers, and the resident's own Rotations screen tells
     * them to ask their department - which had no control either, so a posting could never be
     * recorded anywhere. The server requires PGLOG_CONFIGURE, so the form appears for the people who
     * hold it and nobody else. */
    if (arr(state.ctx && state.ctx.caps).indexOf("pglog.configure") > -1) {
      h.push('<div class="pgl-card"><h3>Add a posting</h3>' +
        '<p style="font-size:13px;line-height:1.55;color:var(--pgl-muted)">' +
        "Rotations decide which department a resident's work counts toward, and the residential " +
        "posting requirement is measured from them." + "</p></div>");
      h.push('<div class="pgl-field"><label for="pglRotName">Posting</label>' +
        '<input type="text" id="pglRotName" placeholder="e.g. Medical ICU"></div>');
      h.push('<div class="pgl-field"><label for="pglRotFrom">From</label>' +
        '<input type="date" id="pglRotFrom"></div>');
      h.push('<div class="pgl-field"><label for="pglRotTo">To</label>' +
        '<input type="date" id="pglRotTo"></div>');
      h.push('<button class="pgl-btn wide" data-pgl="add-rotation" data-id="' + attr(res.id) + '"' +
        (state.rotBusy ? " disabled" : "") + ">" + (state.rotBusy ? "Adding…" : "Add posting") + "</button>");
    }

    h.push(banner("info", "shield_person",
      "This view shows training completeness. Opening an individual entry's clinical detail requires being " +
      "the resident's verifying faculty or the Head of Department."));
    return wrap(h.join(""));
  }

  /* ── CHECK A CODE ────────────────────────────────────────────────────────────
   * The in-app side of the public verification endpoint, for a HOD or examiner who has the app
   * open. The same answer is available to anyone with a browser and no account at all. */
  function screenCheck() {
    var r = state.checked;
    var h = ['<div class="pgl-field"><label for="pglCode">Verification code</label>' +
      '<input type="text" id="pglCode" placeholder="PGL-XXXXX-XXXXX" autocapitalize="characters" spellcheck="false">' +
      '<div class="hint">Printed under the QR on any signed record. Scanning the QR opens the same check.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="check-code">' + ic("qr_code_scanner") + "Check</button>"];
    if (r) {
      var STATE = {
        valid: ["task_alt", "info", "This signature is valid"],
        superseded: ["history", "warn", "Superseded: the record was amended after signing"],
        tampered: ["gpp_bad", "bad", "This record does not match what was signed"],
        not_found: ["search_off", "warn", "No signed record carries that code"],
        malformed: ["error", "warn", "That is not a StewardMD verification code"],
        unavailable: ["cloud_off", "warn", "Could not read the record just now"]
      }[r.status] || ["help", "warn", "Unknown result"];
      h.push(banner(STATE[1], STATE[0], "<b>" + esc(STATE[2]) + "</b>" + (r.message ? "<br>" + esc(r.message) : "")));
      if (r.status === "valid") {
        h.push('<div class="pgl-card"><h3>What was signed</h3><dl class="pgl-rep-meta">' +
          kvRow("Resident", r.resident && (r.resident.name + (r.resident.smdId ? " · " + r.resident.smdId : ""))) +
          kvRow("Programme", r.programme && ((r.programme.degree || "") + " " + (r.programme.specialty || ""))) +
          kvRow("Record", r.record && r.record.type) +
          kvRow("Activity", r.record && (r.record.activity || r.record.template || r.record.period)) +
          kvRow("Date", r.record && r.record.date) +
          kvRow("Role", r.record && r.record.role) +
          kvRow("Amendments", r.record && r.record.amendments != null ? String(r.record.amendments) : "") +
          "</dl></div>");
        h.push('<div class="pgl-card"><h3>Signed by</h3><dl class="pgl-rep-meta">' +
          kvRow("Name", r.signedBy && r.signedBy.name) +
          kvRow("Registration", r.signedBy && r.signedBy.registrationNo) +
          kvRow("Council", r.signedBy && r.signedBy.council) +
          kvRow("Capacity", r.signedBy && r.signedBy.role) +
          "</dl></div>");
      }
      if (r.disclaimer) h.push('<div class="hint" style="margin-top:12px">' + esc(r.disclaimer) + "</div>");
    }
    return wrap(h.join(""));
  }
  function kvRow(k, v) { return v ? "<dt>" + esc(k) + "</dt><dd>" + esc(v) + "</dd>" : ""; }


  /* ── CERTIFICATION ───────────────────────────────────────────────────────────
   * The screen where a logbook stops being a working record and becomes a document. Three audiences
   * meet here: the resident who wants to submit it, the faculty who have to sign it, and whoever
   * later has to trust it. So the screen is built around one question — CAN THIS BE SUBMITTED YET —
   * and it never answers that question with a maybe. */
  function screenCertify() {
    var m = M(), c = state.cert, res = state.dash && state.dash.resident;
    if (state.certLoading) return loading();
    var h = [];

    if (!c && state.certErr) {
      // "We could not ask" is not "you have none" - and acting on the wrong one means requesting a
      // second certification over an existing one.
      h.push(banner("warn", "error",
        esc(instErr(state.certErr, "Could not check your certification just now."))));
      h.push('<button class="pgl-btn wide" data-pgl="retry" data-r="certify">Try again</button>');
      return wrap(h.join(""));
    }
    if (!c) {
      h.push(emptyState("verified_user", "Not certified yet",
        "A certification freezes your verified entries and collects the signatures your institution " +
        "requires. Until it is issued, anything you export is stamped as a draft."));
      h.push(certRuleCard(null));
      if (isOwnLogbook()) {
        h.push('<button class="pgl-btn wide" data-pgl="cert-request">' + ic("how_to_reg") + "Request certification</button>");
      }
      h.push(certLimitsNote());
      return wrap(h.join(""));
    }

    var st = m ? m.quorumState(c, c.quorum, res) : { missing: [], met: false, faculty: 0, hod: 0 };
    var TONE = {
      issued: ["info", "verified", "Certified: ready to share"],
      pending: ["warn", "hourglass_top", "Awaiting signatures"],
      superseded: ["warn", "history", "Superseded: a covered record was corrected after signing"],
      revoked: ["bad", "gpp_bad", "Revoked by the head of department"]
    }[c.status] || ["warn", "help", c.status];
    h.push(banner(TONE[0], TONE[1], "<b>" + esc(TONE[2]) + "</b>" +
      (c.status === "pending" && st.missing.length ? "<br>Still required: " + esc(st.missing.join("; ")) : "") +
      (c.status === "superseded" && c.supersedeReason ? "<br>" + esc(c.supersedeReason) : "") +
      (c.status === "revoked" && c.revokeReason ? "<br>" + esc(c.revokeReason) : "")));

    h.push('<div class="pgl-stats">' +
      stat(st.faculty + "/" + st.needFaculty, "Faculty") +
      stat(st.hod + "/" + st.needHod, "HOD") +
      stat(c.entryCount, "Entries covered") +
      stat(c.monthsTotal ? c.monthsAttested + "/" + c.monthsTotal : "-", "Months signed") +
      "</div>");

    // WHAT IS NOT IN IT. A certificate that quietly omitted unverified work would read as a complete
    // logbook, which is the one way this document could mislead by accident.
    var ex = c.excluded || {};
    if (ex.draft || ex.submitted || ex.returned) {
      h.push(banner("warn", "filter_alt_off",
        "<b>Not covered by this certificate:</b> " +
        [ex.submitted ? ex.submitted + " awaiting verification" : "",
         ex.returned ? ex.returned + " returned for correction" : "",
         ex.draft ? ex.draft + " still in draft" : ""].filter(Boolean).join(", ") +
        ". A certificate covers verified entries only, and the exported document says so."));
    }

    h.push('<div class="pgl-sec-title"><span>Signatures</span><span>' + arr(c.signatures).length + "</span></div>");
    if (!arr(c.signatures).length) {
      h.push(emptyState("draw", "No signatures yet", "Your guide and the head of department have been notified."));
    }
    arr(c.signatures).forEach(function (sig) {
      h.push('<div class="pgl-row static"><span class="pgl-row-ic">' + ic(sig.role === "hod" ? "shield_person" : "draw") + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(sig.name || personName(sig.by)) + "</span>" +
        '<span class="pgl-row-s">' + esc(sig.role === "hod" ? "Head of Department" : sig.role === "guide" ? "Postgraduate guide" : "Faculty") +
        (sig.reg ? " · Reg " + esc(sig.reg) : "") + (sig.at ? " · " + esc(m.isoDate(sig.at)) : "") + "</span></span></div>");
    });

    h.push(certRuleCard(c));

    if (c.status === "issued" && c.verifyCode) {
      h.push('<div class="pgl-card"><h3>Verification</h3>' + qrBlock(c.verifyCode, "Scan to verify this certified logbook", state.certVerifyUrl) +
        '<p class="hint">Printed on the exported PDF. Anyone can scan it, no StewardMD account needed.</p></div>');
    }

    // Faculty controls. The button is present only for someone who could actually sign; a control
    // that fails is worse than a control that is not there.
    if (canFaculty() && !isOwnLogbook() && c.status === "pending") {
      var already = arr(c.signatures).some(function (x) { return m.sameActor(x.by, state.ctx && state.ctx.uid); });
      h.push('<div class="pgl-actionbar">' +
        (already
          ? '<button class="pgl-btn ghost" disabled>' + ic("task_alt") + "You have signed</button>"
          : '<button class="pgl-btn" data-pgl="cert-sign" data-id="' + attr(c.id) + '">' + ic("draw") + "Sign this logbook</button>") +
        "</div>");
      if (!already && state.ctx && state.ctx.signer && state.ctx.signer.ok === false) {
        h.push(signerBanner());
      }
    }
    if (canDept() && c.status === "issued") {
      h.push('<button class="pgl-btn ghost wide" data-pgl="cert-revoke" data-id="' + attr(c.id) + '">' +
        ic("gpp_bad") + "Revoke this certificate</button>");
    }

    h.push('<div class="pgl-actionbar">' +
      '<button class="pgl-btn' + (c.status === "issued" ? "" : " ghost") + '" data-pgl="cert-pdf">' +
      ic("picture_as_pdf") + (c.status === "issued" ? "Share certified PDF" : "Export draft PDF") + "</button>" +
      "</div>");
    if (c.status !== "issued") {
      h.push('<p class="hint">An uncertified export is stamped <b>NOT CERTIFIED</b> on every copy and carries no ' +
        "signature or QR. That is deliberate: a draft must never be mistakable for a submitted document.</p>");
    }
    if (isOwnLogbook() && (c.status === "superseded" || c.status === "revoked")) {
      h.push('<button class="pgl-btn wide" data-pgl="cert-request">' + ic("restart_alt") + "Request a fresh certification</button>");
    }
    h.push(certLimitsNote());
    return wrap(h.join(""));
  }

  // WHOSE RULE IS WHOSE. The only place in the module where an institutional policy and an NMC
  // requirement sit side by side, so it is the place they most need to be told apart.
  // What the home row says without opening the screen — a resident checks this more often than
  // anything else in the module once they are near the end of training.
  function certNavSubtitle() {
    var c = state.cert;
    if (!c) return "Get your logbook signed and shareable";
    if (c.status === "issued") return "Certified · ready to share as PDF";
    if (c.status === "superseded") return "Superseded: a covered record was corrected";
    if (c.status === "revoked") return "Revoked by the head of department";
    var m = M(), st = m ? m.quorumState(c, c.quorum, state.dash && state.dash.resident) : null;
    return st && st.missing.length ? "Awaiting " + st.missing.join("; ") : "Awaiting signatures";
  }
  function certRuleCard(c) {
    var m = M();
    var q = (c && c.quorum) || (m ? m.certQuorum(null) : { faculty: 2, hod: 1, hodCountsAsFaculty: true });
    return '<div class="pgl-card"><h3>What this institution requires</h3>' +
      "<p>" + esc(q.faculty + " faculty signature" + (q.faculty > 1 ? "s" : "") +
        (q.hod ? " and " + q.hod + " Head of Department signature" : "") +
        (q.hodCountsAsFaculty ? ", the Head of Department counts toward both, so two people can complete it." : ".")) + "</p>" +
      '<p class="pgl-clause">The Head of Department signature follows the NMC specialty curricula ' +
      '("the completed log book should be signed by the Head of the Department"). The NUMBER OF ' +
      "FACULTY signatures is your institution's own rule, not an NMC requirement.</p>" +
      (q.requireGuide ? '<p class="pgl-clause">Your institution also requires the postgraduate guide named on your record to sign. PGMER-2023 5.2(vii).</p>' : "") +
      "</div>";
  }
  function certLimitsNote() {
    return '<p class="hint" style="margin-top:14px"><b>What a certified PDF is.</b> It is a tamper-evident ' +
      "document: every signatory's medical registration was checked against the Indian Medical Register " +
      "when they signed, and the QR lets a college, a University or the NMC confirm with StewardMD that " +
      "the document still matches the record. It is <b>not</b> digitally signed under the Information " +
      "Technology Act, 2000 (no licensed Certifying Authority key is applied), and it is not an NMC or " +
      "University determination. Whether it is accepted is the receiving institution's decision.</p>";
  }
  function isOwnLogbook() {
    var m = M(), res = state.dash && state.dash.resident;
    return !!(res && state.ctx && m.sameActor(state.ctx.uid, res.uid));
  }

  /* ── INBOX ───────────────────────────────────────────────────────────────── */
  function screenInbox() {
    var m = M();
    if (!state.inbox.length) return wrap(emptyState("notifications_off", "Nothing new", "Returns, pending verifications and reminders appear here."));
    return wrap(state.inbox.map(function (n) {
      return '<button class="pgl-row" data-pgl="open-notif" data-id="' + attr(n.id) + '" data-e="' + attr(n.entryId || "") + '">' +
        '<span class="pgl-row-ic">' + ic(n.read ? "drafts" : "mark_email_unread") + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(n.text) + "</span>" +
        '<span class="pgl-row-s">' + esc(m.isoDate(n.at)) + "</span></span></button>";
    }).join(""));
  }

  /* ── render ──────────────────────────────────────────────────────────────── */
  function render() {
    if (!state.host) return;
    var r = route(), h0 = head0(), a = arg();
    var title = "NMC eLOGBook", sub = "", body = "";
    if (state.loading) { state.host.innerHTML = head(title, sub) + loading(); return; }
    if (state.error) { state.host.innerHTML = head(title, sub) + wrap(errorState(state.error)); bind(); return; }
    switch (h0) {
      case "home": title = "My NMC eLOGBook"; sub = "Digital residency logbook and competency portfolio"; body = screenHome(); break;
      case "setup": title = "Set up"; sub = "PG resident"; body = screenSetup(); break;
      case "setup-faculty": title = "Set up"; sub = "Faculty and HOD"; body = screenSetupFaculty(); break;
      case "institution": title = "Institution"; sub = "Academic Cell"; body = screenInstitution(); break;
      case "add":
        if (a) {
          // Build first: screenAddForm creates the draft the title depends on.
          body = screenAddForm(a);
          var dd = state.draft || {};
          // A correction is not a new entry, and must never be titled as one.
          if (dd.__amendId) { title = "Amend entry"; sub = "Verified record"; }
          else if (dd.__serverId) { title = "Correct entry"; sub = dd.status === "returned" ? "Returned by your guide" : ""; }
          else { title = easy() ? (KIND_TITLE[a] || "Log " + a) : "Log " + a; sub = "New entry"; }
        }
        else { title = "Add activity"; body = screenAddPicker(); }
        break;
      case "quick": title = "Quick log"; sub = "Log a case in seconds"; body = screenQuick(); break;
      case "analytics": title = "My numbers"; sub = "Counted, not estimated"; body = screenAnalytics(); break;
      case "backup": title = "Backup"; sub = "Encrypted, to your own Google Drive"; body = screenBackup(); break;
      case "entries": title = "All entries"; body = screenEntries(); break;
      case "entry": title = "Entry"; body = screenEntry(a); break;
      case "progress": title = "Progress"; sub = "Against NMC requirements"; body = screenProgress(); break;
      case "rotations": title = "Rotations"; body = screenRotations(); break;
      case "research": title = "Research and thesis"; body = screenResearch(); break;
      case "attendance": title = "Attendance"; sub = easy() ? "Days present and on leave" : "PGMER-2023 5.5"; body = screenAttendance(); break;
      case "reports": title = "Reports"; body = screenReports(); break;
      case "report": title = "Report"; body = screenReport(a); break;
      case "faculty": title = "Faculty review"; sub = easy() ? "By resident, month by month" : "Verify and assess"; body = screenFaculty(); break;
      case "review": title = "Review entry"; body = screenReview(a); break;
      case "assess": title = "Assessment"; body = screenAssess(); break;
      case "dept": title = "Department"; sub = "Oversight"; body = screenDept(); break;
      case "resident": title = "Resident"; body = screenResidentDetail(a); break;
      case "inbox": title = "Notifications"; body = screenInbox(); break;
      case "check": title = "Verify a record"; sub = "Scan or type a code"; body = screenCheck(); break;
      case "certify": title = "Certification"; sub = "Signatures and the official PDF"; body = screenCertify(); break;
      default: body = wrap(errorState("Unknown screen."));
    }
    state.host.innerHTML = head(title, sub) + body;
    bind();
  }

  /* ── events ──────────────────────────────────────────────────────────────── */
  function bind() {
    var host = state.host; if (!host) return;
    host.onclick = function (ev) {
      var t = ev.target.closest("[data-pgl],[data-f-chip],[data-f-toggle],[data-f-req],[data-f-score],[data-f-outcome],[data-f-disc]");
      if (!t) return;
      if (t.hasAttribute("data-f-chip")) return setChip(t);
      if (t.hasAttribute("data-f-toggle")) return toggleField(t);
      if (t.hasAttribute("data-f-req")) return toggleReq(t);
      if (t.hasAttribute("data-f-score")) return setScore(t);
      if (t.hasAttribute("data-f-outcome")) return setOutcome(t);
      if (t.hasAttribute("data-f-disc")) return setDiscussed(t);
      act(t.getAttribute("data-pgl"), t);
    };
    host.onchange = function (ev) {
      var t = ev.target;
      if (t && t.hasAttribute && t.hasAttribute("data-bsel")) {
        state.batchSel = state.batchSel || {};
        if (t.checked) state.batchSel[t.getAttribute("data-bsel")] = 1; else delete state.batchSel[t.getAttribute("data-bsel")];
        batchSync(t.getAttribute("data-key"));
      }
    };
    host.oninput = function (ev) {
      var t = ev.target;
      if (t.hasAttribute && t.hasAttribute("data-f") && state.draft) {
        var k = t.getAttribute("data-f");
        state.draft[k] = k === "complications" ? t.value.split(",").map(function (x) { return x.trim(); }).filter(Boolean) : t.value;
      }
      if (t.hasAttribute && t.hasAttribute("data-f-review")) {
        state.reviewInput = state.reviewInput || {};
        state.reviewInput[t.getAttribute("data-f-review")] = t.value;
      }
      if (t.hasAttribute && t.hasAttribute("data-f-ft") && state.assessment) state.assessment.free[t.getAttribute("data-f-ft")] = t.value;
      if (t.hasAttribute && t.hasAttribute("data-f-lb") && state.assessment) state.assessment.logbookScore = t.value === "" ? null : Number(t.value);
      if (t.hasAttribute && t.hasAttribute("data-f-plan") && state.assessment) state.assessment.actionPlan = t.value;
      /* The quick screen updates IN PLACE on every keystroke: re-rendering would take the caret and
       * the keyboard away mid-word, which is exactly what makes a "fast" form slow. Only the Save
       * button's state changes, so only that is touched. */
      if (state.quick && t.id === "pglQuickDate") {
        state.quick.date = t.value && t.value <= todayISO() ? t.value : todayISO();
        return render();
      }
      if (state.quick && t.id && /^pglQuick/.test(t.id)) {
        quickReadInputs();
        quickSyncSaveButton();
        if (t.id === "pglQuickQ") quickSyncList();
      }
    };
  }
  function setChip(t) {
    var k = t.getAttribute("data-f-chip"), v = t.getAttribute("data-v");
    if (!state.draft) return;
    state.draft[k] = v;
    haptic("light");
    render();
  }
  function toggleField(t) { var k = t.getAttribute("data-f-toggle"); if (!state.draft) return; state.draft[k] = !state.draft[k]; render(); }
  function toggleReq(t) {
    var id = t.getAttribute("data-f-req"); if (!state.draft) return;
    var cur = arr(state.draft.requirementIds);
    state.draft.requirementIds = cur.indexOf(id) > -1 ? cur.filter(function (x) { return x !== id; }) : cur.concat([id]);
    haptic("light");
    render();
  }
  function setScore(t) {
    if (!state.assessment) return;
    state.assessment.scores[t.getAttribute("data-f-score")] = Number(t.getAttribute("data-v"));
    haptic("light");
    render();
  }
  function setOutcome(t) { if (!state.assessment) return; state.assessment.outcome = t.getAttribute("data-f-outcome"); render(); }
  function setDiscussed(t) { if (!state.assessment) return; state.assessment.discussed = t.getAttribute("data-f-disc") === "yes"; render(); }

  function act(a, t) {
    var st = ST(), m = M(), id = t.getAttribute("data-id");
    switch (a) {
      case "close": return window.PGLOG && window.PGLOG.close();
      case "back": return back();
      case "go": {
        var dest = t.getAttribute("data-r");
        // The console needs the org's programmes and the NMC specialty list; neither is in the
        // dashboard payload because no screen needed them until now.
        if (dest === "institution") { go(dest); return loadInstitution().then(render, render); }
        // The certificate is fetched when the screen is opened, not held in the dashboard payload:
        // it changes when SOMEONE ELSE signs, so a cached copy would show a resident "awaiting
        // signatures" on a logbook that was certified an hour ago.
        if (dest === "certify" || dest === "report/certified_logbook") {
          go(dest);
          return loadCert().then(render, render);
        }
        /* screenFaculty()/screenDept() open on `if (!f) return loading()`, and loadFaculty/loadDept
         * were called ONLY from enter() when the module was mounted directly on that route. Reaching
         * them by tapping the nav row therefore issued no request at all and left a skeleton on
         * screen forever - the state every faculty user would have arrived in. */
        if (dest === "faculty") { go(dest); return loadFaculty().then(render, render); }
        if (/^resident\//.test(dest)) {
          // The resident's entries, month by month, for the Authenticate-per-month view.
          var rid0 = dest.slice(9);
          if (state.resEntries) delete state.resEntries[rid0];
          state.resEntriesErr = null;
          go(dest);
          var needInst = !(state.inst && arr(state.inst.faculty).length) && ST() && ST().facultyRoster;
          return Promise.all([loadResidentEntries(rid0), needInst ? loadRoster() : null]).then(render, render);
        }
        if (!dest) return;
        if (dest === "dept") { go(dest); return loadDept().then(render, render); }
        // The department summary is built from state.dept, which only the dept screen used to load -
        // so reaching this report from anywhere else produced "That report is not available yet".
        if (dest === "report/department_summary") {
          go(dest);
          return (state.dept ? Promise.resolve(state.dept) : loadDept()).then(render, render);
        }
        return go(dest);
      }
      case "retry": state.error = ""; return enter(t.getAttribute("data-r"));
      case "filter":
        state.filter[t.getAttribute("data-dim")] = t.getAttribute("data-v");
        return render();
      case "deptfilter":
        state.deptFilter[t.getAttribute("data-dim")] = t.getAttribute("data-v");
        return loadDept();
      case "clear-inst": {
        st.setContext({ orgId: "" });
        resetOrgScopedState();
        return loadInstitution().then(render, render);
      }
      case "pick-inst": {
        st.setContext({ orgId: t.getAttribute("data-id") });
        resetOrgScopedState();
        return loadInstitution().then(render, render);
      }
      case "create-inst": {
        var nm = ((state.host.querySelector("#pglInstName") || {}).value || "").trim();
        if (!nm) { toast("Enter the institution name."); return; }
        state.inst = { busy: true }; render();
        return st.createInstitution(nm).then(function (org) {
          // Point this device at the new org immediately, or the creator has to type their own code.
          st.setContext({ orgId: org.id });
          resetOrgScopedState();
          // org.id is the internal handle the API keys on; org.code is the SMD-XXXXXX a human shares.
          // Storing the code as the id was the exact confusion that made setup unreachable.
          state.inst = { busy: false, orgName: org.name, orgCode: org.code,
                         msg: "Institution created. Share this code: " + (org.code || org.id) };
          return loadInstitution().then(render, render);
        }, function (e) {
          state.inst = { busy: false, err: true, msg: instErr(e, "Could not create the institution.") };
          render();
        });
      }
      case "create-prog": {
        var sel = state.host.querySelector("#pglSpec");
        var sid = (sel && sel.value) || "";
        if (!sid) { toast("Choose a specialty."); return; }
        var opt = sel.options[sel.selectedIndex];
        var deg = (opt && opt.getAttribute("data-deg")) || "MD";
        var pname = String((opt && opt.textContent) || sid).split(" (")[0].trim();
        var co = (st.context() || {}).orgId;
        state.inst = state.inst || {}; state.inst.busy = true; render();
        return st.createProgramme(co, { name: pname, degree: deg, specialtyId: sid })
          .then(function () {
            state.inst.busy = false; state.inst.err = false; state.inst.msg = pname + " added.";
            return loadInstitution().then(render, render);
          }, function (e) {
            state.inst.busy = false; state.inst.err = true;
            state.inst.msg = instErr(e, "Could not add the programme."); render();
          });
      }
      case "enrol-person": {
        var val = function (q) { return ((state.host.querySelector(q) || {}).value || "").trim(); };
        var email = val("#pglEmail"), role = val("#pglRole"), pid = val("#pglProg"), gd = val("#pglGuide"), yr = parseInt(val("#pglYear"), 10) || 1;
        if (!email) { toast("Enter their email."); return; }
        // A resident with no programme is enrolled as a member but still has no logbook, which is
        // exactly the half-linked state this whole path exists to remove.
        if (role === "pg_resident" && !pid) { toast("A resident needs a programme. Add one first."); return; }
        var org2 = (st.context() || {}).orgId;
        state.inst = state.inst || {}; state.inst.busy = true; render();
        return st.enrolPerson(org2, {
          email: email, role: role, programmeId: pid || undefined,
          name: val("#pglName"), startDate: val("#pglStart") || undefined, trainingYear: yr,
          guide: role === "pg_resident" && gd ? gd : undefined
        }).then(function (r) {
          state.inst.busy = false; state.inst.err = false;
          var invited = r && (r.invited || r.pending || r.status === "invited" || r.status === "pending" || (r.invite && !r.member));
          state.inst.msg = invited
            ? email + " has not signed in to StewardMD yet. The invitation is saved; they are enrolled the first time they sign in."
            : email + " enrolled as " + role.replace("pg_", "").replace(/_/g, " ") + ".";
          render();
        }, function (e) {
          state.inst.busy = false; state.inst.err = true;
          state.inst.msg = (e && e.code === "no_such_account")
            ? (email + " has not signed in to StewardMD yet, so there is no account to enrol. Ask them to sign in once, then try again.")
            : instErr(e, "Could not enrol " + email + ".");
          render();
        });
      }
      case "signin": {
        // The app's own account gate; this module never handles credentials itself.
        try { if (window.PGLOG) window.PGLOG.close(); } catch (e) {}
        try {
          var ag = document.getElementById("accountGate");
          if (ag) { ag.classList.remove("hidden"); var cb = document.getElementById("accountGateClose"); if (cb) cb.style.display = "block"; return; }
          if (window.SMD_signInWithGoogle) return window.SMD_signInWithGoogle();
          if (window.SMD_openProfile) return window.SMD_openProfile();
        } catch (e) {}
        return toast("Open your profile to sign in.");
      }
      case "join-send": return sendJoinRequest();
      case "join-refresh": { state.ctx = null; state.joinLocal = null; toast("Checking…"); return enter("home"); }
      case "jr-approve": return doJoinDecision(id, true);
      case "jr-reject": return doJoinDecision(id, false);
      case "enrol-bulk": return doEnrolBulk();
      case "assign-guide": return doAssignGuide(id);
      case "sup-change": state.supEdit = true; return render();
      case "q-sup-change": { var qs0 = quickState(); qs0.supEdit = true; return render(); }
      case "q-date": {
        var qd = quickState(), mm0 = M();
        qd.date = t.getAttribute("data-v") === "yesterday" && mm0.addDays ? mm0.addDays(todayISO(), -1) : todayISO();
        haptic("light"); return render();
      }
      case "log-again": return doLogAgain(id);
      case "f-mic": return fieldDictate(t.getAttribute("data-field"));
      case "amend-save": return doAmendSave();
      case "verify-selected": return verifySelected(id, t.getAttribute("data-p"));
      case "batch-all": {
        var key = t.getAttribute("data-key");
        var boxes = state.host.querySelectorAll('[data-bsel][data-key="' + key + '"]');
        var allOn = Array.prototype.every.call(boxes, function (b) { return b.checked; });
        state.batchSel = state.batchSel || {};
        Array.prototype.forEach.call(boxes, function (b) { b.checked = !allOn; if (!allOn) state.batchSel[b.getAttribute("data-bsel")] = 1; else delete state.batchSel[b.getAttribute("data-bsel")]; });
        return batchSync(key);
      }
      case "save-org": {
        var v = (state.host.querySelector("#pglOrg") || {}).value || "";
        // Easy mode: entering the code from the RESIDENT set-up screen sends a request to join.
        state.joinIntent = easy() && t.getAttribute("data-join") === "1";
        state.joinCode = /^smd-/i.test(v.trim()) ? v.trim().toUpperCase() : v.trim();
        state.setupErr = null; state.joinErr = null; state.joinLocal = null;
        if (easy() && !v.trim()) { state.setupErr = "Enter the code first."; return render(); }
        // setContext normalises: SMD codes upper, a 32-char org id lower. Upper-casing here broke
        // every pasted org id.
        st.setContext({ orgId: v.trim() });
        resetOrgScopedState();
        toast("Checking…");
        return enter("home");
      }
      case "save-draft": return doSaveDraft(false);

      /* ---- quick log ---- */
      case "q-kind": { var qk1 = quickState(); qk1.kind = t.getAttribute("data-v"); qk1.title = ""; qk1.query = ""; haptic("light"); return render(); }
      case "q-pick": { var qk2 = quickState(); qk2.title = t.getAttribute("data-v"); haptic("light"); return render(); }
      case "q-unpick": { var qk3 = quickState(); qk3.title = ""; return render(); }
      case "q-role": { var qk4 = quickState(); qk4.role = t.getAttribute("data-v"); haptic("light"); return render(); }
      case "q-setting": { var qk5 = quickState(); qk5.setting = t.getAttribute("data-v"); haptic("light"); return render(); }
      case "q-nocomp": { var qk6 = quickState(); qk6.complications = []; return render(); }
      case "q-mic": return quickDictate();
      case "q-photo": return quickAddPhoto();
      case "q-photo-del": return quickRemovePhoto(t.getAttribute("data-v"));
      case "q-save": return quickSave();

      /* ---- CSV ---- */
      case "csv": return exportCsv(id);

      /* ---- Drive backup ---- */
      case "bk-setup": return backupSetup();
      case "bk-unlock": return backupUnlock();
      case "bk-now": return backupRun();
      case "bk-restore": return backupRestore();
      case "bk-auto": {
        var bk0 = BK(); if (!bk0) return;
        bk0.setAuto(!bk0.autoOn());
        toast(bk0.autoOn() ? "Automatic backup is on while the app is open." : "Automatic backup is off.");
        return render();
      }
      case "submit-draft": return doSaveDraft(true);
      case "submit-existing": return doSubmitExisting(id);
      case "edit-draft": {
        var d = st.getDraft(id);
        if (d) { state.draft = d; go("add/" + d.kind); }
        return;
      }
      /* This used to be a toast telling the resident to do the thing they had just tried to do:
       * screenEntry renders read-only rows, and store.editEntry() had NO callers anywhere. So a
       * returned entry could never actually be corrected - the only live control was Resubmit,
       * which sent the identical entry back to the guide who had just returned it. */
      case "edit-server": {
        var se = arr(state.dash && state.dash.entries).filter(function (x) { return x.id === id; })[0];
        if (!se) return toast("That entry is not in this device's copy yet. Refresh and try again.");
        if (se.status !== "returned" && se.status !== "draft") {
          return toast("Only a returned or draft entry can be corrected.");
        }
        state.draft = Object.assign({}, se, { __serverId: se.id });
        state.draftErrors = null; state.supEdit = false;
        return go("add/" + se.kind);
      }
      case "attest-month": return doAttestMonth(id, t.getAttribute("data-p"));
      case "add-rotation": return doAddRotation(id);
      case "del-prog": return doDeleteProgramme(id, t.getAttribute("data-n"));
      case "resubmit": return doResubmit(id);
      case "withdraw": return doWithdraw(id);
      case "amend": return doAmend(id);
      case "suggest": return doSuggest();
      case "pick-req": return pickRequirement();
      case "req": return showRequirement(id);
      case "print": {
        var rep = buildReport(id);
        if (rep && REP().print(rep)) return;
        return toast("Could not open the print view.");
      }
      case "share": return doShare(id);
      case "cert-request": return doCertRequest();
      case "cert-sign": return doCertSign(id);
      case "cert-revoke": return doCertRevoke(id);
      case "cert-pdf": return doCertPdf();
      case "toggle-ref": state.includeCaseRef = !state.includeCaseRef; return render();
      case "do-verify": return doVerify(id);
      case "do-return": return doReturn(id);
      case "assess": return openAssessment(id, t.getAttribute("data-t"));
      case "save-assessment": return saveAssessment();
      case "ai-summary": return doAiSummary();
      case "ai-review": return doAiReview();
      case "use-ai-draft":
        if (state.assessment && state.assessment.aiDraft) {
          state.assessment.free.facultyOverall = state.assessment.aiDraft.text;
          state.assessment.aiDraft = null;
          render();
        }
        return;
      case "go-verify":
        // Route to the app's EXISTING doctor-verification flow. This module does not verify
        // registrations; it only refuses to accept a signature from an unverified one.
        try { if (window.SMD_VERIFY && SMD_VERIFY.open) return SMD_VERIFY.open(); } catch (err) {}
        try { window.location.hash = "#verify"; } catch (err) {}
        return toast("Open Settings → Verify your medical registration.");
      case "check-code": {
        var input = state.host.querySelector("#pglCode");
        var v = input ? String(input.value || "").trim() : "";
        if (!v) return toast("Enter or scan a code.");
        state.loading = true; render();
        return ST().verifyCode(v).then(function (r) {
          state.loading = false; state.checked = r; render();
        }, function () { state.loading = false; toast("Could not reach the verification service."); render(); });
      }
      case "open-notif": {
        var e = t.getAttribute("data-e");
        st.markRead(id).catch(function () {});
        state.inbox = state.inbox.filter(function (n) { return n.id !== id; });
        return e ? go("entry/" + e) : render();
      }
    }
  }

  /* ── actions ─────────────────────────────────────────────────────────────── */
  function currentRotation() {
    var m = M(), rows = arr(state.dash && state.dash.rotations);
    return rows.filter(function (r) {
      return r.startDate && m.daysBetween(r.startDate, todayISO()) >= 0 && (!r.endDate || m.daysBetween(todayISO(), r.endDate) >= 0);
    })[0] || null;
  }
  function validationContext() {
    var res = (state.dash && state.dash.resident) || (state.ctx && state.ctx.resident) || {};
    var prog = (state.dash && state.dash.programme) || (state.ctx && state.ctx.programme) || {};
    return { today: todayISO(), programmeStart: res.startDate, degree: prog.degree };
  }
  /* Correcting an entry that already exists on the server is a PATCH, not a new draft. Saving it
   * through the draft path would have created a SECOND entry beside the returned one. */
  /* Sign one month of a resident's logbook. Deliberately thin: every rule about WHO may sign lives on
   * the server (guide or co-guide, or the head of department when a guide has left; never the
   * resident; exactly once per month, enforced by a create precondition on a deterministic id), and
   * a client-side copy of those rules could only ever disagree with it. So this asks, and reports
   * back whatever the server says. */
  function doAttestMonth(residentId, period) {
    var st = ST();
    if (!residentId || !period) return;
    var who = residentRowFor(residentId);
    var name = (who && who.resident && who.resident.name) || residentNameFor(residentId);
    if (!easy()) return attestConfirmed(residentId, period, name, "");
    /* Say what is being signed: how many entries the month holds and how many are still unverified.
     * Read fresh, because a count from the queue alone would miss the month's verified entries. */
    var p0 = (st.entries ? st.entries(residentId, { from: period + "-01", to: period + "-31" }) : Promise.reject(new Error("no_entries")))
      .then(function (r) { return arr(r && (r.entries || r.items || r)).filter(function (e) { return e && monthOf(e) === period && !e.deleted; }); },
            function () { return batchEntries(residentId, period); });
    return p0.then(function (list) {
      var unver = list.filter(function (e) { return e.status !== "verified"; }).length;
      return attestConfirmed(residentId, period, name,
        list.length + " entr" + (list.length === 1 ? "y" : "ies") + ", " + unver + " still unverified.");
    });
  }
  function attestConfirmed(residentId, period, name, counts) {
    var st = ST();
    var okToSign = (typeof window !== "undefined" && window.confirm)
      ? window.confirm("Authenticate " + monthLabel(period) + " for " + name + "?\n\n" +
          (counts ? counts + "\n\n" : "") +
          "This records your council registration against that month's entries. It cannot be undone.")
      : true;
    if (!okToSign) return;

    state.attesting = residentId + period;
    render();
    return st.attest({ residentId: residentId, kind: "monthly", period: period }).then(function () {
      state.attesting = null;
      toast(monthLabel(period) + " authenticated.");
      celebrate("Logbook month authenticated", monthLabel(period), "pglog-attest:" + residentId + ":" + period);
      // Reload rather than patching locally: the server recomputes which months are still outstanding.
      return Promise.all([loadFaculty(),
        state.resEntries && state.resEntries[residentId] ? loadResidentEntries(residentId) : null]).then(render, render);
    }, function (e) {
      state.attesting = null;
      haptic("warning");
      render();
      toast((e && e.userMessage) || attestErr(e));
    });
  }
  /* Remove a programme created by mistake. The server refuses with 409 while anyone is still
   * enrolled - deleting one out from under a resident would leave their entries, rotations,
   * assessments and attestations pointing at a programme that no longer exists - so this asks and
   * reports the answer rather than deciding for itself. */
  function doDeleteProgramme(id, name) {
    var st = ST();
    if (!id) return;
    var ask = (typeof window !== "undefined" && window.confirm) ? window.confirm : null;
    if (ask && !ask("Remove the programme \"" + (name || id) + "\"?\n\nThis cannot be undone. It is " +
                    "refused if any resident is still enrolled on it.")) return;
    state.progBusy = id; render();
    return st.deleteProgramme(id).then(function () {
      state.progBusy = null;
      toast("Programme removed.");
      return loadInstitution().then(render, render);
    }, function (e) {
      state.progBusy = null; haptic("warning"); render();
      toast((e && e.userMessage) ||
        (e && e.code === "programme_in_use"
          ? "Residents are still enrolled on that programme."
          : "Could not remove that programme."));
    });
  }

  /* Record a posting. The dates decide which department the work counts toward and feed the
   * residential-posting requirement, so both are required rather than defaulted. */
  function doAddRotation(residentId) {
    var st = ST(), host = state.host;
    var val = function (sel) { var el = host && host.querySelector(sel); return el ? String(el.value || "").trim() : ""; };
    var name = val("#pglRotName"), from = val("#pglRotFrom"), to = val("#pglRotTo");
    if (!name) return toast("Name the posting.");
    if (!from || !to) return toast("Enter both dates.");
    if (to < from) return toast("The end date is before the start date.");

    var d = state.dept || state.faculty;
    var x = arr(d && d.residents).filter(function (y) { return (y.resident || {}).id === residentId; })[0];
    var res = x && x.resident;
    if (!res) return toast("That resident is not in the current list.");

    state.rotBusy = true; render();
    return st.createRotation({
      residentId: residentId, programmeId: res.programmeId, name: name,
      kind: "department", departmentId: res.departmentId, unit: res.unit || "",
      startDate: from, endDate: to,
    }).then(function () {
      state.rotBusy = false;
      toast("Posting added.");
      // Reload so the department's own counts reflect it rather than trusting a local patch.
      return (state.dept ? loadDept() : loadFaculty()).then(render, render);
    }, function (e) {
      state.rotBusy = false; haptic("warning"); render();
      toast((e && e.userMessage) || "Could not add that posting.");
    });
  }

  /** Name the reason. These are the server's own refusals, and each one has a different remedy. */
  function attestErr(e) {
    var c = e && e.code;
    if (c === "not_the_guide") return "You are not this resident's guide, so only they or the head of department can authenticate this month.";
    if (c === "hod_required") return "Only the head of department can sign that.";
    if (c === "self_attest_forbidden") return "You cannot authenticate your own logbook.";
    if (c === "conflict" || c === "precondition") return "That month has already been authenticated.";
    if (c === "signer_unverified") return "Your council registration is not verified yet, so you cannot sign a training record.";
    return "Could not authenticate that month.";
  }

  function doSaveServerEdit(thenSubmit) {
    var st = ST(), m = M();
    var d = state.draft, sid = d.__serverId;
    var v = m.validateEntry(m.entry(d), Object.assign(validationContext(), { requireResident: true }));
    state.draftErrors = v.errors;
    if (!v.ok) { render(); haptic("warning"); return toast("Fix the highlighted fields."); }
    var patch = Object.assign({}, d);
    delete patch.__serverId;
    state.loading = true; render();
    return st.editEntry(sid, patch).then(function () {
      if (!thenSubmit) {
        state.draft = null; state.loading = false; state.dash = null;
        toast("Correction saved.");
        return enter("home");
      }
      return st.resubmit(sid).then(function () {
        state.draft = null; state.loading = false; state.dash = null;
        toast("Corrected and sent back for verification.");
        return enter("home");
      });
    }, function (e) {
      state.loading = false; render(); haptic("warning");
      toast((e && e.userMessage) || "Could not save the correction.");
    });
  }

  /* ── quick log behaviour ─────────────────────────────────────────────────────────────────
   * Dictation runs through the app's existing recogniser and is parsed by pglog-quick's vocabulary
   * matcher. Nothing is saved from speech: every field it fills is shown in the "Heard" line and
   * the resident still taps Save. */
  function quickReadInputs() {
    var q = quickState(), el;
    try { el = document.getElementById("pglQuickQ"); if (el) q.query = el.value; } catch (e) {}
    try { el = document.getElementById("pglQuickNote"); if (el) q.notes = el.value; } catch (e) {}
    try {
      el = document.getElementById("pglQuickComp");
      if (el) q.complications = String(el.value || "").split(",").map(function (x) { return x.trim(); }).filter(Boolean);
    } catch (e) {}
    try { el = document.getElementById("pglQuickSup"); if (el) q.supervisor = el.value; } catch (e) {}
    try { el = document.getElementById("pglQuickSupSel"); if (el) q.supervisor = el.value || (quickNeedsSupervisor() && q.kind === "procedure" ? "" : guideOf()); } catch (e) {}
    return q;
  }
  function quickDictate() {
    var q = quickReadInputs(), qk = QK(), V = null;
    try { V = window.SMD_VOICE; } catch (e) {}
    if (!V || !V.listen) return toast("Voice input is not available on this device.");
    if (q.listening) { try { if (q._stop) q._stop(); } catch (e) {} q.listening = false; return render(); }
    function apply(said) {
      q.listening = false; q._stop = null;
      said = String(said || "").trim();
      if (!said) { render(); return toast("Nothing was heard."); }
      var parsed = qk.parseDictation(said, { specialty: specialtyId(), recents: recentsFor("") });
      if (parsed.kind) q.kind = parsed.kind;
      if (parsed.title) q.title = parsed.title;
      if (parsed.role) q.role = parsed.role;
      if (parsed.setting) q.setting = parsed.setting;
      if (parsed.complications.length) q.complications = parsed.complications;
      if (parsed.notes) q.notes = parsed.notes;
      q.heard = parsed.heard;
      haptic("success");
      render();
    }
    q.listening = true; q.heard = []; render();
    var ctl = V.listen({
      language: "auto",
      onFinal: apply,
      onError: function () { q.listening = false; q._stop = null; render(); toast("Could not hear that. Try again."); }
    });
    q._stop = (ctl && ctl.stop) ? function () { try { ctl.stop(); } catch (e) {} } : null;
    if (!ctl) { q.listening = false; render(); toast("Voice input is not available on this device."); }
  }

  function quickAddPhoto() {
    var ph = PH(); if (!ph || !ph.available()) return toast("Photographs need the app on a phone.");
    var q = quickReadInputs();
    if (q.photos.length >= ph.MAX_PER_ENTRY) return toast(ph.refusalText("too_many"));
    photoConsentSheet(function (ok) {
      if (!ok) return;
      pickPhoto().then(function (src) {
        if (!src) return;
        return ph.attach(src, { consent: true, deidentified: true, existingCount: q.photos.length }).then(function (r) {
          if (!r.ok) return toast(r.message || "The photograph was not saved.");
          q.photos.push(r.ref);
          haptic("success");
          toast("Photograph saved on this device, encrypted.");
          render();
        });
      }).catch(function () {});
    });
  }
  function pickPhoto() {
    try {
      if (window.SMD_IS_NATIVE && window.SMD_NATIVE && window.SMD_NATIVE.pickImage) {
        return window.SMD_NATIVE.pickImage({ prompt: true });
      }
    } catch (e) {}
    return new Promise(function (res) {
      var inp = document.createElement("input");
      inp.type = "file"; inp.accept = "image/*"; inp.style.display = "none";
      document.body.appendChild(inp);
      inp.addEventListener("change", function () {
        var f = inp.files && inp.files[0]; inp.remove(); res(f || null);
      });
      inp.click();
    });
  }
  /* Consent is per photograph and there is no "do not ask again". See pglog-photos.js. */
  function photoConsentSheet(cb) {
    var ph = PH(); if (!ph) return cb(false);
    var ov = document.createElement("div");
    ov.className = "pgl-consent-ov";
    ov.innerHTML = '<div class="pgl-consent" role="dialog" aria-modal="true" aria-label="Photograph consent">' +
      '<div class="pgl-consent-t">Before you photograph a patient</div>' +
      "<ul>" + ph.GUIDANCE.map(function (g) { return "<li>" + esc(g) + "</li>"; }).join("") + "</ul>" +
      '<label class="pgl-consent-tick"><input type="checkbox" id="pglConsentBox"><span>' + esc(ph.CONSENT_TEXT) + "</span></label>" +
      '<div class="pgl-consent-note">' + esc(ph.STORAGE_WARNING) + "</div>" +
      '<div class="pgl-consent-acts">' +
        '<button class="pgl-btn ghost" id="pglConsentNo">Cancel</button>' +
        '<button class="pgl-btn" id="pglConsentGo" disabled>Take the photograph</button>' +
      "</div></div>";
    document.body.appendChild(ov);
    var box = ov.querySelector("#pglConsentBox"), go2 = ov.querySelector("#pglConsentGo");
    box.addEventListener("change", function () { go2.disabled = !box.checked; });
    function done(v) { try { ov.remove(); } catch (e) {} cb(v); }
    ov.querySelector("#pglConsentNo").addEventListener("click", function () { done(false); });
    go2.addEventListener("click", function () { if (box.checked) done(true); });
    ov.addEventListener("click", function (e) { if (e.target === ov) done(false); });
  }
  function quickRemovePhoto(id) {
    var q = quickState(), ph = PH();
    q.photos = q.photos.filter(function (p) { return p.id !== id; });
    if (ph) ph.remove(id);
    render();
  }

  function quickSave() {
    var q = quickReadInputs(), qk = QK(), st = ST(), m = M();
    if (!qk || !st || !m) return;
    var title = q.title || q.query;
    if (!title) return toast("Pick or type what you did.");
    if (q.kind !== "academic" && !q.role) return toast("Choose your role.");
    var prefs = st.prefs() || {};
    var must = q.kind === "procedure" && quickNeedsSupervisor();
    var sup = easy() ? (q.supervisor || (must ? prefs.lastSupervisor : "") || "") : (q.supervisor || prefs.lastSupervisor || "");
    if (must && !String(sup).trim()) {
      return toast("Name the consultant who supervised this.");
    }
    var draft = qk.quickDraft({
      kind: q.kind, title: title, role: q.role,
      setting: q.setting || (q.kind === "procedure" ? "ot" : (prefs.lastSetting || "opd")),
      complications: q.complications, notes: q.notes, supervisor: sup,
      occurredAt: easy() ? (q.date || todayISO()) : todayISO()
    }, { prefs: prefs, today: todayISO(), localId: st.localId(),
      residentId: (state.dash && state.dash.resident && state.dash.resident.id) || "",
      programmeId: (state.dash && state.dash.programme && state.dash.programme.id) || "" });
    if (easy() && !must) draft.supervisor = sup;   // quickDraft would fall back to prefs.lastSupervisor
    // The quick note is the entry's remarks; `notes` is not a field of the entry schema and was dropped.
    if (q.notes && !draft.remarks) draft.remarks = q.notes;
    if (q.photos.length) draft.attachments = q.photos.slice();
    // Same validation the long form runs; a quick entry is never a shortcut past it.
    var linked = !!(state.dash && state.dash.resident);
    var v = m.validateEntry(m.entry(draft), Object.assign(validationContext(), { requireResident: linked }));
    if (!v.ok) {
      state.draft = m.entry(draft); state.draft.role = draft.role || ""; state.draftErrors = v.errors;
      toast("A couple of fields need you. Opening the full form.");
      return go("add/" + q.kind);
    }
    var saved = st.saveDraft(draft);
    noteRecent(q.kind, title);
    state.quick = null;
    haptic("success");
    if (linked && st._online() && flag("smd_pglog_server")) {
      submitAndReport(saved.id).then(function (r) {
        if (r.status === "submitted") state.dash = null;
        enter("home"); afterChange("quick");
      });
      return;
    }
    st.queueDraft(saved.id);
    toast(linked ? "Logged. It will be submitted when you are online." : "Logged on this device.");
    enter("home");
    afterChange("quick");
  }
  /* THE one place a submission is sent and explained. store.submitOrQueue() never rejects and says
   * which of three things happened: submitted (and to whom), queued (a network-type reason, retried by
   * flush), or needs_fix (the server refused THIS entry; it is kept as a draft with lastError and is
   * NOT queued). An older store without it gets the same three outcomes from submitDraft(). Only the
   * queued outcome may say "it will be submitted when you are online". */
  function submitAndReport(id) {
    var st = ST();
    var p = st.submitOrQueue ? st.submitOrQueue(id) : st.submitDraft(id).then(function (entry) {
      return { status: "submitted", entry: entry, routing: (entry && entry.routing) || "" };
    }, function (e) {
      if (isTransient(e)) { st.queueDraft(id); return { status: "queued", reason: (e && e.code) || "error" }; }
      noteSubmitError(id, e);
      return { status: "needs_fix", lastError: { code: (e && e.code) || "refused", message: refusalText(e) } };
    });
    return p.then(function (r) {
      r = r || {};
      if (r.status === "submitted") {
        if (state.submitErrors) delete state.submitErrors[id];
        var sup = r.entry && r.entry.supervisor;
        toast(r.routing === "unassigned"
          ? "Sent. Your department will assign a guide to verify it."
          : r.routing === "supervisor" && sup ? "Sent to " + personName(sup) + " for verification."
          : "Sent to your guide for verification.");
        haptic("success");
      } else if (r.status === "needs_fix") {
        var le = r.lastError || {};
        state.submitErrors = state.submitErrors || {};
        state.submitErrors[id] = { code: le.code || "refused", message: le.message || refusalText(le) };
        haptic("warning");
        toast("Not submitted: " + (le.message || refusalText(le)));
      } else {
        toast(r.reason === "not_linked"
          ? "Saved on this device. It goes to your guide once your logbook is linked."
          : "Saved. It will be submitted when you are back online.");
      }
      return r;
    });
  }
  // Anything that changed the logbook offers the (already unlocked) Drive backup a chance to run.
  function afterChange(reason) {
    try { var bk = BK(); if (bk && bk.maybeAuto) bk.maybeAuto(reason); } catch (e) {}
  }

  /* ── CSV / Excel ─────────────────────────────────────────────────────────────────────────
   * The BOM is what makes Excel read this as UTF-8; without it a degree sign or a name with an
   * accent arrives mangled. Native gets the share sheet, web gets a download. */
  function exportCsv(which) {
    var an = AN();
    if (!an) return toast("The export is still loading.");
    var entries = analyticsEntries();
    if (!entries.length) return toast("Nothing to export yet.");
    var opts = {};
    if (which && which !== "all") opts.kind = which;
    var csv = an.toCsv(entries, opts);
    var name = "stewardmd-logbook-" + todayISO() + ".csv";
    var body = "﻿" + csv;
    try {
      var C = window.Capacitor, P = C && C.Plugins;
      if (window.SMD_IS_NATIVE && P && P.Filesystem && P.Share) {
        return P.Filesystem.writeFile({ path: name, data: body, directory: "CACHE", encoding: "utf8" })
          .then(function (res) {
            return P.Share.share({ title: "Logbook export", url: res.uri, files: [res.uri], dialogTitle: "Save or send your logbook" });
          }).then(function () { toast("Exported."); }, function () { toast("Could not export."); });
      }
    } catch (e) {}
    try {
      var blob = new Blob([body], { type: "text/csv;charset=utf-8;" });
      var url = URL.createObjectURL(blob);
      var a = document.createElement("a");
      a.href = url; a.download = name; document.body.appendChild(a); a.click();
      setTimeout(function () { try { a.remove(); URL.revokeObjectURL(url); } catch (e2) {} }, 400);
      toast("Downloaded " + name);
    } catch (e) { toast("Could not export."); }
  }

  /* ── Drive backup behaviour ──────────────────────────────────────────────────────────── */
  function backupSetup() {
    var bk = BK(); if (!bk) return;
    var p1 = "", p2 = "";
    try { p1 = (document.getElementById("pglBkP1") || {}).value || ""; } catch (e) {}
    try { p2 = (document.getElementById("pglBkP2") || {}).value || ""; } catch (e) {}
    var chk = bk.checkPassword(p1, p2);
    if (!chk.ok) return toast(chk.message);
    bk.unlock(p1).then(function (r) {
      if (!r.ok) return toast(r.message || "Could not set up the backup.");
      toast("Backup password set. Remember it, it cannot be recovered.");
      render();
      backupRun();
    });
  }
  function backupUnlock() {
    var bk = BK(); if (!bk) return;
    var p1 = "";
    try { p1 = (document.getElementById("pglBkP1") || {}).value || ""; } catch (e) {}
    bk.unlock(p1).then(function (r) {
      if (!r.ok) return toast(r.message || "Could not unlock.");
      toast("Unlocked for this session.");
      render();
    });
  }
  function backupRun() {
    var bk = BK(); if (!bk) return;
    state.backupBusy = true; render();
    bk.backupNow().then(function (r) {
      state.backupBusy = false; render();
      if (r.ok) { haptic("success"); return toast("Backed up to your Drive."); }
      toast(r.error === "no_drive_account" ? "Sign in to Google in the app first." :
        r.error === "locked" ? "Enter your backup password first." : "Backup failed. Try again.");
    });
  }
  function backupRestore() {
    var bk = BK(); if (!bk) return;
    if (!window.confirm("Restore from your Drive backup? Drafts already on this phone are kept unless the backup copy is newer.")) return;
    state.backupBusy = true; render();
    bk.restoreNow().then(function (r) {
      state.backupBusy = false; render();
      if (!r.ok) {
        return toast(r.error === "no_backup" ? "No backup found in your Drive." :
          r.error === "wrong_password" ? "That password does not open this backup." : "Restore failed.");
      }
      toast("Restored " + (r.added + r.replaced) + " draft(s) and " + r.photos + " photograph(s).");
      state.dash = null;
      enter("home");
    });
  }

  /* Role is the claim PGMER-2023 9.2(c) penalises, and m.entry() would quietly turn a blank one into
   * "assisted" on the way to storage. So it is checked HERE, before anything is normalised. */
  function roleMissing(d) {
    return d && (d.kind === "procedure" || d.kind === "clinical") && !d.role;
  }
  function doSaveDraft(thenSubmit) {
    var st = ST(), m = M();
    if (!state.draft) return;
    if (state.draft.__amendId) return doAmendSave();
    if (roleMissing(state.draft)) {
      state.draftErrors = [{ field: "role", message: "Tap your role: observed, assisted, supervised or independent." }];
      render(); haptic("warning"); return toast("Choose your role.");
    }
    if (state.draft.__serverId) return doSaveServerEdit(thenSubmit);
    var linked = !!(state.dash && state.dash.resident);
    // Saving a draft does not need an enrolled resident; submitting one does. A resident whose
    // Academic Cell has not enrolled them yet can still record today's work, and that draft is what
    // gets submitted on the day they are linked.
    var v = m.validateEntry(m.entry(state.draft), Object.assign(validationContext(), { requireResident: linked }));
    state.draftErrors = v.errors;
    if (!v.ok) { render(); haptic("warning"); return toast("Fix the highlighted fields."); }
    var toSave = Object.assign({}, state.draft);
    if (state.draft.id && String(state.draft.id).indexOf("loc_") === 0) toSave.localId = state.draft.id;
    var saved = st.saveDraft(toSave);
    if (state.submitErrors) delete state.submitErrors[saved.id];
    state.draft = null; state.supEdit = false;
    if (!thenSubmit) { toast("Saved as a draft on this device."); return enter("home"); }
    if (!linked) {
      st.queueDraft(saved.id);
      toast(easy() ? "Saved on this device. It goes to your guide once your logbook is linked."
        : "Saved on this device. It can be submitted once your programme is linked.");
      return enter("home");
    }
    if (!st._online() || !flag("smd_pglog_server")) {
      st.queueDraft(saved.id);
      toast("Saved. It will be submitted when you are back online.");
      return enter("home");
    }
    state.loading = true; render();
    submitAndReport(saved.id).then(function (r) {
      state.loading = false;
      if (r.status === "submitted") state.dash = null;
      enter("home");
    });
  }
  function doSubmitExisting(id) {
    var st = ST();
    state.loading = true; render();
    submitAndReport(id).then(function (r) {
      state.loading = false;
      if (r.status === "submitted") { state.dash = null; return enter("home"); }
      render();
    });
  }
  function doWithdraw(id) {
    reasonSheet({ title: "Withdraw to correct", body: "This takes the entry out of your guide's queue so you can fix it. The withdrawal is recorded.",
      placeholder: "What is wrong with it?", confirm: "Withdraw", required: false }, function (reason) {
      if (reason === null) return;
      var st = ST();
      state.loading = true; render();
      st.withdraw(id, String(reason || "").trim()).then(function () {
        state.loading = false; state.dash = null;
        toast("Withdrawn. It is a draft again and has left your guide's queue.");
        enter("home");
      }, function (e) { state.loading = false; toast(e.userMessage || "Could not withdraw."); render(); });
    });
  }
  function doResubmit(id) {
    var st = ST();
    state.loading = true; render();
    st.resubmit(id).then(function () {
      state.loading = false; state.dash = null; toast("Resubmitted."); enter("home");
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not resubmit."); render(); });
  }
  /* AMEND a verified entry. It used to ask for a reason in window.prompt() and then send an EMPTY
   * patch, so an "amendment" re-opened verification without changing anything. Now it opens the
   * form prefilled; what the resident changes is the patch, and the reason is asked for on send. */
  var AMEND_SKIP = { id: 1, v: 1, status: 1, history: 1, revisions: 1, createdBy: 1, createdAt: 1, updatedAt: 1, submittedAt: 1,
    verifiedBy: 1, verifiedAt: 1, returnedBy: 1, returnedAt: 1, returnReason: 1, attestedIn: 1, deleted: 1, deletedBy: 1,
    deletedAt: 1, deleteReason: 1, overflowedHistory: 1, overflowedRevisions: 1, residentId: 1, programmeId: 1, orgId: 1,
    verifyCode: 1, verifiedName: 1, verifiedReg: 1, verifiedCouncil: 1, pendingFor: 1, __amendId: 1, __orig: 1, __serverId: 1 };
  function doAmend(id) {
    var se = arr(state.dash && state.dash.entries).filter(function (x) { return x.id === id; })[0];
    if (!se) return toast("That entry is not in this device's copy yet. Refresh and try again.");
    state.draft = Object.assign({}, se, { __amendId: se.id, __orig: JSON.parse(JSON.stringify(se)) });
    state.draftErrors = []; state.supEdit = false;
    return go("add/" + se.kind);
  }
  function amendPatch(d) {
    var o = d.__orig || {}, patch = {};
    Object.keys(d).forEach(function (k) {
      if (AMEND_SKIP[k] || k.charAt(0) === "_") return;
      if (JSON.stringify(d[k]) !== JSON.stringify(o[k])) patch[k] = d[k];
    });
    return patch;
  }
  function doAmendSave() {
    var st = ST(), m = M(), d = state.draft;
    if (!d || !d.__amendId) return;
    if (roleMissing(d)) { state.draftErrors = [{ field: "role", message: "Tap your role." }]; render(); return toast("Choose your role."); }
    var v = m.validateEntry(m.entry(d), Object.assign(validationContext(), { requireResident: true }));
    state.draftErrors = v.errors;
    if (!v.ok) { render(); haptic("warning"); return toast("Fix the highlighted fields."); }
    var patch = amendPatch(d);
    if (!Object.keys(patch).length) return toast("Nothing has changed yet. Edit the field that is wrong first.");
    reasonSheet({ title: "Why is this being amended?", body: "The verified original is kept in full, your reason is recorded, and it goes back to your guide for re-verification.",
      placeholder: "e.g. Wrong date, the case was on the 12th", confirm: "Send amendment" }, function (reason) {
      if (!reason) return;
      state.loading = true; render();
      st.amend(d.__amendId, patch, reason).then(function () {
        state.loading = false; state.dash = null; state.draft = null;
        toast("Amendment sent. The original is retained.");
        enter("home");
      }, function (e) { state.loading = false; toast(e.userMessage || "Could not amend."); render(); });
    });
  }
  /* LOG AGAIN: same kind and what, new date, role cleared; never the patient-specific fields. */
  function doLogAgain(id) {
    var st = ST(), m = M();
    var src = (st && st.getDraft(id)) || arr(state.dash && state.dash.entries).filter(function (x) { return x.id === id; })[0];
    if (!src) return;
    var keep = { kind: src.kind, procedureId: src.procedureId, procedureText: src.procedureText, title: src.title,
      diagnosis: src.diagnosis, setting: src.setting, academicType: src.academicType, topic: src.topic, scope: src.scope,
      place: src.place, supervisor: src.supervisor, departmentId: src.departmentId, rotationId: src.rotationId,
      requirementIds: src.requirementIds };
    var res = residentRecord() || {};
    var d = m.entry(Object.assign({ id: st.localId(), residentId: res.id || "", occurredAt: todayISO() }, keep));
    if (d.kind === "procedure" || d.kind === "clinical") d.role = "";
    state.draft = d; state.draftErrors = []; state.suggestions = []; state.supEdit = false;
    toast("Copied. Choose your role for this one.");
    return go("add/" + d.kind);
  }
  /* Dictation into one field of the full form (the same recogniser the quick screen uses). The text
   * is appended, shown in the field, and nothing is saved until the resident saves. */
  function fieldDictate(name) {
    var V = null; try { V = window.SMD_VOICE; } catch (e) {}
    if (!V || !V.listen || !state.draft) return toast("Voice input is not available on this device.");
    if (state.fieldMic) { try { if (state._fmStop) state._fmStop(); } catch (e) {} state.fieldMic = null; return render(); }
    state.fieldMic = name; render();
    var ctl = V.listen({
      language: "auto",
      onFinal: function (said) {
        state.fieldMic = null; state._fmStop = null;
        said = String(said || "").trim();
        if (!said) { render(); return toast("Nothing was heard."); }
        if (state.draft) state.draft[name] = (state.draft[name] ? String(state.draft[name]).replace(/\s+$/, "") + " " : "") + said;
        haptic("success"); render();
      },
      onError: function () { state.fieldMic = null; state._fmStop = null; render(); toast("Could not hear that. Try again."); }
    });
    state._fmStop = (ctl && ctl.stop) ? function () { try { ctl.stop(); } catch (e) {} } : null;
    if (!ctl) { state.fieldMic = null; render(); toast("Voice input is not available on this device."); }
  }
  function doSuggest() {
    var ai = AI(), c = C(), m = M();
    if (!state.draft) return;
    var unmet = {};
    state.progress.forEach(function (p) { if (p.target == null || p.done < p.target) unmet[p.requirementId] = 1; });
    var e = m.entry(state.draft);
    var run = ai ? ai.suggest(e, state.requirements, { unmet: unmet })
                 : Promise.resolve({ suggestions: c ? c.suggestRequirements(e, state.requirements, { unmet: unmet }) : [] });
    run.then(function (r) {
      state.suggestions = r.suggestions || [];
      if (!state.suggestions.length) toast("No requirement clearly matches, choose from the full list.");
      render();
    }, function () { toast("Could not suggest."); });
  }
  function pickRequirement() {
    // A plain, honest list rather than a searchable sheet: a resident tagging an entry needs to SEE
    // the provenance of what they are claiming, which a typeahead hides.
    var d = state.draft; if (!d) return;
    var sel = {}; arr(d.requirementIds).forEach(function (id) { sel[id] = 1; });
    state.suggestions = state.requirements
      .filter(function (r) { return r.kind === d.kind || r.kind === "meta"; })
      .map(function (r) { return { id: r.id, label: r.label, source: r.source, clause: r.clause, why: "", score: 0 }; });
    if (!state.suggestions.length) toast("This pack has no requirement of that kind.");
    render();
  }
  function showRequirement(id) {
    var r = state.requirements.filter(function (x) { return x.id === id; })[0];
    if (!r) return;
    var p = state.progress.filter(function (x) { return x.requirementId === id; })[0] || {};
    var msg = r.label + "\n\n" +
      (p.target == null ? p.done + " logged and verified (this requirement states no number)"
                        : p.done + " of " + p.target + (p.per && p.per !== "course" ? " per " + p.per : "")) +
      "\n\nSource: " + (C() ? C().sourceLabel(r.source) : r.source) + (r.clause ? " " + r.clause : "") +
      (r.quote ? "\n\n“" + r.quote + "”" : "") +
      (r.note ? "\n\n" + r.note : "") +
      (r.targetSource === "institution" ? "\n\nThis target was set by your institution, not by the NMC." : "");
    try { window.alert(msg); } catch (e) { toast(r.label); }
  }
  function doShare(id) {
    var rep = buildReport(id);
    if (!rep) return toast("Nothing to share.");
    var text = rep.title + "\n\n" + arr(rep.sections).map(function (s) {
      return s.heading + "\n" + arr(s.rows).map(function (r) { return arr(r).join(" | "); }).join("\n");
    }).join("\n\n");
    try {
      if (navigator.share) return navigator.share({ title: rep.title, text: text.slice(0, 8000) }).catch(function () {});
    } catch (e) {}
    try { navigator.clipboard.writeText(text); toast("Copied."); } catch (e) { toast("Could not share."); }
  }

  /* ── certification ─────────────────────────────────────────────────────────── */
  function loadCert(residentId) {
    var st = ST();
    var id = residentId || (state.dash && state.dash.resident && state.dash.resident.id);
    if (!id || !st || !st.certificates) return Promise.resolve();
    state.certLoading = true;
    return st.certificates(id).then(function (list) {
      // The CURRENT certification is the newest one. An older superseded certificate stays in the
      // record — it is history, not clutter to hide — but it is not what this screen acts on.
      var c = arr(list)[0] || null;
      state.cert = c;
      state.certLoading = false; state.certErr = null;
      if (c && c.verifyCode) {
        return st.certificate(c.id).then(function (full) {
          state.cert = full.certificate || c;
          state.certVerifyUrl = full.verifyUrl || "";
        }, function () {});
      }
    /* Record the failure. Resolving to "no certificate" on a 403 or a 500 told a resident their
     * certification did not exist, and the obvious response to that is to request a second one. */
    }, function (e) { state.certLoading = false; state.cert = null; state.certErr = e || new Error("unknown"); });
  }
  function doCertRequest() {
    var st = ST(), res = state.dash && state.dash.resident;
    if (!res) return toast("Set up your logbook first.");
    state.loading = true; render();
    st.requestCertificate({ residentId: res.id, scope: "final" }).then(function () {
      state.loading = false;
      toast("Certification opened. Your guide and the head of department have been notified.");
      haptic("success");
      loadCert(res.id).then(render);
    }, function (e) {
      state.loading = false;
      toast(e.userMessage || "Could not open a certification.");
      render();
    });
  }
  function doCertSign(id) {
    var st = ST();
    state.loading = true; render();
    st.signCertificate(id, {}).then(function (r) {
      state.loading = false;
      state.cert = r.certificate || state.cert;
      state.certVerifyUrl = r.verifyUrl || state.certVerifyUrl;
      var issued = state.cert && state.cert.status === "issued";
      toast(issued ? "Signed. The logbook is now certified." : "Signed. Waiting on the remaining signatures.");
      if (issued) celebrate("Logbook certified", "All signatures are in", "pglog-cert:" + id); else haptic("success");
      render();
    }, function (e) {
      state.loading = false;
      toast(e.userMessage || "Could not sign.");
      render();
    });
  }
  function doCertRevoke(id) {
    // `G` was never declared in this IIFE, so this threw ReferenceError on the handler's first line:
    // an HOD tapping "Revoke this certificate" got no prompt, no error and no toast, and a wrongly
    // issued certificate stayed live and verifiable by QR.
    var ask = (typeof window !== "undefined" && window.prompt) ? window.prompt : null;
    var reason = ask ? ask("Why is this certificate being revoked? This is recorded and shown to anyone who checks it.") : "";
    if (!reason || !String(reason).trim()) return toast("A reason is required.");
    var st = ST();
    state.loading = true; render();
    st.revokeCertificate(id, String(reason).trim()).then(function (c) {
      state.loading = false; state.cert = c;
      toast("Revoked."); render();
    }, function (e) {
      state.loading = false;
      toast(e.userMessage || "Could not revoke.");
      render();
    });
  }
  /* Export. The SERVER decides whether this is an official document — the client never promotes a
   * draft by deciding it looks issued. */
  function doCertPdf() {
    var r = REP(), rep = buildCertifiedReport();
    if (!rep) return toast("Nothing to export yet.");
    toast(rep.official ? "Building the certified PDF…" : "Building a draft copy…");
    try {
      var out = r.exportCertifiedPdf(rep, {
        verifyUrl: state.certVerifyUrl,
        residentName: (state.dash && state.dash.resident && state.dash.resident.name) || ""
      });
      if (out && out.catch) out.catch(function () { toast("Could not build the PDF on this device."); });
    } catch (e) { toast("Could not build the PDF on this device."); }
  }
  function buildCertifiedReport() {
    var r = REP();
    if (!r || !state.dash) return null;
    var res = state.dash.resident;
    return r.certifiedLogbook({
      resident: res, programme: state.dash.programme, entries: state.dash.entries,
      rotations: state.dash.rotations, assessments: state.dash.assessments,
      months: state.dash.months, attestations: state.dash.attestations || [],
      attendance: state.dash.attendance, weekly: state.dash.weekly,
      requirementProgress: state.progress, gaps: state.gaps, eligibility: state.eligibility,
      procedureCatalog: state.pack ? state.pack.procedureCatalog : [],
      today: todayISO(), // The NAME, not the database id. This printed "349cdc32210144cca031cccd1e0e20d4" in the header of
      // a document a resident hands to their university. /me already returns orgName.
      orgName: (state.ctx && state.ctx.orgName) || (res && res.orgId),
      departmentName: (res && (res.departmentName || res.departmentId)),
      certificate: state.cert
    });
  }

  function doVerify(id) {
    var st = ST();
    state.loading = true; render();
    st.verify(id, (state.reviewInput || {}).note || "").then(function () {
      state.loading = false; state.reviewInput = null;
      toast("Verified."); haptic("success");
      loadFaculty().then(function () { back(); });
    }, function (e) {
      state.loading = false;
      toast(e.userMessage || (e.code === "pglog_self_verify_forbidden" ? "You cannot verify your own entry." : "Could not verify."));
      render();
    });
  }
  function doReturn(id) {
    var reason = ((state.reviewInput || {}).reason || "").trim();
    if (!reason) { haptic("warning"); return toast("Say what needs correcting, a return without a reason is refused."); }
    var st = ST();
    state.loading = true; render();
    st.returnEntry(id, reason).then(function () {
      state.loading = false; state.reviewInput = null;
      toast("Returned to the resident with your reason.");
      loadFaculty().then(function () { back(); });
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not return."); render(); });
  }
  function openAssessment(entryId, templateId) {
    loadTemplates().then(function (t) {
      var tpl = t ? arr(t.templates).filter(function (x) { return x.id === templateId; })[0] : null;
      if (!tpl) return toast("That assessment form is not available.");
      var e = arr(state.faculty && state.faculty.pending).filter(function (x) { return x.id === entryId; })[0];
      state.assessment = {
        template: tpl, entryId: entryId, residentId: e ? e.residentId : "",
        scores: {}, free: {}, logbookScore: null, outcome: "satisfactory", actionPlan: "", discussed: null
      };
      go("assess");
    });
  }
  function saveAssessment() {
    var a = state.assessment, st = ST(), m = M();
    if (!a) return;
    var sc = m.scoreAssessment({ scores: a.scores, logbookScore: a.logbookScore }, a.template);
    if (sc.missing.length) { haptic("warning"); return toast("Score every criterion, a blank is not a zero."); }
    if (a.template.requireDiscussed && a.discussed == null) { haptic("warning"); return toast("Record whether this was discussed with the trainee."); }
    if (a.outcome === "remediation" && !String(a.actionPlan || "").trim()) { haptic("warning"); return toast("A remediation outcome needs an action plan."); }
    state.loading = true; render();
    st.createAssessment({
      residentId: a.residentId, templateId: a.template.id, entryId: a.entryId
    }).then(function (created) {
      return st.completeAssessment(created.id, {
        templateId: a.template.id, scores: a.scores, logbookScore: a.logbookScore,
        outcome: a.outcome, actionPlan: a.actionPlan,
        discussedWithTrainee: a.discussed,
        feedback: a.free.facultyOverall || "", strengths: a.free.strengths || "", improvements: a.free.improvements || ""
      });
    }).then(function (completed) {
      /* SIGN IT. store.signAssessment() had no callers anywhere, so every assessment stopped at
       * "completed" and none ever carried a signature - the state the model, the verify page and the
       * portfolio all treat as the finished artefact. Filling in the form IS the assessor asserting
       * it, exactly as on paper, so the signature follows the save rather than needing a second
       * screen nobody knew to visit. */
      var id = completed && completed.id;
      if (!id || !st.signAssessment) return null;
      return st.signAssessment(id).then(function () { return "signed"; }, function (e) {
        // Never lose the assessment because the signature was refused - say which happened.
        return { unsigned: (e && e.userMessage) || signErr(e) };
      });
    }).then(function (r) {
      state.loading = false; state.assessment = null;
      if (r && r.unsigned) toast("Assessment saved, but not signed: " + r.unsigned);
      else toast("Assessment saved and signed.");
      back();
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not save the assessment."); render(); });
  }
  /** The server's refusals on signing, each with a different remedy. */
  function signErr(e) {
    var c = e && e.code;
    if (c === "signer_unverified") return "your council registration is not verified yet.";
    if (c === "not_the_assessor") return "only the faculty member who made it can sign it.";
    if (c === "assessment_signed") return "it was already signed.";
    return "the server refused the signature.";
  }
  function doAiSummary() {
    var ai = AI(); if (!ai) return;
    toast("Drafting…");
    ai.progressSummary({
      trainingYear: state.dash && state.dash.trainingYear, weekly: state.dash && state.dash.weekly,
      summary: state.dash && state.dash.summary, gaps: state.gaps, months: state.dash && state.dash.months
    }).then(function (r) { state.aiSummary = r; render(); }, function () { toast("Summary unavailable."); });
  }
  function doAiReview() {
    var ai = AI(), a = state.assessment; if (!ai || !a) return;
    toast("Drafting…");
    ai.facultyReviewDraft({
      trainingYear: state.dash && state.dash.trainingYear,
      summary: state.dash && state.dash.summary, weekly: state.dash && state.dash.weekly,
      gaps: state.gaps, recent: arr(state.dash && state.dash.entries).slice(0, 12)
    }).then(function (r) { a.aiDraft = r; render(); }, function () { toast("Draft unavailable."); });
  }

  /* ── join requests, bulk enrol, guide assignment ─────────────────────────────────────────── */
  function loadJoinRequests(org) {
    state.inst = state.inst || {};
    return storeCall(["joinRequests", "listJoinRequests"], [org], function () {
      return api("/join-requests?orgId=" + encodeURIComponent(org || ""));
    }).then(function (r) {
      state.inst.joins = Array.isArray(r) ? r : arr(r && (r.requests || r.joinRequests || r.items));
      state.inst.joinsErr = null; state.inst.joinsMissing = false;
    }, function (e) {
      state.inst.joins = [];
      var c = e && e.code;
      // No endpoint (older server), or no account: show nothing rather than an error card.
      if (c === "http_404" || c === "not_found" || c === "unknown_route" || c === "signin_required" || c === "server_disabled" || c === "forbidden") {
        state.inst.joinsMissing = true; state.inst.joinsErr = null;
      } else { state.inst.joinsErr = e || new Error("unknown"); }
    });
  }
  /* The resident typed a college code. /me answers 403 for someone who is not a member (and does not
   * disclose the college), so the code is resolved by the join request itself: it either finds the
   * college ("Found <college>. Your request to join has been sent") or says the code is wrong. The
   * request grants nothing; an Academic Cell or HoD decides the role, programme and guide. */
  function sendJoinRequest() {
    var cx = state.ctx || {}, st = ST();
    var jr0 = cx.joinRequest || state.joinLocal || {};
    var code = state.joinCode || jr0.orgCode || cx.orgCode || ((st && st.context()) || {}).orgId || "";
    if (!code) { state.setupErr = "Enter your college's code first."; state.stack = ["setup"]; return render(); }
    state.joinBusy = true; state.joinErr = null; state.stack = ["home"]; render();
    return storeCall(["requestJoin"], [code], function () {
      return api("/join-request", { method: "POST", body: { orgCode: code } });
    }).then(function (r) {
      state.joinBusy = false; state.joinIntent = false;
      var jr = Object.assign({ status: "pending" }, (r && (r.joinRequest || r.request)) || {});
      if (state.ctx) state.ctx.joinRequest = jr;
      state.joinLocal = jr;
      haptic("success");
      render();
    }, function (e) {
      state.joinBusy = false; state.joinIntent = false;
      var c = e && e.code;
      if (c === "org_not_found" || c === "org_code_required") {
        state.setupErr = (e && e.userMessage) || "No college has that code. Check it with your department.";
        state.stack = ["setup"];
      } else if (c === "already_member") {
        state.ctx = null; toast((e && e.userMessage) || "You are already part of this college."); return enter("home");
      } else if (c === "disabled") {
        state.joinErr = "Your college does not take requests to join in the app yet. Ask your department to enrol you with your email.";
      } else {
        state.joinErr = (e && e.userMessage) || "The request to join could not be sent.";
      }
      render();
    });
  }
  function doJoinDecision(id, approve) {
    var host = state.host, card = host && host.querySelector('[data-jr="' + id + '"]');
    var val = function (f) { var el = card && card.querySelector('[data-jr-f="' + f + '"]'); return el ? String(el.value || "").trim() : ""; };
    var org = ((ST() && ST().context()) || {}).orgId || "";
    function finish(p, okMsg) {
      state.joinActBusy = id; render();
      return p.then(function () {
        state.joinActBusy = null; toast(okMsg); haptic("success");
        return loadJoinRequests(org).then(render, render);
      }, function (e) { state.joinActBusy = null; render(); toast((e && e.userMessage) || instErr(e, "That did not go through.")); });
    }
    if (approve) {
      var body = { programmeId: val("programmeId"), guide: val("guide") || undefined, startDate: val("startDate") || todayISO(),
        trainingYear: parseInt(val("trainingYear"), 10) || 1 };
      if (!body.programmeId) return toast("Choose a programme first.");
      return finish(storeCall(["approveJoinRequest", "approveJoin"], [id, body], function () {
        return api("/join-requests/" + encodeURIComponent(id) + "/approve", { method: "POST", body: body });
      }), "Approved. They are enrolled.");
    }
    reasonSheet({ title: "Reject this request", body: "The resident sees your reason.", placeholder: "e.g. Not in our PG programme",
      confirm: "Reject" }, function (reason) {
      if (!reason) return;
      finish(storeCall(["rejectJoinRequest", "rejectJoin"], [id, reason], function () {
        return api("/join-requests/" + encodeURIComponent(id) + "/reject", { method: "POST", body: { reason: reason } });
      }), "Request rejected.");
    });
  }
  function doEnrolBulk() {
    var host = state.host, I = state.inst = state.inst || {};
    var val = function (q) { var el = host.querySelector(q); return el ? String(el.value || "").trim() : ""; };
    var emails = val("#pglBulk").split(/[\s,;]+/).map(function (x) { return x.trim().toLowerCase(); })
      .filter(function (x, i, a) { return x && a.indexOf(x) === i; });
    var bad = emails.filter(function (x) { return !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(x); });
    if (!emails.length) return toast("Paste at least one email.");
    if (bad.length) { I.bulk = { err: true, msg: "Not an email: " + bad.slice(0, 3).join(", ") + (bad.length > 3 ? "…" : "") }; return render(); }
    var pid = val("#pglBulkProg");
    if (!pid) return toast("Choose the programme they are joining.");
    var gd = val("#pglBulkGuide"), yr = parseInt(val("#pglBulkYear"), 10) || 1;
    var org = ((ST() && ST().context()) || {}).orgId || "";
    var body = { orgId: org, programmeId: pid, rows: emails.map(function (e) {
      var r = { email: e, trainingYear: yr }; if (gd) r.guide = gd; return r; }) };
    I.bulkBusy = true; render();
    return storeCall(["enrolBulk"], [org, pid, body.rows], function () {
      return api("/enrol-bulk", { method: "POST", body: body });
    }).then(function (r) {
      I.bulkBusy = false;
      var rows = arr(r && (r.results || r.rows));
      var okN = rows.length ? rows.filter(function (x) { return x.ok !== false && !x.error; }).length : emails.length;
      var failed = rows.filter(function (x) { return x.ok === false || x.error; });
      var invited = rows.filter(function (x) { return x.invited || x.status === "invited" || x.status === "pending"; }).length;
      I.bulk = { err: !!failed.length, msg: okN + " of " + emails.length + " enrolled" +
        (invited ? " (" + invited + " will be enrolled when they first sign in)" : "") + "." +
        (failed.length ? " Not enrolled: " + failed.slice(0, 4).map(function (x) { return x.email + (x.message ? " (" + x.message + ")" : ""); }).join("; ") : "") };
      render();
    }, function (e) { I.bulkBusy = false; I.bulk = { err: true, msg: instErr(e, "Could not enrol that list.") }; render(); });
  }
  function doAssignGuide(rid) {
    var el = state.host && state.host.querySelector("#pglAssignGuide");
    var guide = el ? String(el.value || "") : "";
    if (!guide) return toast("Choose the guide.");
    state.guideBusy = true; render();
    return storeCall(["updateResident"], [rid, { guide: guide }], function () {
      return api("/residents/" + encodeURIComponent(rid), { method: "PATCH", body: { guide: guide } });
    }).then(function () {
      state.guideBusy = false;
      state.guideSet = state.guideSet || {}; state.guideSet[rid] = guide;
      var row = residentRowFor(rid); if (row && row.resident) row.resident.guide = guide;
      toast("Guide saved. " + personName(guide) + " now receives this resident's entries.");
      haptic("success"); render();
    }, function (e) { state.guideBusy = false; render(); toast((e && e.userMessage) || instErr(e, "Could not save the guide.")); });
  }

  /* ── data loading per screen ─────────────────────────────────────────────── */
  function loadFaculty() {
    var st = ST(), c = st.context();
    return st.facultyDashboard(c.orgId).then(function (d) { state.faculty = d; return d; },
      function (e) { state.error = e.userMessage || "Could not load the faculty view."; return null; });
  }
  function loadDept() {
    var st = ST(), c = st.context();
    state.loading = true; render();
    return st.deptDashboard(c.orgId, state.deptFilter).then(function (d) {
      state.dept = d; state.loading = false; render(); return d;
    }, function (e) { state.loading = false; state.error = e.userMessage || "Could not load the department view."; render(); });
  }
  // Who can actually verify. Best-effort: a failure leaves the free-text fallback, which the server
  // still checks on submit.
  function loadRoster() {
    var st = ST(), c = st.context();
    if (!c.orgId) return Promise.resolve([]);
    return st.facultyRoster(c.orgId).then(function (r) { state.roster = r; return r; }, function () { state.roster = []; });
  }
  function loadInbox() {
    var st = ST();
    return st.notifications().then(
      function (r) { state.inbox = arr(r.notifications).filter(function (n) { return !n.read; }); },
      /* KEEP what we already have. Emptying the inbox on any failure hid "your entry was returned"
       * behind a transient error - the one notification a resident has to act on, silently replaced
       * by nothing to see. A stale list is strictly better than a wrong empty one. */
      function () { state.inbox = arr(state.inbox); });
  }

  function enter(r) {
    state.stack = [r || "home"];
    state.loading = true;
    render();
    ensureContext()
      .then(function () { return loadDashboard(true); })
      .then(function () { return loadTemplates(); })
      .then(function () { if (flag("smd_pglog_server") && !(state.ctx && state.ctx.demo)) return loadInbox(); })
      .then(function () { if (flag("smd_pglog_server") && !(state.ctx && state.ctx.demo)) return loadRoster(); })
      .then(function () {
        state.loading = false;
        if (head0() === "faculty") return loadFaculty().then(render);
        if (head0() === "dept") return loadDept();
        /* The resident entered the college code: if it resolved to an institution that has not
         * enrolled them, send the request to join now instead of asking who they are again. */
        var cx = state.ctx || {};
        if (easy() && state.joinIntent && !cx.stub) {
          if (cx.resident || canFaculty() || canDept()) { state.joinIntent = false; }
          else return sendJoinRequest();
        }
        render();
      })
      .catch(function (e) {
        state.loading = false;
        // NOT ERRORS — these are ordinary states with their own screen, and showing "Could not load
        // this" for them would tell a resident their logbook is broken when it is merely not linked
        // yet, or offline, or running on-device by choice.
        var normal = { signin_required: 1, forbidden: 1, server_disabled: 1, offline: 1, network: 1, store_missing: 1 };
        var jrBody = (e && e.body && e.body.joinRequest) || null;
        if (easy() && state.joinIntent && e && (e.code === "forbidden" || e.code === "not_found" || e.status === 403 || e.status === 404)) {
          /* Not a member of that college (yet). The join request resolves the code and says whether
           * it exists; a wrong code becomes a field error on the set-up screen, not "Could not load". */
          state.ctx = { role: "viewer", caps: [], resident: null, stub: true, reason: "not_member", joinRequest: jrBody };
          return sendJoinRequest();
        }
        // A fetch that never reached a server (TypeError) is being offline, not a broken logbook.
        if (e && !e.code && !e.status && /fetch|network/i.test(String(e.message || ""))) { try { e.code = "offline"; } catch (x) {} }
        if (e && (normal[e.code] || e.status === 401 || e.status === 403)) {
          /* MARK IT. This stub is deliberate - a resident who is not linked yet gets their own
           * screen rather than an error - but ensureContext() short-circuits on `if (state.ctx)`,
           * so an unmarked stub silently becomes the permanent answer for EVERY screen, /me is
           * never retried, and surfaces that genuinely need an org (the Academic Cell console)
           * render an empty institution instead of saying "you are signed out". */
          state.ctx = state.ctx || { role: "viewer", caps: [], resident: null,
                                     stub: true, reason: (e && e.code) || "signin_required", joinRequest: jrBody };
          state.dash = state.dash || null;
          render();
          return;
        }
        state.error = (e && (e.userMessage || e.message)) || "Something went wrong.";
        render();
      });
  }

  /* ── mount ───────────────────────────────────────────────────────────────── */
  function mount(root, r) {
    state.root = root;
    state.host = root.querySelector("#pglogScroll") || root;
    enter(r || "home");
  }
  function onClose() { state.draft = null; state.draftErrors = []; state.suggestions = []; }

  var API = { mount: mount, onClose: onClose, go: go, _state: state, _render: render };
  if (typeof window !== "undefined") window.SMD_PGLOG_SCREENS = API;
})();
