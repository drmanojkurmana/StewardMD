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
  function toast(m) {
    try { if (window.toast) return window.toast(m); } catch (e) {}
    try { if (window.SB && SB.toast) return SB.toast(m); } catch (e) {}
    try { console.log("[pglog]", m); } catch (e) {}
  }
  function todayISO() { var m = M(); return m ? m.isoDate(Date.now()) : ""; }

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
    inbox: []
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
    returned: ["undo", "Returned"], draft: ["edit_note", "Draft"], queued: ["cloud_upload", "Waiting to submit"]
  };
  function vstate(s) {
    var v = VSTATE[s] || VSTATE.draft;
    return '<span class="pgl-vstate" data-s="' + attr(s) + '">' + ic(v[0]) + esc(v[1]) + "</span>";
  }

  /* ── loading the context ─────────────────────────────────────────────────── */
  function ensureContext() {
    var st = ST();
    if (!st) return Promise.reject(new Error("store_missing"));
    if (state.ctx) return Promise.resolve(state.ctx);
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
      return loadPack().then(function () { return r; });
    });
  }
  function loadPack() {
    var c = C(), st = ST();
    if (!c) return Promise.resolve(null);
    var prog = state.ctx && state.ctx.programme;
    var id = (prog && prog.curriculumId) || (st && st.context().curriculumId) || "generic-pg";
    return c.load(id).then(function (pack) {
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
    return st.dashboard(res.id).then(function (d) { state.dash = d; recompute(); return d; },
      function (e) {
        // Offline: fall back to the last mirror rather than an empty screen, and SAY it is a mirror.
        var cached = st.cachedDashboard();
        if (cached) { state.dash = cached; state.dash.stale = true; recompute(); return cached; }
        throw e;
      });
  }
  function loadTemplates() {
    var c = C();
    if (state.templates || !c) return Promise.resolve(state.templates);
    return c.loadTemplates().then(function (t) { state.templates = t; return t; }, function () { return null; });
  }

  /* ── HOME · "My NMC Logbook" ─────────────────────────────────────────────── */
  function screenHome() {
    var m = M(), st = ST();
    var res = state.dash && state.dash.resident;
    if (!res) return wrap(setupPrompt());
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
      h.push(banner("info", "cloud_off", "Showing your last synced copy — you are offline. New entries are saved on this device and submitted when you reconnect."));
    }

    // Identity strip — the "who and where" the resident should never have to re-enter.
    h.push('<div class="pgl-card">' +
      '<div class="pgl-row-t" style="font-size:16px">' + esc(res.name || "My logbook") + "</div>" +
      '<div class="pgl-row-s">' +
        esc(prog.name || ((prog.degree || "") + " " + (prog.specialtyId || ""))) +
        " · Year " + esc(String(state.dash.trainingYear || res.trainingYear || 1)) +
        (state.dash.semester ? " · Semester " + esc(String(state.dash.semester)) : "") +
        (res.unit ? " · " + esc(res.unit) : "") +
      "</div>" +
      (current ? '<div class="pgl-row-s" style="margin-top:6px">' + ic("pin_drop") +
        " Current posting: <b style=\"margin-left:3px\">" + esc(current.name) + "</b>" +
        (current.endDate ? " · ends " + esc(current.endDate) : "") + "</div>" : "") +
      "</div>");

    // Four numbers, no vanity metrics: what is done, what is waiting on someone else, what is
    // waiting on YOU, and the regulation's own weekly cadence.
    h.push('<div class="pgl-stats">' +
      stat(sum.verified || 0, "Verified") +
      stat(sum.submitted || 0, "Awaiting faculty") +
      stat((sum.draft || 0) + drafts.length + queued.length, "Needs you") +
      stat(wk.pct == null ? "—" : wk.pct + "%", "Weekly cadence") +
      "</div>");

    // The weekly strip — PGMER-2023 5.2(vi) made visible. One cell per ISO week.
    if (wk.weeks) {
      h.push('<div class="pgl-card tight">' +
        '<div class="pgl-row-s" style="justify-content:space-between">' +
          "<span><b>" + esc(String(wk.logged)) + "</b> of " + esc(String(wk.weeks)) + " weeks logged</span>" +
          prov("nmc_regulation", "5.2(vi)") + "</div>" +
        weekStrip(wk) +
        '<div class="hint" style="font-size:11.5px;color:var(--pgl-faint);margin-top:6px">' +
          "The e-logbook “needs to be updated on weekly basis”. A week counts once anything is logged in it." +
        "</div></div>");
    }

    if (outstanding.length) {
      h.push('<div class="pgl-sec-title"><span>Outstanding</span><span>' + outstanding.length + "</span></div>");
      outstanding.slice(0, 6).forEach(function (o) { h.push(actionRow(o)); });
    }

    var overdueMonths = months.filter(function (x) { return x.overdue; });
    if (overdueMonths.length) {
      h.push(banner("warn", "gavel",
        "<b>" + overdueMonths.length + " month(s)</b> without your guide's authentication (" +
        esc(overdueMonths.map(function (x) { return x.period; }).join(", ")) +
        "). " + prov("nmc_regulation", "5.2(vii)")));
    }

    // Progress by category — only requirements with a real target get a bar.
    var withTarget = state.progress.filter(function (p) { return p.target != null; });
    h.push('<div class="pgl-sec-title"><span>Training progress</span>' +
      '<button class="pgl-chip" data-pgl="go" data-r="progress" style="min-height:28px;padding:4px 10px;font-size:12px">All</button></div>');
    if (!state.requirements.length) {
      h.push(banner("info", "info", "No curriculum pack is loaded for this specialty, so only the PGMER-2023 requirements apply. The Academic Cell can add specialty requirements, which will show as institutional policy."));
    }
    (withTarget.length ? withTarget : state.progress).slice(0, 5).forEach(function (p) { h.push(progressRow(p)); });

    h.push('<div class="pgl-sec-title"><span>Recent activity</span>' +
      '<button class="pgl-chip" data-pgl="go" data-r="entries" style="min-height:28px;padding:4px 10px;font-size:12px">All entries</button></div>');
    var recent = arr(state.dash.entries).slice(0, 6);
    if (!recent.length && !drafts.length) {
      h.push(emptyState("history_edu", "Nothing logged yet",
        "Log the first thing you did today. It takes three taps.",
        '<button class="pgl-btn" data-pgl="go" data-r="add">Add activity</button>'));
    } else {
      drafts.slice(0, 3).forEach(function (d) { h.push(entryRow(d, true)); });
      recent.forEach(function (e) { h.push(entryRow(e)); });
    }

    h.push('<div class="pgl-sec-title"><span>Sections</span></div>');
    h.push(navRow("rotations", "route", "Rotations and postings", rotations.length + " recorded"));
    h.push(navRow("research", "science", "Research and thesis", researchSubtitle()));
    if (flag("smd_pglog_attendance")) h.push(navRow("attendance", "event_available", "Attendance", attendanceSubtitle()));
    h.push(navRow("progress", "insights", "Progress and gaps", state.gaps.length ? state.gaps.length + " gap(s)" : "On track"));
    if (flag("smd_pglog_reports")) h.push(navRow("reports", "description", "Reports and portfolio", "12 documents"));
    if (flag("smd_pglog_certify")) h.push(navRow("certify", "verified_user", "Certification and official PDF", certNavSubtitle()));
    if (canFaculty()) h.push(navRow("faculty", "how_to_reg", "Faculty review", "Verify, assess, authenticate"));
    if (canDept()) h.push(navRow("dept", "corporate_fare", "Department oversight", "Progress across residents"));
    h.push(navRow("check", "qr_code_scanner", "Verify a signed record", "Scan or type a verification code"));

    h.push('<div class="pgl-banner" data-t="ai" style="margin-top:18px">' + ic("policy") +
      "<div>Requirements shown here are traced to their NMC source. This app does not certify " +
      "compliance and does not determine examination eligibility — your University and institution do.</div></div>");

    var bar = '<div class="pgl-actionbar">' +
      '<button class="pgl-btn" data-pgl="go" data-r="add">' + ic("add") + "Add activity</button>" +
      (state.inbox.length ? '<button class="pgl-btn ghost" data-pgl="go" data-r="inbox">' + ic("notifications") + " " + state.inbox.length + "</button>" : "") +
      "</div>";
    return wrap(h.join("")) + bar;
  }

  function stat(v, label) { return '<div class="pgl-stat"><b>' + esc(String(v)) + "</b><span>" + esc(label) + "</span></div>"; }
  function weekStrip(wk) {
    var missed = {}; arr(wk.missed).forEach(function (w) { missed[w] = 1; });
    // Rebuild the ordered week list from the counts we have; the model already told us how many.
    var cells = [];
    for (var i = 0; i < Math.min(wk.weeks, 80); i++) cells.push("<i data-l=\"1\"></i>");
    var missCount = Math.min(arr(wk.missed).length, cells.length);
    for (var j = 0; j < missCount; j++) cells[j] = '<i data-l="0"></i>';
    return '<div class="pgl-weeks" aria-label="' + attr(wk.logged + " of " + wk.weeks + " weeks logged") + '">' + cells.join("") + "</div>";
  }
  function navRow(r, icon, title, sub) {
    return '<button class="pgl-row" data-pgl="go" data-r="' + attr(r) + '">' +
      '<span class="pgl-row-ic">' + ic(icon) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(title) + "</span>" +
      '<span class="pgl-row-s">' + esc(sub) + "</span></span>" + ic("chevron_right") + "</button>";
  }
  function actionRow(o) {
    return '<button class="pgl-row" data-pgl="' + attr(o.act || "go") + '" data-r="' + attr(o.route || "") + '" data-id="' + attr(o.id || "") + '">' +
      '<span class="pgl-row-ic">' + ic(o.icon) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(o.title) + "</span>" +
      '<span class="pgl-row-s">' + esc(o.sub) + (o.source ? " " + prov(o.source, o.clause) : "") + "</span></span>" +
      ic("chevron_right") + "</button>";
  }

  function outstandingActions() {
    var m = M(), st = ST(), out = [];
    var d = state.dash || {};
    arr(d.entries).forEach(function (e) {
      if (e.status === "returned") out.push({ act: "go", route: "entry/" + e.id, icon: "undo",
        title: "Returned: " + (REP() ? REP().activityLabel(e) : e.title),
        sub: e.returnReason || "Correct and resubmit" });
    });
    (st ? st.queued() : []).forEach(function (e) {
      out.push({ act: "go", route: "entry/" + e.id, icon: "cloud_upload", title: "Waiting to submit", sub: e.occurredAt });
    });
    var ai = AI();
    if (ai) {
      ai.reminders({
        requirements: state.requirements, requirementProgress: state.progress,
        rotations: arr(d.rotations), months: arr(d.months), today: todayISO(),
        rotationEndNoticeDays: fint("smd_pglog_verify_sla_days")
      }).slice(0, 5).forEach(function (r) {
        out.push({ act: "go", route: r.kind === "rotation_ending" ? "rotations" : "progress",
          icon: r.kind === "overdue" ? "priority_high" : r.kind === "attestation_overdue" ? "gavel" : "schedule",
          title: r.label, sub: r.kind === "overdue" ? r.days + " days overdue" : (r.days != null ? "due in " + r.days + " days" : ""),
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
    return a.attendedDays + " days · " + (a.pctOfWorkingDays == null ? "—" : a.pctOfWorkingDays + "% of working days");
  }

  function progressRow(p) {
    var pct = p.pct == null ? null : Math.max(0, Math.min(100, p.pct));
    var count = p.target == null
      ? '<span class="pgl-count">' + p.done + " <small>logged</small></span>"
      : '<span class="pgl-count">' + p.done + " <small>/ " + p.target + (p.per && p.per !== "course" ? " per " + p.per : "") + "</small></span>";
    return '<button class="pgl-row" data-pgl="req" data-id="' + attr(p.requirementId) + '">' +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(p.label) + "</span>" +
      '<span class="pgl-row-s">' + count +
        (p.pending ? " · " + p.pending + " awaiting verification" : "") +
        " " + prov(p.source, p.clause) + "</span>" +
      // No bar for an unspecified requirement: a bar implies a denominator that does not exist.
      (pct == null ? "" : '<span class="pgl-bar" data-state="' + attr(p.state) + '"><i style="width:' + pct + '%"></i></span>') +
      "</span></button>";
  }

  function entryRow(e, isDraft) {
    var r = REP();
    var status = isDraft ? (isQueued(e.id) ? "queued" : "draft") : e.status;
    return '<button class="pgl-row" data-pgl="go" data-r="entry/' + attr(e.id) + '">' +
      '<span class="pgl-row-ic">' + ic(kindIcon(e)) + "</span>" +
      '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(r ? r.activityLabel(e) : (e.title || e.kind)) + "</span>" +
      '<span class="pgl-row-s">' + esc(e.occurredAt) + " · " + esc(r ? r.kindLabel(e) : e.kind) +
        (e.role ? " · " + esc(r ? r.roleLabel(e) : e.role) : "") + " " + vstate(status) + "</span></span>" +
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

  function setupPrompt() {
    var st = ST();
    if (!flag("smd_pglog_server")) {
      return emptyState("cloud_off", "Server sync is off",
        "The logbook is running on-device only. Drafts are saved here but cannot be submitted for verification.",
        '<button class="pgl-btn" data-pgl="go" data-r="add">Log something anyway</button>');
    }
    /* ASK, do not assume (2026-08-27). This screen used to be written entirely in resident voice
     * ("your training record", "your guide's monthly authentication"), so a professor opening the
     * module was told they were an un-enrolled trainee.
     *
     * The ROLE itself is still never self-declared - it comes from the institution's membership
     * record, server-side, because someone who could call themselves faculty could sign a trainee's
     * record and PGMER-2023 9.2(c) puts a monetary penalty on exactly that. What the answer chooses
     * is which set of INSTRUCTIONS to show, nothing more. */
    return '<div class="pgl-wrap">' +
      '<div class="pgl-state"><div class="ic">' + ic("school") + "</div>" +
      '<div class="t">Set up your logbook</div>' +
      '<div class="s">StewardMD does not know your role in this programme yet. Which of these are you?</div></div>' +
      '<div class="pgl-card" style="padding:0;overflow:hidden">' +
        navRow("setup", "school", "I am a PG resident", "I am in training and will log my work here.") +
        navRow("setup-faculty", "draw", "I am faculty or HOD", "I verify, assess and sign residents' records.") +
        navRow("institution", "apartment", "I am setting up our institution", "Academic Cell: create the programme and enrol people.") +
      "</div>" +
      '<div style="text-align:center;margin-top:14px">' +
      '<button class="pgl-btn ghost" data-pgl="go" data-r="add">Just log something on this device</button></div>' +
      "</div>";
  }


  function screenSetup() {
    var st = ST(), c = st ? st.context() : {};
    return wrap(
      '<div class="pgl-card"><h3>Linking your logbook</h3>' +
      "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
      "PGMER-2023 5.2(iv) requires every institution running a PG programme to set up an Academic Cell. " +
      "That cell creates the programme in StewardMD and enrols you into it with your training dates and your guide. " +
      "Until then, anything you log stays on this device." +
      "</p></div>" +
      '<div class="pgl-field"><label for="pglOrg">Institution code (SMD-XXXXXX)</label>' +
      '<input type="text" id="pglOrg" value="' + attr(c.orgId || "") + '" placeholder="SMD-XXXXXX" autocapitalize="characters">' +
      '<div class="hint">Ask your department for the StewardMD institution code. Entering it here only tells this device where to look — it does not enrol you.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="save-org">Save and check</button>' +
      banner("info", "policy",
        "This module is <b>structured to</b> PGMER-2023 5.2(vi)–(vi). It does not claim to be certified by the NMC, " +
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
      "monthly authentication PGMER-2023 5.2(vi) requires." +
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
      var pick = mine.length
        ? '<div class="pgl-card"><h3>Your institutions</h3>' +
          '<p style="font-size:13px;color:var(--pgl-muted)">This device is not pointed at one yet. Pick it rather than creating a second.</p>' +
          mine.map(function (o) {
            return '<button class="pgl-row" data-pgl="pick-inst" data-id="' + attr(o.id) + '">' +
              '<span class="pgl-row-ic">' + ic("apartment") + "</span>" +
              '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(o.name || o.id) + "</span>" +
              '<span class="pgl-row-s">' + esc(o.code || "") + "</span></span>" + ic("chevron_right") + "</button>";
          }).join("") + "</div>"
        : "";
      return wrap(
        pick +
        '<div class="pgl-card"><h3>' + (mine.length ? "Or create another" : "Create your institution") + "</h3>" +
        "<p style=\"font-size:13.5px;line-height:1.6;color:var(--pgl-muted)\">" +
        "This creates your institution in StewardMD and gives you its <b>institution code</b>. Residents " +
        "and faculty enter that code to find the programme. You become its administrator." +
        "</p></div>" +
        '<div class="pgl-field"><label for="pglInstName">Institution name</label>' +
        '<input type="text" id="pglInstName" placeholder="e.g. Test Medical College">' +
        '<div class="hint">Already have a code? <button class="pgl-chip" data-pgl="go" data-r="setup-faculty">Enter it instead</button></div></div>' +
        '<button class="pgl-btn wide" data-pgl="create-inst"' + (I.busy ? " disabled" : "") + '>' +
          (I.busy ? "Creating…" : "Create institution") + "</button>" +
        (I.msg ? banner(I.err ? "warn" : "info", I.err ? "error" : "check_circle", esc(I.msg)) : "")
      );
    }
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
      '<div class="pgl-card"><h3>' + esc(I.orgName || (state.ctx && state.ctx.orgName) || "Your institution") + "</h3>" +
      '<p style="font-size:13.5px;line-height:1.6;color:var(--pgl-muted)">Institution code</p>' +
      '<div style="font:800 20px var(--sans);letter-spacing:.06em;color:var(--pgl-accent,#0e6e63)">' +
        esc(I.orgCode || (state.ctx && state.ctx.orgCode) || orgId) + "</div>" +
      '<p style="font-size:12.5px;line-height:1.55;color:var(--pgl-muted);margin-top:8px">' +
      "Share this with your residents and faculty. They enter it under Set up." + "</p></div>" +

      '<div class="pgl-card"><h3>PG programmes</h3>' +
      (progs.length
        ? progs.map(function (pr) {
            return '<div class="pgl-row static"><span class="pgl-row-ic">' + ic("school") + "</span>" +
              '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(pr.name || pr.specialtyId || pr.id) + "</span>" +
              '<span class="pgl-row-s">' + esc((pr.degree || "") + " · " + (pr.durationMonths || 36) + " months") + "</span></span></div>";
          }).join("")
        : '<p style="font-size:13px;color:var(--pgl-muted)">None yet. A resident cannot be enrolled until one exists.</p>') +
      '<div class="pgl-field"><label for="pglSpec">Specialty</label>' +
      '<select id="pglSpec">' + (specOpts || '<option value="">Loading the NMC list…</option>') + "</select>" +
      '<div class="hint">From PGMER-2023 Annexure-1 and Annexure-2. 15 specialties have a full curriculum pack; the rest use the PGMER requirements.</div></div>' +
      '<button class="pgl-btn wide" data-pgl="create-prog"' + (I.busy ? " disabled" : "") + ">Add programme</button></div>" +

      '<div class="pgl-card"><h3>Enrol a person</h3>' +
      '<div class="pgl-field"><label for="pglEmail">Their StewardMD email</label>' +
      '<input type="email" id="pglEmail" placeholder="name@example.com" autocapitalize="none" spellcheck="false">' +
      '<div class="hint">They must have signed in to StewardMD at least once, so the account exists.</div></div>' +
      '<div class="pgl-field"><label for="pglRole">Role</label><select id="pglRole">' +
        '<option value="pg_resident">PG resident</option>' +
        '<option value="pg_faculty">Faculty (guide)</option>' +
        '<option value="pg_hod">Head of Department</option>' +
        '<option value="academic_cell">Academic Cell</option>' +
      "</select></div>" +
      '<div class="pgl-field"><label for="pglProg">Programme (residents only)</label>' +
      '<select id="pglProg"><option value="">None</option>' + opts + "</select></div>" +
      '<div class="pgl-field"><label for="pglName">Their name</label>' +
      '<input type="text" id="pglName" placeholder="Dr. …"></div>' +
      '<div class="pgl-field"><label for="pglStart">Training start date</label>' +
      '<input type="date" id="pglStart"></div>' +
      '<button class="pgl-btn wide" data-pgl="enrol-person"' + (I.busy ? " disabled" : "") + ">" +
        (I.busy ? "Working…" : "Enrol") + "</button></div>" +
      (I.msg ? banner(I.err ? "warn" : "info", I.err ? "error" : "check_circle", esc(I.msg)) : "") +
      banner("info", "policy",
        "Enrolling someone grants them access to this institution's logbook data appropriate to their role. " +
        "An Academic Cell can add residents, faculty and HODs; it cannot create administrators.")
    );
  }

  // Server messages are written for a human already (see needsProBody / the pglog router), so prefer
  // them over a generic string; fall back only when there is nothing to show.
  function instErr(e, fallback) {
    if (e && e.userMessage) return e.userMessage;
    if (e && e.code === "forbidden") return "You do not have Academic Cell access to this institution.";
    if (e && e.code === "signin_required") return "Sign in to set up an institution.";
    return fallback;
  }
  function loadInstitution() {
    var st = ST();
    state.inst = state.inst || {};
    if (!st) return Promise.resolve();
    var org = (st.context() || {}).orgId;
    if (!org) {
      return (st.myInstitutions ? st.myInstitutions() : Promise.resolve([]))
        .then(function (list) { state.inst.mine = list || []; }, function () { state.inst.mine = []; });
    }
    var cur = C();
    return Promise.all([
      st.programmes(org).then(function (r) { return (r && r.programmes) || []; }, function () { return []; }),
      (cur && cur.loadSpecialties)
        ? cur.loadSpecialties().then(function (b) { return [].concat((b && b.broad) || [], (b && b.super) || []); },
                                     function () { return []; })
        : Promise.resolve([])
    ]).then(function (r) {
      state.inst.programmes = r[0];
      state.inst.specialties = r[1];
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
    if (flag("smd_pglog_attendance")) kinds.push(["attendance", "event_available", "Attendance", "Present, leave or absent"]);
    var h = kinds.map(function (k) {
      return '<button class="pgl-row" data-pgl="go" data-r="add/' + k[0] + '">' +
        '<span class="pgl-row-ic">' + ic(k[1]) + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(k[2]) + "</span>" +
        '<span class="pgl-row-s">' + esc(k[3]) + "</span></span>" + ic("chevron_right") + "</button>";
    });
    var drafts = ST() ? ST().drafts() : [];
    if (drafts.length) {
      h.push('<div class="pgl-sec-title"><span>Unfinished drafts</span><span>' + drafts.length + "</span></div>");
      drafts.slice(0, 5).forEach(function (d) { h.push(entryRow(d, true)); });
    }
    return wrap(h.join(""));
  }

  // The form. Every field the resident already told StewardMD is prefilled from their context.
  function screenAddForm(kind) {
    var m = M(), st = ST(), prefs = st ? st.prefs() : {};
    var d = state.draft;
    if (!d || d.kind !== kind) {
      var res = (state.dash && state.dash.resident) || (state.ctx && state.ctx.resident) || {};
      var current = currentRotation();
      d = state.draft = m.entry({
        id: st ? st.localId() : "loc_tmp", kind: kind,
        residentId: res.id, occurredAt: todayISO(),
        departmentId: (current && current.departmentId) || res.departmentId || prefs.lastDepartmentId || "",
        rotationId: (current && current.id) || "",
        unit: res.unit || "",
        supervisor: (current && current.faculty) || prefs.lastSupervisor || res.guide || "",
        setting: kind === "clinical" ? (prefs.lastSetting || "opd") : undefined,
        role: kind === "academic" ? "presented" : "assisted"
      });
      state.draftErrors = [];
      state.suggestions = [];
    }
    var errs = {}; arr(state.draftErrors).forEach(function (e) { errs[e.field] = e.message; });
    var h = [];

    h.push(field("Date", "occurredAt", '<input type="date" data-f="occurredAt" value="' + attr(d.occurredAt) + '" max="' + attr(todayISO()) + '">',
      "When the work was done. Log in real time where you can — the delay is recorded and shown.", errs));

    if (kind === "procedure") h.push(procedureFields(d, errs));
    else if (kind === "clinical") h.push(clinicalFields(d, errs));
    else if (kind === "academic") h.push(academicFields(d, errs));
    else if (kind === "research") h.push(researchFields(d, errs));
    else if (kind === "certification") h.push(certificationFields(d, errs));
    else if (kind === "attendance") h.push(attendanceFields(d, errs));
    else if (kind === "reflection") h.push(reflectionFields(d, errs));

    // Role ladder — the graded responsibility PGMER-2023 5.2(x) describes. Not shown for kinds
    // where it is meaningless.
    if (kind === "procedure" || kind === "clinical") {
      h.push('<div class="pgl-field"><label>Your role</label><div class="pgl-chips">' +
        m.ROLES.map(function (r) {
          return '<button class="pgl-chip" data-f-chip="role" data-v="' + r + '" aria-pressed="' + (d.role === r ? "true" : "false") + '">' +
            esc(m.ROLE_LABEL[r]) + "</button>";
        }).join("") + "</div>" +
        (errs.role ? '<div class="pgl-err">' + esc(errs.role) + "</div>" : "") +
        '<div class="hint">' + esc("PGMER-2023 5.2(vi) requires MS / M.Ch students to record every surgical procedure assisted or done independently.") + "</div></div>");
    }

    // A PICKER, not a text box. `pendingFor` is a copy of this value and is the only thing that puts
  // the entry in someone's queue, so a typo here produces an entry that is "submitted" and reaches
  // nobody. The server refuses an unresolvable supervisor; this is how the resident avoids one.
  var roster = arr(state.roster);
  if (roster.length) {
    var known = roster.some(function (m) { return m.identity === d.supervisor; });
    h.push(field("Faculty / supervisor", "supervisor",
      '<select data-f="supervisor">' +
        '<option value="">— choose —</option>' +
        roster.map(function (m) {
          return '<option value="' + attr(m.identity) + '"' + (d.supervisor === m.identity ? " selected" : "") + ">" +
            esc(REP().person(m.identity)) + (m.role === "pg_hod" ? " (HOD)" : "") + "</option>";
        }).join("") +
        (d.supervisor && !known ? '<option value="' + attr(d.supervisor) + '" selected>' + esc(d.supervisor) + " (not on the faculty list)</option>" : "") +
      "</select>",
      "They receive this entry for verification (PGMER-2023 5.2(vii)). Only people who can actually " +
      "verify are listed — an unlisted name would mean nobody receives it.", errs));
  } else {
    h.push(field("Faculty / supervisor", "supervisor",
      '<input type="text" data-f="supervisor" value="' + attr(d.supervisor) + '" placeholder="Who supervised this?">',
      "They receive the entry for verification (PGMER-2023 5.2(vii)). The faculty list is not loaded " +
      "on this device yet, so this is free text; it will be checked against the list when you submit.", errs));
  }

    if (arr(state.dash && state.dash.rotations).length) {
      h.push(field("Rotation / posting", "rotationId",
        '<select data-f="rotationId"><option value="">Not linked</option>' +
        arr(state.dash.rotations).map(function (r) {
          return '<option value="' + attr(r.id) + '"' + (d.rotationId === r.id ? " selected" : "") + ">" + esc(r.name) + "</option>";
        }).join("") + "</select>", "", errs));
    }

    h.push(field("Remarks", "remarks", '<textarea data-f="remarks" placeholder="Optional">' + esc(d.remarks) + "</textarea>", "", errs));

    // Requirement mapping — deterministic first, AI clearly labelled and opt-in.
    h.push(requirementPicker(d));

    h.push('<div class="pgl-banner" data-t="ai">' + ic("shield_person") +
      "<div><b>No patient identity.</b> This is an educational logbook, not a second record of the patient. " +
      "A case reference is a hospital/MRN reference only; a name, phone number or Aadhaar typed into it is stripped before it is stored.</div></div>");

    var bar = '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="save-draft">Save draft</button>' +
      '<button class="pgl-btn" data-pgl="submit-draft">' + ic("send") + "Submit</button></div>";
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
        '<select data-f="procedureId"><option value="">— choose, or type below —</option>' +
        cat.map(function (p) {
          return '<option value="' + attr(p.id) + '"' + (d.procedureId === p.id ? " selected" : "") + ">" +
            esc(p.label) + (p.target != null ? " (" + p.target + " required)" : "") + "</option>";
        }).join("") + "</select>",
        "From your specialty's NMC curriculum. Numbers in brackets are the NMC minimum where the curriculum states one.", errs);
    }
    h += field(cat.length ? "Or name it" : "Procedure", "procedure",
      '<input type="text" data-f="procedureText" value="' + attr(d.procedureText) + '" placeholder="e.g. Central venous access">',
      cat.length ? "" : "Your specialty's NMC guidelines list no procedure catalogue, so type it. It is still counted.", errs);
    h += field("Case reference", "caseRef",
      '<input type="text" data-f="caseRef" value="' + attr(d.caseRef) + '" placeholder="MRN / IP number" maxlength="32">',
      "Hospital reference only. Never a patient name.", errs);
    h += '<div class="pgl-field"><label>Setting</label><div class="pgl-chips">' +
      ["ot", "ipd", "emergency", "opd", "bedside", "daycare"].map(function (s) {
        return '<button class="pgl-chip" data-f-chip="setting" data-v="' + s + '" aria-pressed="' + (d.setting === s ? "true" : "false") + '">' +
          esc(s.toUpperCase()) + "</button>";
      }).join("") + "</div></div>";
    h += field("Outcome", "outcome", selectOf("outcome", M().OUTCOMES, d.outcome), "", errs);
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
    h += field("Case / problem", "title", '<input type="text" data-f="title" value="' + attr(d.title) + '" placeholder="e.g. Community-acquired pneumonia">', "", errs);
    h += field("Diagnosis / category", "diagnosis", '<input type="text" data-f="diagnosis" value="' + attr(d.diagnosis) + '" placeholder="Optional">', "", errs);
    h += field("Case reference", "caseRef", '<input type="text" data-f="caseRef" value="' + attr(d.caseRef) + '" placeholder="MRN / IP number" maxlength="32">',
      "Hospital reference only. Never a patient name.", errs);
    h += '<div class="pgl-field"><label>Age band and sex (optional)</label><div style="display:flex;gap:8px">' +
      selectOf("ageBand", [""].concat(M().AGE_BANDS), d.ageBand) +
      selectOf("sex", ["", "male", "female", "other"], d.sex) + "</div>" +
      '<div class="hint">A band, never a date of birth.</div></div>';
    h += field("Outcome", "outcome", selectOf("outcome", M().OUTCOMES, d.outcome), "", errs);
    return h;
  }
  function academicFields(d, errs) {
    var m = M();
    var h = field("Activity", "academicType",
      '<select data-f="academicType">' + m.ACADEMIC_TYPES.map(function (t) {
        return '<option value="' + t + '"' + (d.academicType === t ? " selected" : "") + ">" + esc(m.ACADEMIC_LABEL[t] || t) + "</option>";
      }).join("") + "</select>",
      "PGMER-2023 5.2(x) names lectures, seminars, journal clubs, group discussions, laboratory work, clinical meetings, grand rounds and CPCs; 5.2(viii) requires teaching undergraduates.", errs);
    h += field("Topic", "topic", '<input type="text" data-f="topic" value="' + attr(d.topic) + '" placeholder="What was it about?">', "", errs);
    h += '<div class="pgl-field"><label>Your role</label><div class="pgl-chips">' +
      m.ACADEMIC_ROLES.map(function (r) {
        return '<button class="pgl-chip" data-f-chip="role" data-v="' + r + '" aria-pressed="' + (d.role === r ? "true" : "false") + '">' +
          esc(r.charAt(0).toUpperCase() + r.slice(1)) + "</button>";
      }).join("") + "</div></div>";
    h += field("Where", "scope", selectOf("scope", m.ACADEMIC_SCOPES, d.scope), "", errs);
    h += field("Place", "place", '<input type="text" data-f="place" value="' + attr(d.place) + '" placeholder="Department, institution or venue">', "", errs);
    return h;
  }
  function researchFields(d, errs) {
    var m = M(), r = REP();
    var h = field("Type", "subtype", selectOf("subtype", m.RESEARCH_SUBTYPES, d.subtype), "", errs);
    if (d.subtype === "thesis_milestone") {
      h += field("Milestone", "milestone",
        '<select data-f="milestone">' + m.RESEARCH_MILESTONES.map(function (x) {
          return '<option value="' + x + '"' + (d.milestone === x ? " selected" : "") + ">" + esc(r ? r.milestoneLabel(x) : x) + "</option>";
        }).join("") + "</select>",
        "PGMER-2023 makes thesis a curriculum component (2.2(iii)) but prescribes no milestone chain — these are your institution's.", errs);
    }
    h += field("Title", "projectTitle", '<input type="text" data-f="projectTitle" value="' + attr(d.projectTitle) + '" placeholder="Thesis or project title">', "", errs);
    h += field("Guide", "guide", '<input type="text" data-f="guide" value="' + attr(d.guide) + '">', "", errs);
    if (d.subtype === "publication") {
      h += field("Journal", "journal", '<input type="text" data-f="journal" value="' + attr(d.journal) + '">', "", errs);
      h += '<div class="pgl-field"><div class="pgl-chips">' +
        '<button class="pgl-chip" data-f-toggle="firstAuthor" aria-pressed="' + (d.firstAuthor ? "true" : "false") + '">First author</button>' +
        '<button class="pgl-chip" data-f-toggle="indexed" aria-pressed="' + (d.indexed ? "true" : "false") + '">Indexed journal</button></div>' +
        '<div class="hint">PGMER-2023 5.2(x) counts a publication toward the examination pre-requisite only when you are the <b>first author</b>.</div></div>';
    }
    if (d.subtype === "poster" || d.subtype === "conference_paper" || d.subtype === "presentation") {
      h += field("Conference", "conference", '<input type="text" data-f="conference" value="' + attr(d.conference) + '">', "", errs);
      h += field("Level", "conferenceLevel", selectOf("conferenceLevel", ["", "institutional", "state", "zonal", "national", "international"], d.conferenceLevel), "", errs);
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
      '<div class="hint">All three are mandatory in the first year and are a pre-requisite for the final examination. ' + prov("nmc_regulation", "5.2(xi)") + "</div></div>";
    h += field("Issuing institution", "issuer", '<input type="text" data-f="issuer" value="' + attr(d.issuer) + '">', "", errs);
    h += field("Certificate number", "certificateNo", '<input type="text" data-f="certificateNo" value="' + attr(d.certificateNo) + '">',
      "The regulation names the certificate as the acceptable evidence — attach it or enter its number.", errs);
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
      "is your institution's rule — this records, it does not adjudicate.");
    return h;
  }
  function reflectionFields(d, errs) {
    var h = '<div class="pgl-field"><label>Type</label><div class="pgl-chips">' +
      [["critical_incident", "Critical incident"], ["learning_point", "Learning point"], ["feedback_received", "Feedback received"], ["other", "Other"]].map(function (x) {
        return '<button class="pgl-chip" data-f-chip="subtype" data-v="' + x[0] + '" aria-pressed="' + (d.subtype === x[0] ? "true" : "false") + '">' + esc(x[1]) + "</button>";
      }).join("") + "</div>" +
      '<div class="hint">The 2022-revised NMC curricula ask PG students to “reflect and record their reflections in log book particularly of the critical incidents”.</div></div>';
    h += field("Reflection", "body", '<textarea data-f="body" style="min-height:150px" placeholder="What happened, what you thought, what you would do differently">' + esc(d.body) + "</textarea>", "", errs);
    return h;
  }
  function selectOf(name, values, current) {
    return '<select data-f="' + attr(name) + '">' + arr(values).map(function (v) {
      return '<option value="' + attr(v) + '"' + (current === v ? " selected" : "") + ">" + esc(v || "—") + "</option>";
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
      if (why) h += '<div class="hint">Suggested because: ' + esc(why.why) + ". Tap to accept — nothing is tagged automatically.</div>";
      if (sug.some(function (s) { return s.source === "ai"; })) {
        h += banner("ai", "auto_awesome", "<b>" + esc(AI() ? AI().LABEL : "Suggestion") + "</b> — a suggestion is never a completed competency. Only a faculty verification makes an entry count.");
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
    var status = local ? (isQueued(id) ? "queued" : "draft") : e.status;
    var h = [];

    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(r.activityLabel(e)) + "</div>" +
      '<div class="pgl-row-s" style="margin-top:6px">' + esc(e.occurredAt) + " · " + esc(r.kindLabel(e)) +
      (e.role ? " · " + esc(r.roleLabel(e)) : "") + "</div>" +
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
    kv("Supervisor", r.person(e.supervisor));
    kv("Department", e.departmentId);
    kv("Case reference", e.caseRef);
    kv("Diagnosis", e.diagnosis);
    kv("Setting", e.setting);
    kv("Outcome", e.outcome);
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
        rows.map(function (kvp) { return "<dt>" + esc(kvp[0]) + "</dt><dd>" + esc(kvp[1]) + "</dd>"; }).join("") + "</dl></div>");
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
            '<span class="when">' + esc(m.isoDate(x.at)) + "</span> · " + esc(r.person(x.by)) +
            (x.reason ? '<span class="why">' + esc(x.reason) + "</span>" : "") + "</li>";
        }).join("") + "</ul>" +
        (arr(e.revisions).length
          ? '<div class="hint" style="margin-top:8px">' + arr(e.revisions).length +
            " amendment(s). The verified original of each is retained in full and is never overwritten.</div>"
          : "") +
        (e.attestedIn ? '<div class="hint">Covered by the guide\'s authentication for ' + esc(e.attestedIn) + ". " + prov("nmc_regulation", "5.2(vii)") + "</div>" : "") +
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
        '<button class="pgl-btn ghost" data-pgl="edit-draft" data-id="' + attr(id) + '">Edit</button>' +
        '<button class="pgl-btn" data-pgl="submit-existing" data-id="' + attr(id) + '">' + ic("send") + "Submit</button></div>";
    } else if (e.status === "submitted") {
      bar = '<div class="pgl-actionbar">' +
        '<button class="pgl-btn ghost" data-pgl="withdraw" data-id="' + attr(id) + '">' + ic("undo") + "Withdraw to correct</button></div>";
      h.push(banner("info", "hourglass_top",
        "This is with <b>" + esc(r.person(e.supervisor)) + "</b> for verification and cannot be edited while it is " +
        "there — they would end up signing something different from what they read. Withdraw it first; that clears " +
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
        stat(a.pctOfWorkingDays == null ? "—" : a.pctOfWorkingDays + "%", "Of working days") + "</div>" +
        '<div class="pgl-row-s" style="margin-top:10px">Threshold ' + esc(String(a.thresholdPct)) + "% " + prov("nmc_regulation", "5.5") +
        (a.thresholdDays ? " · " + esc(String(a.thresholdDays)) + " days " + prov("nmc_faq_secondary", "PGMEB FAQ 10.04.2024") : "") + "</div>" +
        '<div class="hint" style="margin-top:8px">' + esc(a.note) + "</div></div>");
    }

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
      "5% of the practical marks (8.1). It prescribes no milestone chain — this one is your institution's, and the " +
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
      stat(a.pctOfWorkingDays == null ? "—" : a.pctOfWorkingDays + "%", "Of working days") +
      stat(a.requiredDays || "—", "Needed for the course") + "</div>" +
      '<div class="pgl-row-s" style="margin-top:10px">' +
        esc("The PGMEB FAQ defines the 80% as a percentage of WORKING days — calendar days minus 52 weekly offs a year. " +
            "A three-year course has " + (a.courseWorkingDays || 939) + " working days, of which 80% is " + (a.requiredDays || 751) + ".") +
        " " + prov("nmc_faq", "FAQ 10.04.2024 Q2") + "</div>" +
      (a.termExtension && a.termExtension.totalDays
        ? banner("info", "event_repeat", "Your training is extended by <b>" + a.termExtension.totalDays +
            " days</b> (" + a.termExtension.maternity + " maternity, " + a.termExtension.paternity +
            " paternity, " + a.termExtension.excessCasual + " excess casual leave). This does <b>not</b> " +
            "reduce your attendance percentage — it moves the end of training. " + prov("nmc_faq", "FAQ Q1, Q2"))
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
    return wrap(REP().toHtml(rep)) +
      '<div class="pgl-actionbar">' +
      '<button class="pgl-btn ghost" data-pgl="print" data-id="' + attr(id) + '">' + ic("print") + "Print / PDF</button>" +
      '<button class="pgl-btn ghost" data-pgl="share" data-id="' + attr(id) + '">' + ic("ios_share") + "Share</button>" +
      (id === "resident_logbook" || id === "procedure_report"
        ? '<button class="pgl-btn ghost" data-pgl="toggle-ref" data-id="' + attr(id) + '">' +
          ic(state.includeCaseRef ? "visibility_off" : "visibility") + (state.includeCaseRef ? "Hide refs" : "Show refs") + "</button>"
        : "") +
      "</div>";
  }
  function buildReport(id) {
    var r = REP(), m = M();
    if (!r || !state.dash) return null;
    if (id === "department_summary") {
      if (!state.dept) return null;
      return r.departmentSummary({ residents: state.dept.residents, today: todayISO(),
        departmentName: state.deptFilter.departmentId, orgName: (ST() ? ST().context().orgId : "") });
    }
    var res = state.dash.resident;
    var ctx = {
      resident: res, programme: state.dash.programme, entries: state.dash.entries,
      rotations: state.dash.rotations, assessments: state.dash.assessments,
      months: state.dash.months, attestations: state.dash.attestations || [],
      attendance: state.dash.attendance, weekly: state.dash.weekly,
      requirementProgress: state.progress, gaps: state.gaps, eligibility: state.eligibility,
      procedureCatalog: state.pack ? state.pack.procedureCatalog : [],
      today: todayISO(), orgName: res && res.orgId, departmentName: res && res.departmentId
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

  function screenFaculty() {
    var f = state.faculty, r = REP();
    if (!f) return loading();
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
        "<span class=\"pgl-clause\">Institutional policy — NMC sets no per-entry SLA, only the monthly authentication in 5.2(vii).</span>"));
    }
    h.push('<div class="pgl-sec-title"><span>Awaiting your verification</span><span>' + arr(f.pending).length + "</span></div>");
    if (!arr(f.pending).length) h.push(emptyState("task_alt", "Nothing waiting", "Every entry submitted to you has been reviewed."));
    arr(f.pending).forEach(function (e) {
      h.push('<button class="pgl-row" data-pgl="go" data-r="review/' + attr(e.id) + '">' +
        '<span class="pgl-row-ic">' + ic(kindIcon(e)) + "</span>" +
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(r.activityLabel(e)) + "</span>" +
        '<span class="pgl-row-s">' + esc(e.occurredAt) + " · " + esc(r.kindLabel(e)) +
        (e.role ? " · " + esc(r.roleLabel(e)) : "") + "</span></span>" + ic("chevron_right") + "</button>");
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
    return wrap(h.join(""));
  }

  // The review sheet: Open -> Review -> Assess -> Feedback -> Verify / Return.
  function screenReview(id) {
    var f = state.faculty, r = REP(), m = M();
    var e = arr(f && f.pending).filter(function (x) { return x.id === id; })[0] || state.review;
    if (!e) return wrap(errorState("That entry is no longer pending."));
    var h = [];
    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(r.activityLabel(e)) + "</div>" +
      '<div class="pgl-row-s" style="margin-top:6px">' + esc(e.occurredAt) + " · " + esc(r.kindLabel(e)) +
      (e.role ? " · " + esc(r.roleLabel(e)) : "") + "</div>" +
      (m.latencyDays(e) > 3 ? '<div class="hint" style="margin-top:6px">Logged ' + m.latencyDays(e) + " days after the event.</div>" : "") +
      "</div>");
    var rows = [];
    [["Case reference", e.caseRef], ["Diagnosis", e.diagnosis], ["Setting", e.setting], ["Outcome", e.outcome],
     ["Complications", arr(e.complications).join(", ")], ["Topic", e.topic], ["Remarks", e.remarks]]
      .forEach(function (kv) { if (kv[1]) rows.push(kv); });
    if (rows.length) {
      h.push('<div class="pgl-card"><dl class="pgl-rep-meta">' +
        rows.map(function (kv) { return "<dt>" + esc(kv[0]) + "</dt><dd>" + esc(kv[1]) + "</dd>"; }).join("") + "</dl></div>");
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
      '<div class="hint">A return without a reason is refused — the resident has to know what to fix.</div></div>');
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
        '<div class="hint">Required — a remediation outcome without a plan is refused.</div></div>');
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
      return (x.weekly && x.weekly.pct != null && x.weekly.pct < 70) || (x.attestationOverdue || 0) > 0 || (x.overdueVerifications || 0) > 0;
    });
    var h = [];
    h.push('<div class="pgl-stats">' +
      stat(rows.length, "Residents") +
      stat(attention.length, "Need intervention") +
      stat(rows.reduce(function (a, x) { return a + ((x.summary || {}).submitted || 0); }, 0), "Awaiting verification") +
      stat(rows.reduce(function (a, x) { return a + (x.attestationOverdue || 0); }, 0), "Months unauthenticated") +
      "</div>");
    if (d.audience === "aggregate") {
      h.push(banner("info", "shield_person",
        "Institution-wide view. It shows training completeness only — no case reference, diagnosis or clinical " +
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
    if (x.attestationOverdue) why.push(x.attestationOverdue + " month(s) unauthenticated");
    if (x.overdueVerifications) why.push(x.overdueVerifications + " overdue verifications");
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
    var x = arr(d && d.residents).filter(function (y) { return (y.resident || {}).id === id; })[0];
    if (!x) return wrap(errorState("That resident is not in the current list."));
    var res = x.resident;
    var h = [];
    h.push('<div class="pgl-card"><div class="pgl-row-t" style="font-size:16px">' + esc(res.name || res.id) + "</div>" +
      '<div class="pgl-row-s">Year ' + esc(String(res.trainingYear || "")) + (res.unit ? " · " + esc(res.unit) : "") +
      (res.guide ? " · guide " + esc(REP().person(res.guide)) : "") + "</div></div>");
    h.push('<div class="pgl-stats">' +
      stat((x.summary || {}).verified || 0, "Verified") +
      stat((x.summary || {}).submitted || 0, "Awaiting") +
      stat(x.weekly && x.weekly.pct != null ? x.weekly.pct + "%" : "—", "Weekly cadence") +
      stat(x.attestationOverdue || 0, "Months to authenticate") + "</div>");
    if (x.attendance) {
      h.push('<div class="pgl-card tight"><div class="pgl-row-s">Attendance ' +
        (x.attendance.pctOfRecorded == null ? "not recorded" : x.attendance.pctOfRecorded + "% of recorded days") +
        " " + prov("nmc_regulation", "5.5") + "</div></div>");
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
        superseded: ["history", "warn", "Superseded — the record was amended after signing"],
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
      issued: ["info", "verified", "Certified — ready to share"],
      pending: ["warn", "hourglass_top", "Awaiting signatures"],
      superseded: ["warn", "history", "Superseded — a covered record was corrected after signing"],
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
      stat(c.monthsTotal ? c.monthsAttested + "/" + c.monthsTotal : "—", "Months signed") +
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
        '<span class="pgl-row-main"><span class="pgl-row-t">' + esc(sig.name || REP().person(sig.by)) + "</span>" +
        '<span class="pgl-row-s">' + esc(sig.role === "hod" ? "Head of Department" : sig.role === "guide" ? "Postgraduate guide" : "Faculty") +
        (sig.reg ? " · Reg " + esc(sig.reg) : "") + (sig.at ? " · " + esc(m.isoDate(sig.at)) : "") + "</span></span></div>");
    });

    h.push(certRuleCard(c));

    if (c.status === "issued" && c.verifyCode) {
      h.push('<div class="pgl-card"><h3>Verification</h3>' + qrBlock(c.verifyCode, "Scan to verify this certified logbook", state.certVerifyUrl) +
        '<p class="hint">Printed on the exported PDF. Anyone can scan it — no StewardMD account needed.</p></div>');
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
    if (c.status === "superseded") return "Superseded — a covered record was corrected";
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
        (q.hodCountsAsFaculty ? " — the Head of Department counts toward both, so two people can complete it." : ".")) + "</p>" +
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
      "Technology Act, 2000 — no licensed Certifying Authority key is applied — and it is not an NMC or " +
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
        if (a) { title = "Log " + a; sub = "New entry"; body = screenAddForm(a); }
        else { title = "Add activity"; body = screenAddPicker(); }
        break;
      case "entries": title = "All entries"; body = screenEntries(); break;
      case "entry": title = "Entry"; body = screenEntry(a); break;
      case "progress": title = "Progress"; sub = "Against NMC requirements"; body = screenProgress(); break;
      case "rotations": title = "Rotations"; body = screenRotations(); break;
      case "research": title = "Research and thesis"; body = screenResearch(); break;
      case "attendance": title = "Attendance"; sub = "PGMER-2023 5.5"; body = screenAttendance(); break;
      case "reports": title = "Reports"; body = screenReports(); break;
      case "report": title = "Report"; body = screenReport(a); break;
      case "faculty": title = "Faculty review"; sub = "Verify and assess"; body = screenFaculty(); break;
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
        return go(dest);
      }
      case "retry": state.error = ""; return enter(t.getAttribute("data-r"));
      case "filter":
        state.filter[t.getAttribute("data-dim")] = t.getAttribute("data-v");
        return render();
      case "deptfilter":
        state.deptFilter[t.getAttribute("data-dim")] = t.getAttribute("data-v");
        return loadDept();
      case "pick-inst": {
        st.setContext({ orgId: t.getAttribute("data-id") });
        state.ctx = null; state.dash = null; state.inst = {};
        return loadInstitution().then(render, render);
      }
      case "create-inst": {
        var nm = ((state.host.querySelector("#pglInstName") || {}).value || "").trim();
        if (!nm) { toast("Enter the institution name."); return; }
        state.inst = { busy: true }; render();
        return st.createInstitution(nm).then(function (org) {
          // Point this device at the new org immediately, or the creator has to type their own code.
          st.setContext({ orgId: org.id });
          state.ctx = null; state.dash = null;
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
        var email = val("#pglEmail"), role = val("#pglRole"), pid = val("#pglProg");
        if (!email) { toast("Enter their email."); return; }
        // A resident with no programme is enrolled as a member but still has no logbook, which is
        // exactly the half-linked state this whole path exists to remove.
        if (role === "pg_resident" && !pid) { toast("A resident needs a programme. Add one first."); return; }
        var org2 = (st.context() || {}).orgId;
        state.inst = state.inst || {}; state.inst.busy = true; render();
        return st.enrolPerson(org2, {
          email: email, role: role, programmeId: pid || undefined,
          name: val("#pglName"), startDate: val("#pglStart") || undefined, trainingYear: 1
        }).then(function () {
          state.inst.busy = false; state.inst.err = false;
          state.inst.msg = email + " enrolled as " + role.replace("pg_", "").replace(/_/g, " ") + ".";
          render();
        }, function (e) {
          state.inst.busy = false; state.inst.err = true;
          state.inst.msg = (e && e.code === "no_such_account")
            ? (email + " has not signed in to StewardMD yet, so there is no account to enrol. Ask them to sign in once, then try again.")
            : instErr(e, "Could not enrol " + email + ".");
          render();
        });
      }
      case "save-org": {
        var v = (state.host.querySelector("#pglOrg") || {}).value || "";
        st.setContext({ orgId: v.trim().toUpperCase() });
        state.ctx = null; state.dash = null;
        toast("Checking…");
        return enter("home");
      }
      case "save-draft": return doSaveDraft(false);
      case "submit-draft": return doSaveDraft(true);
      case "submit-existing": return doSubmitExisting(id);
      case "edit-draft": {
        var d = st.getDraft(id);
        if (d) { state.draft = d; go("add/" + d.kind); }
        return;
      }
      case "edit-server": return toast("Open the entry, correct the fields, then Resubmit.");
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
  function doSaveDraft(thenSubmit) {
    var st = ST(), m = M();
    if (!state.draft) return;
    var linked = !!(state.dash && state.dash.resident);
    // Saving a draft does not need an enrolled resident; submitting one does. A resident whose
    // Academic Cell has not enrolled them yet can still record today's work, and that draft is what
    // gets submitted on the day they are linked.
    var v = m.validateEntry(m.entry(state.draft), Object.assign(validationContext(), { requireResident: linked }));
    state.draftErrors = v.errors;
    if (!v.ok) { render(); haptic("warning"); return toast("Fix the highlighted fields."); }
    var saved = st.saveDraft(state.draft);
    state.draft = null;
    if (!thenSubmit) { toast("Saved as a draft on this device."); return enter("home"); }
    if (!linked) {
      st.queueDraft(saved.id);
      toast("Saved on this device. It can be submitted once your programme is linked.");
      return enter("home");
    }
    if (!st._online() || !flag("smd_pglog_server")) {
      st.queueDraft(saved.id);
      toast("Saved. It will be submitted when you are back online.");
      return enter("home");
    }
    state.loading = true; render();
    st.submitDraft(saved.id).then(function () {
      state.loading = false;
      toast("Submitted to " + (saved.supervisor || "your guide") + " for verification.");
      haptic("success");
      state.dash = null;
      enter("home");
    }, function (e) {
      state.loading = false;
      st.queueDraft(saved.id);
      toast(e.userMessage || "Could not submit — it is queued and will retry.");
      enter("home");
    });
  }
  function doSubmitExisting(id) {
    var st = ST();
    state.loading = true; render();
    st.submitDraft(id).then(function () {
      state.loading = false; state.dash = null; toast("Submitted."); haptic("success"); enter("home");
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not submit."); render(); });
  }
  function doWithdraw(id) {
    var reason = window.prompt("Withdraw this entry from your guide's queue to correct it. What is wrong with it?");
    if (reason === null) return;
    var st = ST();
    state.loading = true; render();
    st.withdraw(id, String(reason || "").trim()).then(function () {
      state.loading = false; state.dash = null;
      toast("Withdrawn. It is a draft again and has left your guide's queue.");
      enter("home");
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not withdraw."); render(); });
  }
  function doResubmit(id) {
    var st = ST();
    state.loading = true; render();
    st.resubmit(id).then(function () {
      state.loading = false; state.dash = null; toast("Resubmitted."); enter("home");
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not resubmit."); render(); });
  }
  function doAmend(id) {
    var reason = window.prompt(
      "A verified entry is never overwritten. Describe the correction — the original is kept in full, " +
      "your reason is recorded, and it goes back to your guide for re-verification.");
    if (!reason || !reason.trim()) return;
    var st = ST();
    state.loading = true; render();
    st.amend(id, {}, reason.trim()).then(function () {
      state.loading = false; state.dash = null;
      toast("Amendment recorded. The original is retained.");
      enter("home");
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not amend."); render(); });
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
      if (!state.suggestions.length) toast("No requirement clearly matches — choose from the full list.");
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
      state.certLoading = false;
      if (c && c.verifyCode) {
        return st.certificate(c.id).then(function (full) {
          state.cert = full.certificate || c;
          state.certVerifyUrl = full.verifyUrl || "";
        }, function () {});
      }
    }, function () { state.certLoading = false; state.cert = null; });
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
      haptic("success");
      render();
    }, function (e) {
      state.loading = false;
      toast(e.userMessage || "Could not sign.");
      render();
    });
  }
  function doCertRevoke(id) {
    var reason = G.prompt ? G.prompt("Why is this certificate being revoked? This is recorded and shown to anyone who checks it.") : "";
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
      today: todayISO(), orgName: res && res.orgId, departmentName: res && res.departmentId,
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
    if (!reason) { haptic("warning"); return toast("Say what needs correcting — a return without a reason is refused."); }
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
    if (sc.missing.length) { haptic("warning"); return toast("Score every criterion — a blank is not a zero."); }
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
    }).then(function () {
      state.loading = false; state.assessment = null;
      toast("Assessment saved.");
      back();
    }, function (e) { state.loading = false; toast(e.userMessage || "Could not save the assessment."); render(); });
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
    return st.notifications().then(function (r) { state.inbox = arr(r.notifications).filter(function (n) { return !n.read; }); },
      function () { state.inbox = []; });
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
        render();
      })
      .catch(function (e) {
        state.loading = false;
        // NOT ERRORS — these are ordinary states with their own screen, and showing "Could not load
        // this" for them would tell a resident their logbook is broken when it is merely not linked
        // yet, or offline, or running on-device by choice.
        var normal = { signin_required: 1, forbidden: 1, server_disabled: 1, offline: 1, store_missing: 1 };
        if (e && (normal[e.code] || e.status === 401 || e.status === 403)) {
          state.ctx = state.ctx || { role: "viewer", caps: [], resident: null };
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
