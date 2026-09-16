/* wardsynq/site/pages/admin.js - wardsynq.com Admin Center: hospital, departments, wards/beds, rooms,
 * staff and roles. Buildless ES5, registers onto the global WSQ (window.WSQ, set by shell.js) the same
 * way every page in this directory does. Every button here calls a real /api/queue route - see
 * functions/api/queue/[[path]].js and functions/_opd_org_store.js for what each one accepts.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  // Bed states, verbatim from functions/_opd_org.js BED_STATES - never invented here.
  var BED_STATES = ["available", "reserved", "occupied", "blocked", "cleaning", "maintenance"];
  function bedStateLabel(c, s) {
    return {
      available: T(c, "site.admin.wards.bed.available", "available"),
      reserved: T(c, "site.admin.wards.bed.reserved", "reserved"),
      occupied: T(c, "site.admin.wards.bed.occupied", "occupied"),
      blocked: T(c, "site.admin.wards.bed.blocked", "blocked"),
      cleaning: T(c, "site.admin.wards.bed.cleaning", "cleaning"),
      maintenance: T(c, "site.admin.wards.bed.maintenance", "maintenance"),
    }[s] || s;
  }

  /* Every role functions/_queue_roles.js ROLE_CAPS knows about (ROLES = Object.keys(ROLE_CAPS)).
   * This list is hand-kept, not generated - it went stale for radiographer/radiologist the day
   * those two roles were added to ROLE_CAPS: they existed on the server, had a home-screen tile
   * and a chart, and could not be GIVEN to anybody, because this dropdown - the only door into
   * assigning a role to a staff member - never learned they existed. Keep this in sync by hand;
   * there is no test that catches a role missing here, only a role an admin cannot find. */
  var ROLES = ["admin", "doctor", "supervisor", "nurse", "intern", "resident", "reception", "cashier",
    "pharmacy", "lab", "hr", "billing", "him", "blood_bank", "radiographer", "radiologist",
    "oncqis_protocol_author", "oncqis_clinical_reviewer", "oncqis_institutional_approver",
    "pg_resident", "pg_faculty", "pg_hod", "academic_cell", "safety_officer", "viewer"];

  // One line per common role, from the capability lists in functions/_queue_roles.js ROLE_CAPS.
  // Built at render time (not a module constant) because each note is a T() call in the staff language.
  function roleNoteRows(c) {
    return [
      ["admin", T(c, "site.admin.staff.roleNote.admin", "Full technical administration: staff, wards, beds, departments, rooms, billing config. Not clinical protocol sign-off.")],
      ["doctor", T(c, "site.admin.staff.roleNote.doctor", "Full clinical workflow: queue, EMR, orders, prescriptions, own patients.")],
      ["nurse", T(c, "site.admin.staff.roleNote.nurse", "Runs the queue at the desk, records vitals, gives medicines at the bedside (eMAR). No prescribing.")],
      ["reception", T(c, "site.admin.staff.roleNote.reception", "Registers and checks in patients, assigns to a doctor. Reads the chart, cannot edit it.")],
      ["pharmacy", T(c, "site.admin.staff.roleNote.pharmacy", "Reads and dispenses medication orders, verifies an order against the chart. No consultation notes.")],
      ["lab", T(c, "site.admin.staff.roleNote.lab", "Sees ordered tests and releases results. No other chart access.")],
      ["billing", T(c, "site.admin.staff.roleNote.billing", "Reads charges, invoices and claims. Cannot take payment (see Cashier for that).")],
      ["him", T(c, "site.admin.staff.roleNote.him", "Reads the chart to decide and record release-of-information requests.")],
      ["blood_bank", T(c, "site.admin.staff.roleNote.bloodBank", "Crossmatches, issues and administers transfusions only.")],
      ["radiographer", T(c, "site.admin.staff.roleNote.radiographer", "Acquires the imaging study. Reads the chart, cannot file a report or protocol a study.")],
      ["radiologist", T(c, "site.admin.staff.roleNote.radiologist", "Protocols and reports imaging studies (the same authority a lab result release uses). No other chart write.")],
    ];
  }

  // The only actions the staff table sends to /member/<action>; anything else sends nothing.
  var MEMBER_ACTION_ROUTE = { disable: "disable", restore: "restore", reset: "reset" };

  /* refusal() mixes two kinds of text: the three fallbacks below (client-authored, translated) and
   * r.message / r.error / r.reasons (server-authored, passed through verbatim - the caller must wrap
   * the result in EN(c, ...) since it may contain either). */
  function refusal(c, r) {
    if (!r) return T(c, "site.admin.err.noResponse", "No response from the server.");
    if (r.message) return r.message;
    if (r.reasons) return (r.error || T(c, "site.admin.err.refused", "refused")) + ": " + (Array.isArray(r.reasons) ? r.reasons.join(", ") : String(r.reasons));
    return r.error || T(c, "site.admin.err.failed", "failed");
  }

  // Tab labels are nav.admin.<id> keys in wardsynq/site/i18n.js (owner decision 2026-09-15: the tab
  // strip is shell navigation, the panels it opens are clinical/admin content and stay English).
  var TABS = [["hospital", "nav.admin.hospital"], ["departments", "nav.admin.departments"], ["wards", "nav.admin.wards"], ["rooms", "nav.admin.rooms"], ["staff", "nav.admin.staff"], ["tariff", "nav.admin.tariff"], ["advisories", "nav.admin.advisories"], ["forms", "nav.admin.forms"], ["pathways", "nav.admin.pathways"], ["group", "nav.admin.group"]];

  WSQ.page("admin", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("staff.admin")) {
      el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.admin.title", "Admin Center")) + '</h1></div>' +
        '<div class="msg note">' + c.esc(T(c, "site.admin.noAccess", "Your role does not include staff.admin, so the Admin Center is not available to you.")) + '</div>';
      return;
    }
    var tabs = TABS.slice();
    if (c.isWardsynq()) tabs.push(["seed", "nav.admin.seed"], ["maik", "nav.admin.maik"], ["security", "nav.admin.security"], ["health", "nav.admin.health"], ["export", "nav.admin.export"], ["fhir", "nav.admin.fhir"], ["integrations", "nav.admin.integrations"], ["bugs", "nav.admin.bugs"]);
    // #/admin/tariff opens that tab: the cashier's "no price set" message links straight to the Price list (LT-30).
    // Applied once per arrival, so the tab buttons still work while the address says /tariff.
    if (st.page === "admin" && st.arg && st._adminArg !== st.arg && tabs.some(function (t) { return t[0] === st.arg; })) st._adminTab = st.arg;
    st._adminArg = st.page === "admin" ? st.arg : "";
    var tab = st._adminTab || "hospital";
    if ((tab === "seed" || tab === "maik" || tab === "security" || tab === "health" || tab === "export" || tab === "fhir" || tab === "integrations" || tab === "bugs") && !c.isWardsynq()) tab = "hospital";
    var navTr = c.navTr || function (k) { return k; };
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.admin.title", "Admin Center")) + '</h1><span class="sub">' + c.esc((st.org && st.org.name) || "") + '</span></div>' +
      '<div class="tabs" role="tablist" lang="' + c.esc(c.navLang || "en") + '">' + tabs.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + c.esc(navTr(t[1])) + "</button>";
      }).join("") + '</div><div id="adminBody"><span class="spin"></span></div>';
    el.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { st._adminTab = b.getAttribute("data-tab"); WSQ.render("admin"); };
    });
    var body = document.getElementById("adminBody");
    var renderers = { seed: renderSeed, hospital: renderHospital, departments: renderDepts, wards: renderWards, rooms: renderRooms, staff: renderStaff, maik: renderMaik, security: renderSecurity, health: renderHealth, export: renderExport, fhir: renderFhir, integrations: renderIntegrations, tariff: renderTariff, advisories: renderAdvisories, forms: renderForms, pathways: renderPathways, group: renderGroup, bugs: renderBugs };
    return renderers[tab](c, body);
  } });

  // ---- Bug reports (the Report Bug button, functions/_wardsynq/bug-reports.js) ---------------------
  /* Every report staff sent with the red Report Bug button, for the hospital admin to work through. The server
   * decides everything here: only the hospital's admin (or its owner, or the StewardMD platform owner) may change a
   * status or remove, a solved status needs a note saying how, and Remove is refused unless the report is solved.
   * The buttons below only mirror that, so a report never offers an act the server would refuse.
   * s.list: null = loading, false = could not be loaded (s.failMsg), else the server's reports. */
  var BUG_FILTERS = ["active", "open", "in_progress", "solved", "removed", "all"];
  function bugStatusLabel(c, st) {
    return {
      open: T(c, "site.admin.bugs.status.open", "Open"),
      in_progress: T(c, "site.admin.bugs.status.inProgress", "In progress"),
      solved: T(c, "site.admin.bugs.status.solved", "Solved"),
      removed: T(c, "site.admin.bugs.status.removed", "Removed (solved)"),
    }[st] || st;
  }
  function bugFilterLabel(c, f) {
    return f === "active" ? T(c, "site.admin.bugs.filter.active", "Not removed") : f === "all" ? T(c, "site.admin.bugs.filter.all", "All, including removed") : bugStatusLabel(c, f);
  }
  function bugPill(c, st) {
    var cls = st === "open" ? " stop" : st === "in_progress" ? " warn" : " ok";
    return '<span class="pill' + cls + '">' + c.esc(bugStatusLabel(c, st)) + "</span>";
  }
  function bugWhen(v) { return String(v || "").slice(0, 16).replace("T", " "); }
  function bugsHtml(c, s) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("bug_report") + " " + esc(T(c, "site.admin.bugs.title", "Bug reports")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.bugs.intro", "Reports sent by staff with the Report Bug button. Mark each one in progress, then solved with a note saying how it was solved. A report can be removed only after it is solved; removing archives it and keeps its history.")) + "</p>" +
      '<label class="f" style="max-width:260px"><span>' + esc(T(c, "site.admin.bugs.filter", "Show")) + '</span><select id="bugFilter">' +
      BUG_FILTERS.map(function (f) { return '<option value="' + f + '"' + (f === s.filter ? " selected" : "") + ">" + esc(bugFilterLabel(c, f)) + "</option>"; }).join("") + "</select></label>";
    if (s.list === null) return h + '<p><span class="spin"></span> ' + esc(T(c, "site.admin.bugs.loading", "Loading bug reports...")) + "</p></div>";
    if (s.list === false) return h + '<div class="msg err">' + esc(T(c, "site.admin.bugs.loadFailed", "Bug reports could not be loaded:")) + " " + EN(c, esc(s.failMsg || "")) + "</div></div>";
    if (!s.list.length) return h + '<p class="quiet">' + esc(T(c, "site.admin.bugs.none", "No bug reports match this filter.")) + "</p></div>";
    h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.bugs.colReported", "Reported")) + "</th><th>" + esc(T(c, "site.admin.bugs.colStatus", "Status")) + "</th><th>" +
      esc(T(c, "site.admin.bugs.colSeverity", "Severity")) + "</th><th>" + esc(T(c, "site.admin.bugs.colWhat", "What went wrong")) + "</th><th>" + esc(T(c, "site.admin.bugs.colBy", "Reported by")) + "</th><th></th></tr></thead><tbody>" +
      s.list.map(function (r) {
        return "<tr><td>" + esc(bugWhen(r.reportedAt)) + "</td><td>" + bugPill(c, r.status) + '</td><td class="mono">' + esc(r.severity) + "</td><td>" + esc(String(r.description || "").slice(0, 120)) +
          '<div class="quiet">' + esc(r.location || "") + "</div></td><td>" + esc((r.reporter && (r.reporter.name || r.reporter.id)) || "") + "</td>" +
          '<td><button type="button" class="btn ghost" data-bug-open="' + esc(r.id) + '">' + esc(T(c, "site.admin.bugs.open", "Open")) + "</button></td></tr>";
      }).join("") + "</tbody></table></div></div>";
    var r = s.openId && s.list.filter(function (x) { return x.id === s.openId; })[0];
    if (!s.manager) h = h.replace(/<\/div>$/, '<p class="quiet">' + esc(T(c, "site.admin.bugs.ownOnly", "These are your own reports. Only the hospital admin sees every report and can change one.")) + "</p></div>");
    return r ? h + bugDetailHtml(c, r, s.manager) : h;
  }
  function bugDetailHtml(c, r, manager) {
    var esc = c.esc, cx = r.context || {}, tg = r.target || null;
    var line = function (label, v) { return v ? "<div><b>" + esc(label) + "</b> " + esc(v) + "</div>" : ""; };
    var h = '<div class="card" id="bugDetail"><h2>' + esc(T(c, "site.admin.bugs.detail", "Report")) + " " + bugPill(c, r.status) + "</h2>" +
      '<p style="white-space:pre-wrap">' + esc(r.description) + "</p>" +
      line(T(c, "site.admin.bugs.severity", "Severity:"), r.severity) +
      line(T(c, "site.admin.bugs.where", "Where:"), r.location) +
      line(T(c, "site.admin.bugs.page", "Page:"), cx.url) +
      line(T(c, "site.admin.bugs.patient", "Patient on screen:"), cx.patient ? (cx.patient.id || "") + (cx.patient.bed ? " / " + cx.patient.bed : "") : "") +
      line(T(c, "site.admin.bugs.target", "Element pointed at:"), tg ? tg.selector + (tg.snippet ? ' "' + tg.snippet + '"' : "") : "") +
      line(T(c, "site.admin.bugs.by", "Reported by:"), r.reporter ? (r.reporter.name || r.reporter.id) + (r.reporter.role ? " (" + r.reporter.role + ")" : "") : "") +
      line(T(c, "site.admin.bugs.at", "Reported at:"), bugWhen(r.reportedAt)) +
      line(T(c, "site.admin.bugs.device", "Device:"), (r.userAgent || "") + (r.screen && r.screen.width ? " " + r.screen.width + "x" + r.screen.height : "")) +
      (r.solution ? line(T(c, "site.admin.bugs.solvedHow", "How it was solved:"), r.solution.note + " (" + bugWhen(r.solution.at) + ")") : "") +
      ((r.errors || []).length ? "<details><summary>" + esc(T(c, "site.admin.bugs.errors", "Console errors captured ({n})", { n: r.errors.length })) + '</summary><pre style="white-space:pre-wrap;max-width:80ch">' +
        esc(r.errors.map(function (e) { return (e.time || "") + " " + (e.text || ""); }).join("\n")) + "</pre></details>" : "") +
      "<h3>" + esc(T(c, "site.admin.bugs.history", "History")) + '</h3><ul class="quiet">' + (r.events || []).map(function (e) {
        return "<li>" + esc(bugWhen(e.at)) + " " + esc(bugStatusLabel(c, e.status)) + " " + esc(e.byName || e.by || "") + (e.note ? ": " + esc(e.note) : "") + "</li>";
      }).join("") + "</ul>";
    if (manager && (r.status === "open" || r.status === "in_progress")) {
      h += (r.status === "open" ? '<button type="button" class="btn ghost" data-bug-act="in_progress">' + esc(T(c, "site.admin.bugs.setInProgress", "Set in progress")) + "</button> " : "") +
        '<label class="f"><span>' + esc(T(c, "site.admin.bugs.noteLabel", "How it was solved")) + '</span><textarea id="bugNote" rows="2"></textarea></label>' +
        '<button type="button" class="btn" data-bug-act="solved">' + esc(T(c, "site.admin.bugs.markSolved", "Mark solved")) + "</button>";
    }
    if (manager && r.status === "solved") {
      h += '<button type="button" class="btn ghost" data-bug-act="open">' + esc(T(c, "site.admin.bugs.reopen", "Reopen")) + "</button> " +
        '<button type="button" class="btn ghost" data-bug-act="remove">' + esc(T(c, "site.admin.bugs.remove", "Remove")) + "</button>";
    }
    return h + '<div id="bugMsg"></div></div>';
  }
  WSQ._bugsHtml = bugsHtml;
  /** The one request each button sends. kind: in_progress | solved | open | remove. */
  function bugAction(c, kind, r, note) {
    if (kind === "remove") return c.api("/ward/bug-report-remove", { orgId: c.state.orgId, id: r.id, expectedVersion: r.version });
    return c.api("/ward/bug-report-status", { orgId: c.state.orgId, id: r.id, status: kind, note: note || "", expectedVersion: r.version });
  }
  WSQ._bugAction = bugAction;
  function renderBugs(c, body) {
    var s = c.state._bugs = c.state._bugs || { filter: "active", openId: "" };
    s.list = null;
    var paint = function () {
      body.innerHTML = bugsHtml(c, s);
      var f = document.getElementById("bugFilter");
      if (f) f.onchange = function () { s.filter = f.value; s.openId = ""; renderBugs(c, body); };
      body.querySelectorAll("[data-bug-open]").forEach(function (b) {
        b.onclick = function () { s.openId = b.getAttribute("data-bug-open"); paint(); };
      });
      var r = s.openId && s.list && s.list.filter(function (x) { return x.id === s.openId; })[0];
      body.querySelectorAll("[data-bug-act]").forEach(function (b) {
        b.onclick = function () {
          var kind = b.getAttribute("data-bug-act"), noteEl = document.getElementById("bugNote"), note = noteEl ? noteEl.value.trim() : "";
          var msg = document.getElementById("bugMsg");
          if (kind === "solved" && note.length < 3) { msg.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.bugs.noteRequired", "Say how it was solved before marking it solved.")) + "</div>"; return; }
          if (kind === "remove" && !window.confirm(T(c, "site.admin.bugs.removeConfirm", "Remove this solved report? It is archived with its history, not deleted."))) return;
          b.disabled = true;
          bugAction(c, kind, r, note).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; msg.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.bugs.notChanged", "Not changed:")) + " " + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
            c.toast(kind === "remove" ? T(c, "site.admin.bugs.removed", "Report removed.") : T(c, "site.admin.bugs.saved", "Report set to {status}.", { status: bugStatusLabel(c, x.report.status) }));
            if (kind === "remove") s.openId = "";
            renderBugs(c, body);
          });
        };
      });
    };
    paint();
    return c.api("/ward/bug-reports?orgId=" + encodeURIComponent(c.state.orgId) + "&status=" + encodeURIComponent(s.filter)).then(function (x) {
      if (x && x.ok) { s.list = x.reports || []; s.manager = !!x.manager; } else { s.list = false; s.failMsg = refusal(c, x); }
      paint();
    });
  }

  // ---- Clinical seed data (D10) ------------------------------------------------------------------
  /* Clinical content that ships with WardSynQ (allergy classes, dose ceilings, default critical limits and
   * the other seed lists), item by item. An item is UNAPPROVED until signed off by the named signatory for its
   * CURRENT content; a signed item whose content later changed is unapproved again (the server decides by
   * fingerprint). Every hospital admin sees the state; only the StewardMD platform owner is offered sign-off,
   * and the server refuses anyone else. r: undefined = loading, { failed } = could not be loaded. */
  function seedHtml(c, r) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.seed.title", "Clinical seed data")) + "</h2>";
    if (r === undefined) return h + '<p><span class="spin"></span> ' + esc(T(c, "site.admin.seed.loading", "Loading...")) + "</p></div>";
    if (r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.seed.loadFailedLead", "The sign-off state could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.seed.treatUnapproved", "Treat every item as UNAPPROVED.")) + "</div></div>";
    var total = 0, unapproved = 0;
    r.lists.forEach(function (l) { total += l.items.length; unapproved += l.unapproved; });
    return h + '<p class="quiet">' + esc(T(c, "site.admin.seed.intro", "Clinical content shipped with WardSynQ. Each item is UNAPPROVED until {signatory} signs off its exact current content. Signing records the sign-off; it does not change how any safety check behaves.", { signatory: r.signatory })) + "</p>" +
      '<p><span class="pill ' + (unapproved ? "warn" : "ok") + '">' + esc(T(c, "site.admin.seed.unapprovedCount", "{unapproved} of {total} items unapproved", { unapproved: unapproved, total: total })) + "</span></p>" +
      r.lists.map(function (l) {
        return "<h3>" + esc(l.title) + ' <span class="quiet">(' + esc(l.source) + ")</span></h3>" +
          '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.seed.colItem", "Item")) + "</th><th>" + esc(T(c, "site.admin.seed.colVersion", "Version")) + "</th><th>" + esc(T(c, "site.admin.seed.colSignoff", "Sign-off")) + "</th>" + (r.canSign ? "<th></th>" : "") + "</tr></thead><tbody>" +
          l.items.map(function (it) {
            var signed = it.status === "signed";
            return '<tr data-seed="' + esc(l.id) + "/" + esc(it.id) + '"><td>' + esc(it.label) + '<details><summary class="quiet">' + esc(T(c, "site.admin.seed.content", "content")) + '</summary><pre style="white-space:pre-wrap;max-width:60ch">' + esc(it.content) + "</pre></details></td>" +
              '<td class="mono">' + esc(it.version) + "</td>" +
              "<td>" + (signed ? '<span class="pill ok">' + esc(it.signoff.text) + "</span>" : '<span class="pill stop">' + esc(T(c, "site.admin.seed.unapproved", "UNAPPROVED")) + "</span>") + "</td>" +
              (r.canSign ? "<td>" + (signed ? "" : '<button type="button" class="btn ghost" data-seed-sign="' + esc(l.id) + '" data-seed-item="' + esc(it.id) + '" data-seed-hash="' + esc(it.contentHash) + '">' + esc(T(c, "site.admin.seed.signOff", "Sign off")) + "</button>") + "</td>" : "") + "</tr>";
          }).join("") + "</tbody></table></div>";
      }).join("") + '<div id="seedMsg"></div></div>';
  }
  WSQ._seedHtml = seedHtml;
  function renderSeed(c, body) {
    body.innerHTML = seedHtml(c, undefined);
    return c.api("/seed/status?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      body.innerHTML = seedHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) });
      body.querySelectorAll("[data-seed-sign]").forEach(function (b) {
        b.onclick = function () {
          var name = window.prompt(T(c, "site.admin.seed.signPrompt", "Sign off this item's content as shown.\n\nType the signatory's name exactly ({signatory}):", { signatory: r.signatory }), "");
          if (name == null) return;
          if (!window.confirm(T(c, "site.admin.seed.signConfirm", "I have reviewed the content of {item} and sign it off as {name}.", { item: b.getAttribute("data-seed-item"), name: name }))) return;
          b.disabled = true;
          c.api("/seed/signoff", { listId: b.getAttribute("data-seed-sign"), itemId: b.getAttribute("data-seed-item"), contentHash: b.getAttribute("data-seed-hash"), signatory: name, attest: true }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; document.getElementById("seedMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.seed.notSigned", "Not signed:")) + " " + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
            c.toast(x.signoff.text); WSQ.render("admin");
          });
        };
      });
    });
  }

  // ---- Hospital -------------------------------------------------------------------------------
  /* WHO MAY WRITE A CLINICAL NOTE. Writing a note needs emr.treat, the prescribing capability, so
   * out of the box only prescribers document. On plenty of real wards the nursing note is a core
   * part of the record - and the alternative, handing nurses emr.treat, would hand them prescribing
   * too. So the hospital names the roles it trusts to document, here, and those roles may write a
   * note and nothing else.
   *
   * Only roles that can already open a chart are offered: a role that cannot read the record has no
   * business writing into it, and listing it here would promise something the server would refuse.
   * Prescribers are shown as always-on and cannot be unticked, because emr.treat carries this
   * anyway and a tickbox that does not change anything is a lie about what it controls. */
  var NOTE_ROLE_CHOICES = ["nurse", "supervisor", "resident", "intern", "reception", "him", "radiographer", "radiologist"];
  var ALWAYS_WRITE = ["admin", "doctor", "pg_faculty", "pg_hod", "pg_resident"];
  function noteWritersCard(c, o) {
    var cfg = (o && o.wardsynq) || {};
    var on = Array.isArray(cfg.noteWriterRoles) ? cfg.noteWriterRoles : [];
    var row = function (r) {
      return '<label class="f" style="flex:0 1 190px"><span>' +
        '<input type="checkbox" class="admNoteRole" value="' + c.esc(r) + '"' + (on.indexOf(r) >= 0 ? " checked" : "") + "> " +
        c.esc(r.replace(/_/g, " ")) + "</span></label>";
    };
    return '<div class="card"><h2>' + c.ms("edit_note") + " " + c.esc(T(c, "site.admin.hospital.noteWriters.title", "Who may write a clinical note")) + "</h2>" +
      '<p class="quiet">' + c.esc(T(c, "site.admin.hospital.noteWriters.intro", "Doctors and admins can always write a note. Tick any other role your hospital trusts to document on the patient timeline. This lets them write a note and nothing else: it does not let them prescribe, order or change anything.")) + "</p>" +
      '<div class="row">' + NOTE_ROLE_CHOICES.map(row).join("") + "</div>" +
      '<p class="quiet">' + c.esc(T(c, "site.admin.hospital.noteWriters.alwaysAllowed", "Always allowed: {roles}.", { roles: ALWAYS_WRITE.join(", ").replace(/_/g, " ") })) + "</p>" +
      '<button class="btn" id="admNoteSave" type="button">' + c.esc(T(c, "site.admin.save", "Save")) + '</button><div id="admNoteMsg"></div></div>';
  }
  function wireNoteWriters(c) {
    var btn = document.getElementById("admNoteSave");
    if (!btn) return;
    btn.onclick = function () {
      var picked = [];
      document.querySelectorAll(".admNoteRole").forEach(function (b) { if (b.checked) picked.push(b.value); });
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, wardsynq: { noteWriterRoles: picked } }).then(function (r) {
        btn.disabled = false;
        var m = document.getElementById("admNoteMsg");
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        c.state.org = r.org;
        c.toast(!picked.length ? T(c, "site.admin.hospital.noteWriters.savedNone", "Saved. Only prescribers may write a note.")
          : picked.length === 1 ? T(c, "site.admin.hospital.noteWriters.savedOne", "Saved. {n} extra role may write a note.", { n: picked.length })
          : T(c, "site.admin.hospital.noteWriters.savedMany", "Saved. {n} extra roles may write a note.", { n: picked.length }));
      });
    };
  }
  /* PRINTOUTS IN THE PATIENT'S LANGUAGE (owner decision 2026-09-15: English main, other languages optional).
   * Off by default. On, the Patient copy and the discharge summary offer a second language per print, beside an
   * English print that is always whole; only headings, labels and the closed-list patient instructions are
   * translated (wardsynq/site/print-lang.js). */
  function printLangCard(c, o) {
    var on = !!(o && o.wardsynq && o.wardsynq.printLanguages && o.wardsynq.printLanguages.enabled === true);
    return '<div class="card"><h2>' + c.ms("translate") + " " + c.esc(T(c, "site.admin.hospital.printLang.title", "Printouts in the patient's language")) + "</h2>" +
      '<label class="f"><span><input type="checkbox" id="admPrintLang"' + (on ? " checked" : "") + "> " + c.esc(T(c, "site.admin.hospital.printLang.toggle", "Offer a second language on the patient's prescription and discharge summary prints")) + "</span></label>" +
      '<p class="quiet">' + c.esc(T(c, "site.admin.hospital.printLang.intro", "The English print is always complete and is the authoritative one. The second language is printed beside it, marked as a translation, and covers only headings, labels and the patient instructions a prescriber picked from the fixed list. Medicine names, doses, frequencies, diagnoses, results and anything typed are printed in English only. Translations not yet written show in English.")) + "</p>" +
      '<button class="btn" id="admPrintLangSave" type="button">' + c.esc(T(c, "site.admin.save", "Save")) + '</button><div id="admPrintLangMsg"></div></div>';
  }
  function wirePrintLang(c) {
    var btn = document.getElementById("admPrintLangSave");
    if (!btn) return;
    btn.onclick = function () {
      var enabled = !!document.getElementById("admPrintLang").checked;
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, wardsynq: { printLanguages: { enabled: enabled } } }).then(function (r) {
        btn.disabled = false;
        var m = document.getElementById("admPrintLangMsg");
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        c.state.org = r.org;
        c.toast(enabled ? T(c, "site.admin.hospital.printLang.savedOn", "Saved. Prints offer a second language.") : T(c, "site.admin.hospital.printLang.savedOff", "Saved. Prints are in English only."));
      });
    };
  }
  /* APPROVAL RULES (P1.3). How many people must approve each kind of request, which roles may, how
   * long a request stays open, and extra approvers above an amount. The amount is always the one the
   * server works out from the thing itself (a purchase order's priced lines); a request with no known
   * amount gets the strictest level. Deciding an approval needs emr.treat, so only roles holding it
   * are offered. ponytail: one amount step per kind on screen; the server accepts a list. */
  var APPROVAL_KIND_IDS = ["PurchaseOrder", "StockRequisition", "RestrictedMedication", "Invoice", "Discharge", "Incident"];
  function approvalKindLabel(c, id) {
    return {
      PurchaseOrder: T(c, "site.admin.hospital.approval.kind.purchaseOrder", "Purchase orders"),
      StockRequisition: T(c, "site.admin.hospital.approval.kind.stockRequisition", "Stock requests"),
      RestrictedMedication: T(c, "site.admin.hospital.approval.kind.restrictedMedication", "Restricted medicines"),
      Invoice: T(c, "site.admin.hospital.approval.kind.invoice", "Invoices"),
      Discharge: T(c, "site.admin.hospital.approval.kind.discharge", "Discharges"),
      Incident: T(c, "site.admin.hospital.approval.kind.incident", "Incident reports"),
    }[id] || id;
  }
  var APPROVER_ROLES = ["admin", "doctor", "pg_faculty", "pg_hod"];
  function approvalRulesHtml(c, cfg) {
    var esc = c.esc;
    cfg = cfg || {};
    var levels = cfg.approvalLevels || {}, policy = cfg.approvalPolicy || {};
    var rows = APPROVAL_KIND_IDS.map(function (id) {
      var p = policy[id] || {}, t = (p.amountThresholds || [])[0] || {};
      var roles = Array.isArray(p.approverRoles) ? p.approverRoles : [];
      return "<tr data-kind=\"" + esc(id) + "\"><td>" + esc(approvalKindLabel(c, id)) + "</td>" +
        '<td><input class="apLevels" type="number" min="1" max="5" value="' + esc(levels[id] || 1) + '" style="width:4em"></td>' +
        "<td>" + APPROVER_ROLES.map(function (r) { return '<label style="white-space:nowrap"><input type="checkbox" class="apRole" value="' + r + '"' + (roles.indexOf(r) >= 0 ? " checked" : "") + "> " + esc(r.replace(/_/g, " ")) + "</label> "; }).join("") + "</td>" +
        '<td><input class="apExpires" type="number" min="1" placeholder="' + esc(T(c, "site.admin.hospital.approval.never", "never")) + '" value="' + esc(p.expiresHours || "") + '" style="width:5em"></td>' +
        '<td>' + esc(T(c, "site.admin.hospital.approval.aboveRs", "above Rs")) + ' <input class="apAbove" inputmode="decimal" placeholder="' + esc(T(c, "site.admin.hospital.approval.noneP", "none")) + '" value="' + esc(t.abovePaise != null ? t.abovePaise / 100 : "") + '" style="width:7em"> ' + esc(T(c, "site.admin.hospital.approval.needs", "needs")) + ' <input class="apAboveLevels" type="number" min="1" max="5" value="' + esc(t.levels || "") + '" style="width:4em"></td></tr>';
    }).join("");
    return '<div class="card"><h2>' + esc(T(c, "site.admin.hospital.approval.title", "Approval rules")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.approval.intro", "Nobody can approve their own request. No roles ticked means any role that may approve can. Amounts are taken from the request itself on the server; a request whose amount is not known needs the highest number you set.")) + "</p>" +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.hospital.approval.colKind", "Kind")) + "</th><th>" + esc(T(c, "site.admin.hospital.approval.colApprovals", "Approvals")) + "</th><th>" + esc(T(c, "site.admin.hospital.approval.colRoles", "Only these roles")) + "</th><th>" + esc(T(c, "site.admin.hospital.approval.colExpires", "Expires after (hours)")) + "</th><th>" + esc(T(c, "site.admin.hospital.approval.colAmount", "Extra approvers by amount")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      '<button class="btn" id="apSave" type="button">' + esc(T(c, "site.admin.hospital.approval.save", "Save approval rules")) + '</button><div id="apMsg"></div></div>';
  }
  /* Reads the table back. Returns { approvalLevels, approvalPolicy } or { error }. */
  function readApprovalRules(c, rowEls) {
    var levels = {}, policy = {};
    for (var i = 0; i < rowEls.length; i++) {
      var tr = rowEls[i], kind = tr.getAttribute("data-kind");
      var q = function (sel) { return tr.querySelector(sel); };
      var n = parseInt(q(".apLevels").value, 10);
      if (!(n >= 1 && n <= 5)) return { error: T(c, "site.admin.hospital.approval.errLevels", "Approvals must be between 1 and 5.") };
      levels[kind] = n;
      var p = {};
      var roles = []; tr.querySelectorAll(".apRole").forEach(function (b) { if (b.checked) roles.push(b.value); });
      if (roles.length) p.approverRoles = roles;
      var exp = String(q(".apExpires").value || "").trim();
      if (exp) { var h = Number(exp); if (!(h > 0)) return { error: T(c, "site.admin.hospital.approval.errExpiry", "Expiry must be a number of hours above zero.") }; p.expiresHours = h; }
      var above = String(q(".apAbove").value || "").trim(), aboveN = String(q(".apAboveLevels").value || "").trim();
      if (above || aboveN) {
        if (!/^\d+(\.\d{1,2})?$/.test(above) || !(parseInt(aboveN, 10) >= 1)) return { error: T(c, "site.admin.hospital.approval.errAmountStep", "An amount step needs both a rupee amount and a number of approvals.") };
        p.amountThresholds = [{ abovePaise: Math.round(Number(above) * 100), levels: parseInt(aboveN, 10) }];
      }
      policy[kind] = p;
    }
    return { approvalLevels: levels, approvalPolicy: policy };
  }
  WSQ._approvalRules = { html: approvalRulesHtml, read: readApprovalRules };
  /* LABORATORY RESULT CHECKING (P1.9). Off: a result is released as entered. On: a final result that did
   * not pass the hospital's autoverification goes on the chart as preliminary until a different member
   * of the laboratory verifies it. Critical values alert either way. */
  function labCheckHtml(c, cfg) {
    var esc = c.esc;
    var on = !!(cfg && cfg.labVerification && cfg.labVerification.mode === "second-person");
    return '<div class="card"><h2>' + esc(T(c, "site.admin.hospital.labCheck.title", "Laboratory result checking")) + "</h2>" +
      '<label class="f"><span><input type="checkbox" id="labSecond"' + (on ? " checked" : "") + "> " + esc(T(c, "site.admin.hospital.labCheck.toggle", "Require a second member of the laboratory to verify results that did not pass autoverification")) + "</span></label>" +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.labCheck.intro", "While waiting, the result is on the chart marked preliminary. A critical value still raises its alert straight away.")) + "</p>" +
      '<button class="btn" id="labSecondSave" type="button">' + esc(T(c, "site.admin.save", "Save")) + "</button></div>";
  }
  WSQ._labCheck = { html: labCheckHtml };
  function wireLabCheck(c) {
    var btn = document.getElementById("labSecondSave");
    if (!btn) return;
    btn.onclick = function () {
      var on = document.getElementById("labSecond").checked;
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, wardsynq: { labVerification: on ? { mode: "second-person" } : null } }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { c.toast(refusal(c, r)); return; }
        c.state.org = r.org; c.toast(on ? T(c, "site.admin.hospital.labCheck.savedOn", "Saved. Unverified results now need a second person.") : T(c, "site.admin.hospital.labCheck.savedOff", "Saved. Results are released as entered."));
      });
    };
  }
  function wireApprovalRules(c) {
    var btn = document.getElementById("apSave");
    if (!btn) return;
    btn.onclick = function () {
      var m = document.getElementById("apMsg");
      var out = readApprovalRules(c, document.querySelectorAll("tr[data-kind]"));
      if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, wardsynq: out }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        c.state.org = r.org; c.toast(T(c, "site.admin.hospital.approval.saved", "Approval rules saved."));
      });
    };
  }
  /* OPD TOKEN NUMBERS. The number the waiting hall calls out. One sequence for the whole hospital by
   * default; per department when chosen, each department with an optional letter prefix ("A-012") so
   * two departments' number 12 are told apart. Applies to tickets registered after saving; a token
   * already given is never changed. */
  /* D7: one row per ACTIVE department, keyed by its id, so renaming a department keeps its prefix and its
   * running sequence. A prefix saved before this was keyed by the department's name: it is shown in the
   * row whose name matches, and a saved name that matches no department is listed so it is not silently
   * lost on the next save. "Also known as" maps the names the EMR or a doctor's session use for this
   * department ("Gen Med", "General Medicine OPD") to it; each is used to number imported patients.
   * departments: undefined = loading, null = could not be loaded, [] = none set up. */
  function lc(x) { return String(x == null ? "" : x).trim().toLowerCase(); }
  function tokenCardHtml(c, tokens, departments) {
    var esc = c.esc;
    var t = tokens || {}, dept = t.scope === "department", pre = t.prefixes || {}, al = t.deptAliases || {};
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.hospital.token.title", "OPD token numbers")) + "</h2>" +
      '<label class="f"><span>' + esc(T(c, "site.admin.hospital.token.numbering", "Numbering")) + '</span><select id="tokScope">' +
        '<option value="hospital"' + (dept ? "" : " selected") + ">" + esc(T(c, "site.admin.hospital.token.wholeHospital", "One sequence for the whole hospital")) + "</option>" +
        '<option value="department"' + (dept ? " selected" : "") + ">" + esc(T(c, "site.admin.hospital.token.perDepartment", "Each department numbers separately")) + "</option></select></label>";
    if (departments === undefined) return h + '<p><span class="spin"></span> ' + esc(T(c, "site.admin.hospital.token.loadingDepts", "Loading departments...")) + "</p></div>";
    if (departments === null) return h + '<div class="msg err">' + esc(T(c, "site.admin.hospital.token.deptsFailed", "The departments could not be loaded, so prefixes cannot be shown or saved. Do not read this as no departments.")) + "</div></div>";
    var act = departments.filter(function (d) { return d && d.id && d.active !== false; });
    var used = {};
    var rows = act.map(function (d) {
      var p = pre[lc(d.id)] || pre[lc(d.name)] || "";
      if (pre[lc(d.id)]) used[lc(d.id)] = 1; else if (pre[lc(d.name)]) used[lc(d.name)] = 1;
      var aka = Object.keys(al).filter(function (k) { return al[k] === d.id; });
      return '<tr data-tok-dept="' + esc(d.id) + '" data-tok-name="' + esc(d.name) + '"><td>' + esc(d.name) + (d.code ? ' <span class="quiet">(' + esc(d.code) + ")</span>" : "") + "</td>" +
        '<td><input class="tokPrefix" maxlength="3" style="width:5em" value="' + esc(p) + '" placeholder="' + esc(/^[A-Za-z0-9]{1,3}$/.test(d.code || "") ? String(d.code).toUpperCase() : "") + '"></td>' +
        '<td><input class="tokAka" style="width:100%" value="' + esc(aka.join(", ")) + '" placeholder="' + esc(T(c, "site.admin.hospital.token.akaPlaceholder", "Names the EMR uses, comma separated")) + '"></td></tr>';
    }).join("");
    var stale = Object.keys(pre).filter(function (k) { return !used[k]; });
    return h + (act.length
        ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.hospital.token.colDept", "Department")) + "</th><th>" + esc(T(c, "site.admin.hospital.token.colPrefix", "Prefix")) + "</th><th>" + esc(T(c, "site.admin.hospital.token.colAka", "Also known as")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>"
        : '<p class="quiet">' + esc(T(c, "site.admin.hospital.token.noDepts", "No active departments. Add them under Departments before numbering per department.")) + "</p>") +
      (stale.length ? '<div class="msg note">' + esc(T(c, "site.admin.hospital.token.staleLead", "Saved prefixes that name no department:")) + " " + EN(c, esc(stale.map(function (k) { return k + " = " + pre[k]; }).join(", "))) + ". " + esc(T(c, "site.admin.hospital.token.staleTrail", "Saving this card drops them.")) + "</div>" : "") +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.token.intro", "Prefixes are used only when each department numbers separately, and then every department needs its own: the desk cannot give a token in a department without one. A blank prefix uses the department code shown grey when that code is one to three letters or digits. Numbers start again at 1 each day, and a token already given never changes, including when the patient is moved to a room in another department.")) + "</p>" +
      '<button class="btn" id="tokSave" type="button">' + esc(T(c, "site.admin.save", "Save")) + '</button><div id="tokMsg"></div></div>';
  }
  /* rows: [{ departmentId, prefix, aka }] read from the table. Returns { tokens } or { error }. */
  function readTokenCard(c, scope, rows) {
    var prefixes = {}, deptAliases = {}, taken = {}, perDept = scope === "department";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], p = String(r.prefix || "").trim().toUpperCase();
      if (p && !/^[A-Z0-9]{1,3}$/.test(p)) return { error: T(c, "site.admin.hospital.token.errPrefix", "A prefix is one to three letters or digits: {p}", { p: p }) };
      if (p) prefixes[r.departmentId] = p;
      /* D14: numbering per department needs every department's own prefix (typed, or its code shown grey),
       * and no two alike, or two departments call the same number. The server refuses the same. */
      var eff = p || String(r.code || "").trim().toUpperCase();
      if (perDept && !/^[A-Z0-9]{1,3}$/.test(eff)) return { error: T(c, "site.admin.hospital.token.errNeedsPrefix", "{name} needs a prefix before each department can number separately.", { name: r.name || T(c, "site.admin.hospital.token.aDepartment", "A department") }) };
      if (perDept && taken[eff]) return { error: T(c, "site.admin.hospital.token.errDupPrefix", "{a} and {b} both use the prefix {eff}. Give each department its own.", { a: taken[eff], b: r.name || T(c, "site.admin.hospital.token.anotherDepartment", "another department"), eff: eff }) };
      if (perDept) taken[eff] = r.name || r.departmentId;
      var names = String(r.aka || "").split(",");
      for (var j = 0; j < names.length; j++) {
        var n = lc(names[j]); if (!n) continue;
        if (deptAliases[n] && deptAliases[n] !== r.departmentId) return { error: T(c, "site.admin.hospital.token.errAkaTwice", "\"{name}\" is given to two departments. A name can point to one department only.", { name: names[j].trim() }) };
        deptAliases[n] = r.departmentId;
      }
    }
    return { tokens: { scope: scope === "department" ? "department" : "hospital", prefixes: prefixes, deptAliases: deptAliases } };
  }
  WSQ._tokenCard = { html: tokenCardHtml, read: readTokenCard };
  function wireTokenCard(c) {
    var box = document.getElementById("tokCard");
    if (!box) return;
    var draw = function (depts) {
      box.innerHTML = tokenCardHtml(c, (c.state.org || {}).tokens, depts);
      var btn = document.getElementById("tokSave");
      if (!btn) return;
      btn.onclick = function () {
        var m = document.getElementById("tokMsg");
        var rows = Array.prototype.map.call(box.querySelectorAll("tr[data-tok-dept]"), function (tr) {
          var pin = tr.querySelector(".tokPrefix");
          return { departmentId: tr.getAttribute("data-tok-dept"), name: tr.getAttribute("data-tok-name"), prefix: pin.value, code: pin.getAttribute("placeholder"), aka: tr.querySelector(".tokAka").value };
        });
        var out = readTokenCard(c, document.getElementById("tokScope").value, rows);
        if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
        btn.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, tokens: out.tokens }).then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.state.org = r.org; draw(depts); c.toast(T(c, "site.admin.hospital.token.saved", "Token numbering saved."));
        });
      };
    };
    draw(undefined);
    c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) { draw(r && r.ok ? (r.departments || []) : null); }, function () { draw(null); });
  }
  /* D11 A: CLINICAL SETTINGS. The six settings each ward screen reads, in one place: apply a template to fill
   * the form, edit, save. The server validates and answers with what it now holds, and that read-back is what
   * this card shows after a save, never the form's own values. r: undefined = loading, null = could not be
   * loaded (said, never drawn as empty settings), else { settings, templates }. */
  var ACUITY = ["1", "2", "3", "4", "5"];
  function clinicalSettingsHtml(c, r, saved) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.hospital.clinical.title", "Clinical settings")) + "</h2>";
    if (r === undefined) return h + '<p><span class="spin"></span> ' + esc(T(c, "site.admin.hospital.clinical.loading", "Loading clinical settings...")) + "</p></div>";
    if (r === null) return h + '<div class="msg err">' + esc(T(c, "site.admin.hospital.clinical.loadFailed", "The clinical settings could not be loaded. Do not read this as none configured.")) + "</div></div>";
    var s = r.settings || {}, t = r.templates || {};
    var lines = function (a) { return esc((a || []).join("\n")); };
    var val = function (v) { return v == null ? "" : esc(v); };
    return h + '<p class="quiet">' + esc(T(c, "site.admin.hospital.clinical.intro", "What each ward screen uses. A blank setting is not configured, and the screen that needs it says so rather than guessing.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.hospital.clinical.template", "Template")) + '</span><select id="clinTpl"><option value="">' + esc(T(c, "site.admin.hospital.clinical.chooseTemplate", "Choose a template")) + "</option>" +
        Object.keys(t).map(function (k) { return '<option value="' + esc(k) + '">' + esc(t[k].label) + "</option>"; }).join("") + "</select></label>" +
        '<button class="btn ghost" id="clinApply" type="button">' + esc(T(c, "site.admin.hospital.clinical.applyTemplate", "Fill the form from the template")) + '</button></div><div id="clinTplNote" class="quiet"></div>' +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.hospital.clinical.highAlert", "High-alert drugs, one per line")) + '</span><textarea id="clinHigh" rows="4">' + lines(s.highAlertDrugs) + "</textarea></label>" +
        '<label class="f"><span>' + esc(T(c, "site.admin.hospital.clinical.abx", "Antibiotics counted for days of therapy, one per line")) + '</span><textarea id="clinAbx" rows="4">' + lines(s.antibiotics) + "</textarea></label></div>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.hospital.clinical.verify", "Pharmacy verifies an order within (hours)")) + '</span><input id="clinVerify" type="number" min="1" max="168" value="' + val(s.orderVerifyWithinHours) + '" placeholder="' + esc(T(c, "site.admin.hospital.clinical.notConfigured", "not configured")) + '"></label>' +
        '<label class="f"><span>' + esc(T(c, "site.admin.hospital.clinical.rpo", "Backup recovery point objective (minutes)")) + '</span><input id="clinRpo" type="number" min="5" max="10080" value="' + val(s.rpoMinutes) + '" placeholder="' + esc(T(c, "site.admin.hospital.clinical.notConfigured", "not configured")) + '"></label></div>' +
      '<p>' + esc(T(c, "site.admin.hospital.clinical.edInterval", "ED reassessment interval by acuity (minutes)")) + '</p><div class="row">' + ACUITY.map(function (a) {
        return '<label class="f" style="flex:0 1 110px"><span>' + esc(T(c, "site.admin.hospital.clinical.acuity", "Acuity {a}", { a: a })) + '</span><input class="clinEd" data-acuity="' + a + '" type="number" min="1" max="1440" value="' + val((s.edReassessMinutes || {})[a]) + '" placeholder="' + esc(T(c, "site.admin.hospital.clinical.none", "none")) + '"></label>';
      }).join("") + "</div>" +
      '<label class="f"><span><input type="checkbox" id="clinPortal"' + (s.patientAccess && s.patientAccess.enabled ? " checked" : "") + "> " + esc(T(c, "site.admin.hospital.clinical.patientAccess", "Patients may read their own record (patient access)")) + "</span></label>" +
      '<button class="btn" id="clinSave" type="button">' + esc(T(c, "site.admin.hospital.clinical.save", "Save clinical settings")) + '</button><div id="clinMsg"></div>' +
      (saved ? '<div class="msg ok">' + (saved.changed.length
          ? esc(T(c, "site.admin.hospital.clinical.savedLead", "Saved:")) + " " + EN(c, esc(saved.changed.join(", "))) + esc(T(c, "site.admin.hospital.clinical.serverHolds", ". The server now holds:"))
          : esc(T(c, "site.admin.hospital.clinical.savedNoChange", "Saved: nothing had changed. The server now holds:"))) + "</div>" + clinicalReadBackHtml(c, saved.settings) : "") + "</div>";
  }
  function clinicalReadBackHtml(c, s) {
    var esc = c.esc;
    var nc = '<span class="quiet">' + esc(T(c, "site.admin.hospital.clinical.notConfigured", "not configured")) + "</span>";
    var list = function (a) { return a && a.length ? esc(a.join(", ")) : nc; };
    var ed = ACUITY.filter(function (a) { return s.edReassessMinutes && s.edReassessMinutes[a] != null; }).map(function (a) { return T(c, "site.admin.hospital.clinical.edReadback", "acuity {a}: {min} min", { a: a, min: s.edReassessMinutes[a] }); });
    return '<div class="kv"><dt>' + esc(T(c, "site.admin.hospital.clinical.highAlert2", "High-alert drugs")) + "</dt><dd>" + list(s.highAlertDrugs) + "</dd><dt>" + esc(T(c, "site.admin.hospital.clinical.abx2", "Antibiotics")) + "</dt><dd>" + list(s.antibiotics) +
      "</dd><dt>" + esc(T(c, "site.admin.hospital.clinical.verify2", "Verify within")) + "</dt><dd>" + (s.orderVerifyWithinHours != null ? esc(T(c, "site.admin.hospital.clinical.hours", "{n} hours", { n: s.orderVerifyWithinHours })) : nc) +
      "</dd><dt>" + esc(T(c, "site.admin.hospital.clinical.edReassess", "ED reassessment")) + "</dt><dd>" + (ed.length ? esc(ed.join(", ")) : nc) +
      "</dd><dt>" + esc(T(c, "site.admin.hospital.clinical.patientAccess2", "Patient access")) + "</dt><dd>" + (s.patientAccess && s.patientAccess.enabled ? esc(T(c, "site.admin.on", "on")) : esc(T(c, "site.admin.off", "off"))) +
      "</dd><dt>" + esc(T(c, "site.admin.hospital.clinical.rpo2", "Recovery point objective")) + "</dt><dd>" + (s.rpoMinutes != null ? esc(T(c, "site.admin.hospital.clinical.minutes", "{n} minutes", { n: s.rpoMinutes })) : nc) + "</dd></div>";
  }
  /* Reads the form. Blank numbers are "not configured" (null); the server validates the rest. */
  function readClinicalSettings(get) {
    var names = function (id) { return String(get(id) || "").split(/\n/).map(function (x) { return x.trim(); }).filter(Boolean); };
    var num = function (v) { v = String(v == null ? "" : v).trim(); return v === "" ? null : Number(v); };
    var ed = {};
    ACUITY.forEach(function (a) { var v = num(get("ed" + a)); if (v != null) ed[a] = v; });
    return { highAlertDrugs: names("clinHigh"), antibiotics: names("clinAbx"), orderVerifyWithinHours: num(get("clinVerify")), rpoMinutes: num(get("clinRpo")), edReassessMinutes: ed, patientAccess: { enabled: get("clinPortal") === true } };
  }
  WSQ._clinicalSettings = { html: clinicalSettingsHtml, readBack: clinicalReadBackHtml, read: readClinicalSettings };
  function wireClinicalSettings(c) {
    var box = document.getElementById("clinCard");
    if (!box) return;
    var draw = function (r, saved) {
      box.innerHTML = clinicalSettingsHtml(c, r, saved);
      if (!r) return;
      var tplUsed = "";
      document.getElementById("clinApply").onclick = function () {
        var id = document.getElementById("clinTpl").value, tpl = id && r.templates[id];
        if (!tpl) { document.getElementById("clinTplNote").textContent = T(c, "site.admin.hospital.clinical.chooseFirst", "Choose a template first."); return; }
        draw({ settings: tpl.settings, templates: r.templates });
        tplUsed = id;
        document.getElementById("clinTpl").value = id;
        document.getElementById("clinTplNote").textContent = tpl.description + " " + String(T(c, "site.admin.hospital.clinical.notSavedYet", "Nothing is saved until you press Save.")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; });
      };
      document.getElementById("clinSave").onclick = function () {
        var btn = this, m = document.getElementById("clinMsg");
        var get = function (id) {
          if (/^ed\d$/.test(id)) { var e = box.querySelector('.clinEd[data-acuity="' + id.slice(2) + '"]'); return e ? e.value : ""; }
          var el = document.getElementById(id); return el ? (el.type === "checkbox" ? el.checked : el.value) : "";
        };
        btn.disabled = true;
        c.api("/org/clinical-settings", { orgId: c.state.orgId, settings: readClinicalSettings(get), templateId: tplUsed || (document.getElementById("clinTpl").value || undefined) }).then(function (x) {
          btn.disabled = false;
          if (!x || !x.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          draw({ settings: x.settings, templates: r.templates }, { changed: x.changed || [], settings: x.settings });
          c.toast(T(c, "site.admin.hospital.clinical.saved", "Clinical settings saved."));
        });
      };
    };
    draw(undefined);
    c.api("/org/clinical-settings?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) { draw(r && r.ok ? r : null); }, function () { draw(null); });
  }
  /* CRITICAL RESULT ALERTS TO PHONES (S3 P0). Whether a critical result is pushed through the StewardMD
   * app, who each level tells, the SMS fallback when no phone confirms, and - loudest - every open result
   * that told nobody. Everything shown comes from GET /ward/alert-status, so this card never has its own
   * idea of the ladder or of which defaults were approved. null = loading, false = could not be read. */
  var ALERT_LEVEL_IDS = ["due", "overdue", "escalate"];
  function alertLevelLabel(c, id) {
    return {
      due: T(c, "site.admin.hospital.alert.level.due", "When the result is released"),
      overdue: T(c, "site.admin.hospital.alert.level.overdue", "Not acknowledged in time"),
      escalate: T(c, "site.admin.hospital.alert.level.escalate", "Still not acknowledged"),
    }[id] || id;
  }
  var ALERT_ROLES = ["doctor", "resident", "supervisor", "nurse", "intern", "pg_resident", "pg_faculty", "pg_hod"];
  function alertReasonLabel(c, code) {
    return {
      NO_RECIPIENT: T(c, "site.admin.hospital.alert.reason.noRecipient", "nobody could be found to tell (no ordering clinician, nobody with a listed role on duty, no named contact)"),
      NO_DEVICE: T(c, "site.admin.hospital.alert.reason.noDevice", "nobody it was addressed to has a phone registered for alerts"),
      PUSH_NOT_CONFIGURED: T(c, "site.admin.hospital.alert.reason.pushNotConfigured", "push is not configured on the server"),
      SMS_NOT_CONFIGURED: T(c, "site.admin.hospital.alert.reason.smsNotConfigured", "the SMS fallback is not configured"),
      NO_MOBILE: T(c, "site.admin.hospital.alert.reason.noMobile", "nobody it was addressed to has an alert mobile"),
      SMS_FAILED: T(c, "site.admin.hospital.alert.reason.smsFailed", "the SMS could not be sent"),
    }[code];
  }
  function alertCardHtml(c, s) {
    var esc = c.esc;
    var h = '<div class="card" id="admAlertCard"><h2>' + esc(T(c, "site.admin.hospital.alert.title", "Critical result alerts to phones")) + "</h2>";
    if (s == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.hospital.alert.loading", "Loading...")) + "</div>";
    if (s === false || !s.ok) return h + '<div class="msg err">' + esc(T(c, "site.admin.hospital.alert.loadFailedLead", "The alert settings could not be loaded")) + (s && s.error ? " (" + EN(c, esc(s.error)) + ")" : "") + ". " + esc(T(c, "site.admin.hospital.alert.loadFailedTrail", "Do not read this as alerts being off or as nothing having failed.")) + "</div></div>";
    var lv = s.levels || {}, d = s.defaults || {}, ap = d.approval || {};
    var rows = ALERT_LEVEL_IDS.map(function (id) {
      var x = lv[id] || { roles: [], contacts: [] };
      var when = id === "due" ? T(c, "site.admin.hospital.alert.atOnce", "at once")
        : id === "overdue" ? T(c, "site.admin.hospital.alert.afterMin", "after {n} min", { n: s.minutes && s.minutes.acknowledgeWithinMinutes })
        : T(c, "site.admin.hospital.alert.afterMin", "after {n} min", { n: s.minutes && s.minutes.escalateAfterMinutes });
      return '<tr data-level="' + id + '"><td><b>' + esc(alertLevelLabel(c, id)) + "</b><br><small>" + esc(when) + "</small></td>" +
        '<td><label><input type="checkbox" class="alOrderer"' + (x.orderer ? " checked" : "") + "> " + esc(T(c, "site.admin.hospital.alert.orderingClinician", "ordering clinician")) + "</label></td>" +
        "<td>" + ALERT_ROLES.map(function (r) { return '<label style="white-space:nowrap"><input type="checkbox" class="alRole" value="' + r + '"' + ((x.roles || []).indexOf(r) >= 0 ? " checked" : "") + "> " + esc(r.replace(/_/g, " ")) + "</label> "; }).join("") + "</td>" +
        '<td><textarea class="alContacts" rows="2" placeholder="' + esc(T(c, "site.admin.hospital.alert.contactsPlaceholder", "one staff ID or email per line")) + '">' + esc((x.contacts || []).join("\n")) + "</textarea></td></tr>";
    }).join("");
    var sms = s.sms || {};
    var fails = (s.failures || []).map(function (f) {
      return "<tr><td>" + esc(f.at || "") + "</td><td>" + esc(f.level || "") + (f.sms ? " (" + esc(T(c, "site.admin.hospital.alert.sms", "SMS")) + ")" : "") + '</td><td class="mono">' + esc(f.loopId) + "</td><td>" + esc(alertReasonLabel(c, f.reason) || f.reason) + "</td></tr>";
    }).join("");
    return h +
      '<label class="f"><span><input type="checkbox" id="alEnabled"' + (s.enabled ? " checked" : "") + "> " + esc(T(c, "site.admin.hospital.alert.pushToggle", "Push critical results to phones through the StewardMD app")) + "</span></label>" +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.alert.pushIntro", "The push names the ward and bed only, never the patient. The detail opens after the phone is unlocked, and only for the people it was sent to. Acknowledging is still done with a sentence saying what was done.")) + "</p>" +
      "<h3>" + esc(T(c, "site.admin.hospital.alert.whoTells", "Who each level tells")) + "</h3>" +
      (lv.approval ? '<p class="msg ok">' + esc(T(c, "site.admin.hospital.alert.defaultApproved", "Default ladder approved by")) + " " + EN(c, esc(ap.approvedBy)) + " " + esc(T(c, "site.admin.hospital.alert.on", "on")) + " " + EN(c, esc(ap.approvedOn)) + ".</p>"   /* LT-35: no internal decision reference on a hospital's screen */
        : '<p class="msg note">' + esc(T(c, "site.admin.hospital.alert.ownLadderLead", "This hospital has set its own ladder. The approved default ({by}, {on}) is ordering clinician and on-duty doctors, then supervisors and nurses on duty, then named contacts.", { by: EN(c, esc(ap.approvedBy)), on: EN(c, esc(ap.approvedOn)) })) + "</p>") +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.alert.eachLevelTells", "Each level tells the people of the levels before it again. On-duty roles come from the rota for the patient's ward.")) + "</p>" +
      wardRuleHtml(c, s.wardRule) +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.hospital.alert.colLevel", "Level")) + "</th><th></th><th>" + esc(T(c, "site.admin.hospital.alert.colOnDuty", "On duty with role")) + "</th><th>" + esc(T(c, "site.admin.hospital.alert.colContacts", "Named contacts")) + "</th></tr></thead><tbody>" + rows + "</tbody></table></div>" +
      "<h3>" + esc(T(c, "site.admin.hospital.alert.smsTitle", "SMS when no phone confirms")) + "</h3>" +
      '<p class="quiet">' + esc(T(c, "site.admin.hospital.alert.smsIntro", "If no phone confirms a push within its level's time, it is sent once by SMS to each person's alert mobile (set on Staff and roles), using your DLT-approved 2Factor template whose first variable is the ward and second the bed.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.hospital.alert.senderId", "DLT sender ID")) + '</span><input id="alSender" value="' + esc(sms.senderId || "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.hospital.alert.templateName", "DLT template name")) + '</span><input id="alTemplate" value="' + esc(sms.templateName || "") + '"></label></div>' +
      (sms.ready ? '<p class="msg ok">' + esc(T(c, "site.admin.hospital.alert.smsReady", "SMS fallback is ready.")) + "</p>" : '<div class="msg err"><b>' + esc(T(c, "site.admin.hospital.alert.smsNotConfigured", "SMS fallback is not configured.")) + '</b> ' + esc(T(c, "site.admin.hospital.alert.missing", "Missing:")) + '<br>' + EN(c, (sms.missing || []).map(esc).join("<br>")) + "</div>") +
      '<button class="btn" id="alSave" type="button">' + esc(T(c, "site.admin.hospital.alert.save", "Save alert settings")) + '</button><div id="alMsg"></div>' +
      "<h3>" + esc(T(c, "site.admin.hospital.alert.openResults", "Open results that told nobody")) + "</h3>" +
      (fails ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.hospital.alert.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.hospital.alert.colLevel", "Level")) + "</th><th>" + esc(T(c, "site.admin.hospital.alert.colLoop", "Loop")) + "</th><th>" + esc(T(c, "site.admin.hospital.alert.colWhy", "Why")) + "</th></tr></thead><tbody>" + fails + "</tbody></table></div>"
        : '<p class="quiet">' + esc(s.partial ? T(c, "site.admin.hospital.alert.nonePartial", "None among the open critical results read (only the newest 500 were checked).") : T(c, "site.admin.hospital.alert.none", "None among the open critical results read.")) + "</p>") +
      "<h3>" + esc(T(c, "site.admin.hospital.alert.phonesNow", "Phones registered for alerts now")) + "</h3>" + phonesHtml(c, s.phones) +
      ((s.noDevice || []).length ? '<p class="msg note">' + esc(T(c, "site.admin.hospital.alert.alreadySentLead", "Alerts already sent to people with no phone registered:")) + " " + EN(c, s.noDevice.map(function (x) { return esc(x.identity); }).join(", ")) + "</p>" : "") +
      "</div>";
  }
  /* Owner decision 2026-09-15, read-only: the named rule that picks who a level 2 alert tells in the patient's ward. */
  function wardRuleHtml(c, r) {
    var esc = c.esc;
    if (!r) return '<div class="msg err">' + esc(T(c, "site.admin.hospital.alert.wardRuleFailed", "The level 2 ward rule could not be read.")) + "</div>";
    return '<div class="kv"><dt>' + esc(T(c, "site.admin.hospital.alert.wardRuleTitle", "Level 2 ward rule")) + '</dt><dd><span class="mono">' + esc(r.rule) + "</span>" +
      (r.source === "default" ? ' <span class="quiet">(' + esc(T(c, "site.admin.hospital.alert.default", "default")) + ')</span>' : r.source === "unrecognised" ? ' <span class="msg err">' + esc(T(c, "site.admin.hospital.alert.unrecognisedLead", "the saved rule")) + ' "' + EN(c, esc(r.configured)) + '" ' + esc(T(c, "site.admin.hospital.alert.unrecognisedTrail", "is not one this build has, so this rule is applied")) + '</span>' : "") + "</dd></div>" +
      '<p class="quiet">' + EN(c, esc(r.note)) + ' ' + esc(T(c, "site.admin.hospital.alert.wardRuleNote", "On level 2, \"nurse\" in the table below stands for this rule. Nurses, residents and consultants mark themselves on or off duty in the ward screen; off duty lasts until the end of their rostered shift, or 12 hours. The rule cannot be changed on this card.")) + "</p>" +
      '<p class="quiet"><b>' + esc(T(c, "site.admin.hospital.alert.noWardLead", "Patient with no ward recorded:")) + '</b> ' + String(T(c, "site.admin.hospital.alert.noWardBody", "at every level the alert goes to the doctor the patient is admitted under, unless that doctor has marked themselves off duty, and to the residents on duty now in that doctor's department (anywhere in the hospital when the department is not known). No nurse, supervisor or other consultant on duty is told. The ordering clinician and named contacts are still told by name. If there is no admitting doctor and no resident on duty, the alert is recorded as reaching nobody.")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</p>";
  }
  /* Read from the phone registrations themselves (not from past alerts): everyone on duty with a role on the
   * ladder, and every named contact. A failed read is said, never shown as everyone having a phone. */
  function phonesHtml(c, p) {
    var esc = c.esc;
    if (!p || !p.ok) return '<div class="msg err">' + esc(T(c, "site.admin.hospital.alert.phonesFailedLead", "Which phones are registered could not be read")) + (p && p.error ? " (" + EN(c, esc(p.error)) + ")" : "") + ". " + esc(T(c, "site.admin.hospital.alert.phonesFailedTrail", "Do not read this as everyone having one.")) + "</div>";
    var note = p.partial ? " " + String(T(c, "site.admin.hospital.alert.rotaPartial", "The rota was too large to read in full, so some people on duty may not be listed.")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) : "";
    if (!p.checked) return '<p class="quiet">' + esc(T(c, "site.admin.hospital.alert.nobodyToCheck", "Nobody is on duty now with a role on the ladder, and no contact is named, so there is nobody to check.")) + esc(note) + "</p>";
    if (!(p.noDevice || []).length) return '<p class="msg ok">' + esc(T(c, "site.admin.hospital.alert.allHavePhones", "All {n} people on duty with a role on the ladder, and the named contacts, have a phone registered.", { n: p.checked })) + esc(note) + "</p>";
    return '<div class="msg err"><b>' + esc(T(c, "site.admin.hospital.alert.noPhoneCount", "No phone registered for alerts ({n} of {total}):", { n: p.noDevice.length, total: p.checked })) + "</b><br>" +
      p.noDevice.map(function (x) { return EN(c, esc(x.identity)) + " (" + esc(x.why === "named contact" ? T(c, "site.admin.hospital.alert.namedContact", "named contact") : T(c, "site.admin.hospital.alert.onDuty", "on duty")) + (x.role ? ", " + esc(x.role) : "") + ")"; }).join("<br>") +
      "<br>" + esc(T(c, "site.admin.hospital.alert.smsOnly", "They get an alert only by SMS, if that is set up.")) + esc(note) + "</div>";
  }
  /* Reads the card back. v = { enabled, senderId, templateName, levels: {due: {orderer, roles, contactsText}}, escalation }. */
  function readAlertCard(c, v) {
    var levels = {}, bad = "";
    ALERT_LEVEL_IDS.forEach(function (id) {
      var x = (v.levels && v.levels[id]) || {};
      var contacts = String(x.contactsText || "").split(/\n/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (contacts.some(function (t) { return t.length > 120; })) bad = T(c, "site.admin.hospital.alert.errContactTooLong", "A named contact is too long: use the staff ID or email.");
      levels[id] = { orderer: !!x.orderer, roles: (x.roles || []).slice(), contacts: contacts };
    });
    if (bad) return { error: bad };
    var esc0 = v.escalation && typeof v.escalation === "object" ? v.escalation : {};
    var escalation = {}; Object.keys(esc0).forEach(function (k) { escalation[k] = esc0[k]; }); escalation.levels = levels;
    return { wardsynq: {
      alerts: { push: { enabled: !!v.enabled }, sms: { provider: "twofactor", senderId: String(v.senderId || "").trim(), templateName: String(v.templateName || "").trim() } },
      criticalEscalation: escalation,
    } };
  }
  WSQ._alertCard = { html: alertCardHtml, read: readAlertCard };
  function loadAlertCard(c) {
    var slot = document.getElementById("admAlertSlot");
    if (!slot) return;
    slot.innerHTML = alertCardHtml(c, null);
    c.api("/ward/alert-status?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      slot.innerHTML = alertCardHtml(c, r && r.ok ? r : false);
      var btn = document.getElementById("alSave");
      if (!btn) return;
      btn.onclick = function () {
        var m = document.getElementById("alMsg"), lv = {};
        document.querySelectorAll("#admAlertCard tr[data-level]").forEach(function (tr) {
          var roles = []; tr.querySelectorAll(".alRole").forEach(function (b) { if (b.checked) roles.push(b.value); });
          lv[tr.getAttribute("data-level")] = { orderer: tr.querySelector(".alOrderer").checked, roles: roles, contactsText: tr.querySelector(".alContacts").value };
        });
        var out = readAlertCard(c, { enabled: document.getElementById("alEnabled").checked, senderId: document.getElementById("alSender").value, templateName: document.getElementById("alTemplate").value, levels: lv, escalation: ((c.state.org || {}).wardsynq || {}).criticalEscalation });
        if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
        btn.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, wardsynq: out.wardsynq }).then(function (u) {
          btn.disabled = false;
          if (!u || !u.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, u))) + "</div>"; return; }
          c.state.org = u.org; c.toast(out.wardsynq.alerts.push.enabled ? T(c, "site.admin.hospital.alert.savedOn", "Saved. Critical results are pushed to phones.") : T(c, "site.admin.hospital.alert.savedOff", "Saved. Critical results are not pushed to phones.")); loadAlertCard(c);
        });
      };
    });
  }
  function renderHospital(c, body) {
    var o = c.state.org || {};
    var countryLabel = function (region) { return region === "US" ? T(c, "site.admin.hospital.country.us", "United States") : T(c, "site.admin.hospital.country.in", "India"); };
    body.innerHTML = '<div class="card"><h2>' + c.ms("local_hospital") + " " + c.esc(T(c, "site.admin.hospital.title", "Hospital")) + "</h2>" +
      '<div class="kv"><dt>' + c.esc(T(c, "site.admin.hospital.name", "Name")) + "</dt><dd>" + c.esc(o.name || "") + "</dd>" +
      '<dt>' + c.esc(T(c, "site.admin.hospital.code", "Code")) + '</dt><dd class="mono">' + c.esc(o.code || "") + "</dd>" +
      "<dt>" + c.esc(T(c, "site.admin.hospital.mode", "Mode")) + "</dt><dd>" + c.esc(o.mode || "") + "</dd>" +
      /* LT-35: the organisation id and the Connect tenant id are internal keys, not something a hospital admin reads or
       * acts on; the hospital code above is how support identifies the hospital. */
      "<dt>" + c.esc(T(c, "site.admin.hospital.countryLabel", "Country")) + "</dt><dd>" + c.esc(countryLabel(o.region)) + "</dd></div>" +
      '<h3>' + c.esc(T(c, "site.admin.hospital.nameAndCountry", "Name and country")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.hospital.nameField", "Hospital name")) + '</span><input id="admHospName" value="' + c.esc(o.name || "") + '"></label>' +
      '<label class="f" style="flex:0 1 180px"><span>' + c.esc(T(c, "site.admin.hospital.countryLabel", "Country")) + '</span><select id="admHospRegion">' +
        '<option value="IN"' + (o.region === "US" ? "" : " selected") + ">" + c.esc(T(c, "site.admin.hospital.country.in", "India")) + "</option>" +
        '<option value="US"' + (o.region === "US" ? " selected" : "") + ">" + c.esc(T(c, "site.admin.hospital.country.us", "United States")) + "</option></select></label>" +
      /* India: the HFR facility ID the ABDM profile must match (Integrations > ABDM). Validated on the server. */
      (o.region === "US" ? "" : '<label class="f" style="flex:0 1 200px"><span>' + c.esc(T(c, "site.admin.hospital.hfr", "HFR facility ID (India)")) + '</span><input id="admHospHfr" class="mono" maxlength="20" placeholder="' + c.esc(T(c, "site.admin.hospital.hfrPlaceholder", "IN and 10 digits")) + '" value="' + c.esc((o.regionProfile && o.regionProfile.hfrId) || "") + '"></label>') +
      '<button class="btn" id="admHospSave" type="button">' + c.esc(T(c, "site.admin.save", "Save")) + '</button></div>' +
      /* Said plainly, because it changes how numbers already on the chart are READ, not what they
       * say: nothing is converted, and nothing already recorded is rewritten. */
      '<p class="quiet">' + c.esc(T(c, "site.admin.hospital.countryNote", "The country decides what counts as a valid phone number and the unit a temperature is charted in from now on. Readings already recorded keep the unit they were recorded in.")) + '</p><div id="admHospMsg"></div>' +
      (c.isWardsynq() ? "" : '<div class="msg note">' + c.esc(T(c, "site.admin.hospital.needsWardsynq", "Inpatient features (ward, beds, theatre, Digital Twin) need a WardSynQ hospital. Create one from the hospital list.")) + '</div>') +
      '</div><div id="tokCard"></div>' +
      (c.isWardsynq() ? '<div id="admAlertSlot"></div><div id="clinCard"></div>' + noteWritersCard(c, o) + printLangCard(c, o) + approvalRulesHtml(c, o.wardsynq) + labCheckHtml(c, o.wardsynq) : "") +
      /* BUG-MU2PHANW: the owner (or platform owner) only; the same two-step dialog as the hospital list. */
      (c.state.who && (c.state.who.orgOwner || c.state.who.platformOwner) && c.removeHospital
        ? '<div class="card"><h2>' + c.esc(T(c, "site.admin.hospital.removeTitle", "Remove this hospital")) + '</h2><p class="quiet">' + c.esc(T(c, "site.admin.hospital.removeIntro", "Removes it from every hospital list. Patient records, documents and the audit trail are kept.")) + '</p>' +
          '<div class="row"><button class="btn danger" id="admHospRemove" type="button">' + c.ms("delete") + c.esc(T(c, "site.admin.hospital.removeButton", "Remove hospital")) + "</button></div></div>"
        : "");
    var rmBtn = document.getElementById("admHospRemove");
    if (rmBtn) rmBtn.onclick = function () { c.removeHospital(o.id ? o : { id: c.state.orgId, name: o.name }, function () { c.go("hospitals"); }); };
    document.getElementById("admHospSave").onclick = function () {
      var btn = document.getElementById("admHospSave");
      var name = (document.getElementById("admHospName").value || "").trim();
      if (!name) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.hospital.errName", "Give the hospital a name.")) + "</div>"; return; }
      btn.disabled = true;
      var upd = { orgId: c.state.orgId, name: name, region: document.getElementById("admHospRegion").value };
      var hfrEl = document.getElementById("admHospHfr");
      if (hfrEl && upd.region === "IN") upd.regionProfile = { hfrId: String(hfrEl.value || "").replace(/[\s-]+/g, "").toUpperCase() };
      c.api("/org/update", upd).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        c.state.org = r.org; c.toast(T(c, "site.admin.hospital.saved", "Hospital updated.")); WSQ.render("admin");
      });
    };
    wireClinicalSettings(c);
    wireNoteWriters(c);
    wirePrintLang(c);
    wireApprovalRules(c);
    wireLabCheck(c);
    wireTokenCard(c);
    if (c.isWardsynq()) loadAlertCard(c);
  }

  // ---- Safety reminders (dry run) ----------------------------------------------------------------
  /* A DRAFT IS TESTED BEFORE IT IS PUBLISHED. A hospital's own safety reminders fire on real patients, and
   * a badly written one either never fires or fires on everybody - both are found out on a ward. This
   * compiles the draft on the server and reports what it WOULD have done, and changes nothing: publishing
   * is the separate, existing hospital-settings step. A draft that does not compile says why. */
  /* FORMS: write a form as JSON, save it as a draft (kept even with problems, every problem listed), publish
   * when it has none. A published version never changes; publishing again makes the next version. */
  function renderForms(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/forms/definitions?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.forms.loadFailed", "Could not load the forms.")) + " " + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
      var list = function (title, rows, draft) {
        return "<h3>" + c.esc(title) + "</h3>" + (rows.length ? "<ul>" + rows.map(function (x) {
          var d = draft ? x.def : x;
          return "<li><b>" + c.esc(d.title || d.key) + "</b> (" + c.esc(d.key) + (draft ? ", " + c.esc(T(c, "site.admin.forms.draft", "draft")) : ", " + c.esc(T(c, "site.admin.forms.version", "version {v}", { v: d.version }))) + ")" +
            (draft ? (x.problems.length ? '<div class="msg err">' + x.problems.map(c.esc).join("<br>") + "</div>" : ' <button class="btn" type="button" data-form-pub="' + c.esc(d.key) + '">' + c.esc(T(c, "site.admin.forms.publish", "Publish")) + '</button>') : "") +
            ' <button class="btn quiet" type="button" data-form-edit="' + c.esc(d.key) + '" data-form-draft="' + (draft ? "1" : "") + '">' + c.esc(T(c, "site.admin.forms.edit", "Edit")) + "</button></li>";
        }).join("") + "</ul>" : "<p>" + c.esc(T(c, "site.admin.forms.none", "None.")) + "</p>");
      };
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.forms.title", "Forms")) + "</h2>" + list(T(c, "site.admin.forms.drafts", "Drafts"), r.drafts, true) + list(T(c, "site.admin.forms.published", "Published"), r.published, false) +
        '<h3>' + c.esc(T(c, "site.admin.forms.editJson", "Edit a form (JSON)")) + '</h3><textarea id="admFormJson" rows="14" style="width:100%;font-family:monospace" placeholder=\'{"key":"nursing_admission","title":"Nursing admission assessment","roles":["nurse"],"sections":[{"title":"Risks","fields":[{"key":"falls_risk","label":"Falls risk","type":"boolean","required":true}]}]}\'></textarea>' +
        '<button class="btn" type="button" id="admFormSave">' + c.esc(T(c, "site.admin.forms.saveDraft", "Save draft")) + '</button><div id="admFormMsg"></div></div>';
      body.querySelectorAll("[data-form-edit]").forEach(function (b) {
        b.onclick = function () {
          var key = b.getAttribute("data-form-edit"), isDraft = b.getAttribute("data-form-draft") === "1";
          var d = isDraft ? r.drafts.filter(function (x) { return x.key === key; })[0].def : r.published.filter(function (x) { return x.key === key; })[0];
          document.getElementById("admFormJson").value = JSON.stringify(d, null, 2);
        };
      });
      body.querySelectorAll("[data-form-pub]").forEach(function (b) {
        b.onclick = function () {
          c.api("/forms/publish", { orgId: c.state.orgId, key: b.getAttribute("data-form-pub") }).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(c, x)); return; }
            c.toast(T(c, "site.admin.forms.publishedAs", "Published as version {v}.", { v: x.version })); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admFormSave").onclick = function () {
        var def; try { def = JSON.parse(document.getElementById("admFormJson").value); } catch (e) { document.getElementById("admFormMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.forms.badJsonLead", "That is not valid JSON:")) + " " + EN(c, c.esc(e.message)) + "</div>"; return; }
        delete def.status; delete def.version; delete def.publishedAt;
        c.api("/forms/draft", { orgId: c.state.orgId, definition: def }).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admFormMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          c.toast(x.problems.length ? T(c, "site.admin.forms.savedProblems", "Draft saved with {n} problem(s) to fix before publishing.", { n: x.problems.length }) : T(c, "site.admin.forms.savedOk", "Draft saved. It can be published.")); WSQ.render("admin");
        });
      };
    });
  }

  /* CLINICAL PATHWAYS (P2.12): hospital pathway definitions, draft saving, publishing immutable versions,
   * and retiring outdated versions with a mandatory reason. */
  function renderPathways(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/pathways/definitions?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.pathways.loadFailed", "Could not load the clinical pathways.")) + " " + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
      var list = function (title, rows, draft) {
        return "<h3>" + c.esc(title) + "</h3>" + (rows && rows.length ? "<ul>" + rows.map(function (x) {
          var d = draft ? x.def : x;
          var retired = d.status === "retired";
          return "<li><b>" + c.esc(d.title || d.key) + "</b> (" + c.esc(d.key) + (draft ? ", " + c.esc(T(c, "site.admin.forms.draft", "draft")) : ", " + c.esc(T(c, "site.admin.forms.version", "version {v}", { v: d.version }))) + (retired ? " - " + c.esc(T(c, "site.admin.pathways.retired", "RETIRED")) : "") + ")" +
            (draft ? (x.problems && x.problems.length ? '<div class="msg err">' + x.problems.map(c.esc).join("<br>") + "</div>" : ' <button class="btn" type="button" data-pw-pub="' + c.esc(d.key) + '">' + c.esc(T(c, "site.admin.forms.publish", "Publish")) + '</button>') : "") +
            (!draft && !retired ? ' <button class="btn ghost" type="button" data-pw-retire="' + c.esc(d.key) + '" data-pw-v="' + c.esc(d.version) + '">' + c.esc(T(c, "site.admin.pathways.retire", "Retire")) + '</button>' : "") +
            ' <button class="btn quiet" type="button" data-pw-edit="' + c.esc(d.key) + '" data-pw-draft="' + (draft ? "1" : "") + '">' + c.esc(T(c, "site.admin.forms.edit", "Edit")) + "</button></li>";
        }).join("") + "</ul>" : "<p>" + c.esc(T(c, "site.admin.forms.none", "None.")) + "</p>");
      };
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.pathways.title", "Clinical pathways")) + "</h2>" + list(T(c, "site.admin.forms.drafts", "Drafts"), r.drafts || [], true) + list(T(c, "site.admin.forms.published", "Published"), r.published || [], false) +
        '<h3>' + c.esc(T(c, "site.admin.pathways.editJson", "Edit a pathway (JSON)")) + '</h3><textarea id="admPwJson" rows="14" style="width:100%;font-family:monospace" placeholder=\'{"key":"sepsis_bundle","title":"Sepsis resuscitation bundle","owner":"Critical Care Committee","effectiveDate":"2026-01-01","reviewDate":"2027-01-01","evidence":[{"citation":"Surviving Sepsis Campaign 2021"}],"steps":[{"key":"blood_cultures","title":"Blood cultures before antibiotics","kind":"orders","orderSetId":"sepsis_labs"}]}\'></textarea>' +
        '<button class="btn" type="button" id="admPwSave">' + c.esc(T(c, "site.admin.forms.saveDraft", "Save draft")) + '</button><div id="admPwMsg"></div></div>';
      body.querySelectorAll("[data-pw-edit]").forEach(function (b) {
        b.onclick = function () {
          var key = b.getAttribute("data-pw-edit"), isDraft = b.getAttribute("data-pw-draft") === "1";
          var d = isDraft ? (r.drafts || []).filter(function (x) { return x.key === key; })[0].def : (r.published || []).filter(function (x) { return x.key === key; })[0];
          document.getElementById("admPwJson").value = JSON.stringify(d, null, 2);
        };
      });
      body.querySelectorAll("[data-pw-pub]").forEach(function (b) {
        b.onclick = function () {
          c.api("/pathways/publish", { orgId: c.state.orgId, key: b.getAttribute("data-pw-pub") }).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(c, x)); return; }
            c.toast(T(c, "site.admin.forms.publishedAs", "Published as version {v}.", { v: x.version })); WSQ.render("admin");
          });
        };
      });
      body.querySelectorAll("[data-pw-retire]").forEach(function (b) {
        b.onclick = function () {
          var reason = window.prompt(T(c, "site.admin.pathways.retirePrompt", "Reason for retiring this pathway version (mandatory):"));
          if (!reason || reason.trim().length < 5) { alert(T(c, "site.admin.pathways.retireTooShort", "A retirement reason of at least 5 characters is required.")); return; }
          c.api("/pathways/retire", { orgId: c.state.orgId, key: b.getAttribute("data-pw-retire"), version: b.getAttribute("data-pw-v"), reason: reason.trim() }).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(c, x)); return; }
            c.toast(T(c, "site.admin.pathways.retired2", "Pathway version retired.")); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admPwSave").onclick = function () {
        var def; try { def = JSON.parse(document.getElementById("admPwJson").value); } catch (e) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.forms.badJsonLead", "That is not valid JSON:")) + " " + EN(c, c.esc(e.message)) + "</div>"; return; }
        delete def.status; delete def.version; delete def.publishedAt;
        c.api("/pathways/draft", { orgId: c.state.orgId, definition: def }).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          c.toast(x.problems && x.problems.length ? T(c, "site.admin.forms.savedProblems", "Draft saved with {n} problem(s) to fix before publishing.", { n: x.problems.length }) : T(c, "site.admin.forms.savedOk", "Draft saved. It can be published.")); WSQ.render("admin");
        });
      };
    });
  }
  function renderAdvisories(c, body) {
    body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.advisories.title", "Safety reminders - try a draft")) + '</h2>' +
      '<p class="quiet">' + c.esc(T(c, "site.admin.advisories.intro", "Paste the draft reminder set (JSON). Nothing is published or changed by trying it.")) + '</p>' +
      '<textarea id="admAdvDraft" rows="10" style="width:100%"></textarea>' +
      '<button type="button" class="btn" id="admAdvRun">' + c.esc(T(c, "site.admin.advisories.tryIt", "Try it")) + '</button><div id="admAdvOut"></div></div>';
    document.getElementById("admAdvRun").onclick = function () {
      var out = document.getElementById("admAdvOut"), draft;
      try { draft = JSON.parse(document.getElementById("admAdvDraft").value || "null"); }
      catch (e) { out.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.advisories.badJson", "That is not valid JSON, so it was not tried.")) + "</div>"; return; }
      out.innerHTML = '<span class="spin"></span>';
      c.api("/ward/advisory-check", { orgId: c.state.orgId, advisories: draft }).then(function (r) {
        if (!r || !r.ok) { out.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        out.innerHTML = '<div class="msg note">' + c.esc(T(c, "site.admin.advisories.tried", "Tried, not published.")) + '</div><pre style="white-space:pre-wrap">' + c.esc(JSON.stringify(r, null, 2)) + "</pre>";
      });
    };
  }

  // ---- Price list -------------------------------------------------------------------------------
  /* WHAT THE HOSPITAL CHARGES. Prices are stored in paise, whole numbers, and shown in rupees - the
   * conversion happens only here, on the way in and out, so no amount is ever held as a fraction that
   * rounds differently in two places. Every change is audited on the server with the old price and the
   * new one. Withdrawing an item hides it from new bills but keeps it, because old bills still name it. */
  function rupees(paise) { var n = Number(paise); return isFinite(n) ? (n / 100).toFixed(2) : ""; }
  /* WHAT A HOSPITAL CHARGES FOR A STAY (LT-30). Bed, nursing care and doctor visits are charged per day of
   * an inpatient stay by the ward bill; a bed can be priced for one ward (by name) or for every ward. Tests
   * and medicines are priced by the name they are ordered under, so the bill finds them without a code. */
  var TARIFF_KINDS = ["bed", "nursing", "visit", "investigation", "medication", "service"];
  function tariffKindLabel(c, k) {
    return {
      bed: T(c, "site.admin.tariff.kindBed", "Bed, per day"), nursing: T(c, "site.admin.tariff.kindNursing", "Nursing care, per day"),
      visit: T(c, "site.admin.tariff.kindVisit", "Doctor visit, per day"), investigation: T(c, "site.admin.tariff.kindLabTest", "Lab or radiology test"),
      medication: T(c, "site.admin.tariff.kindMedicine", "Medicine"), service: T(c, "site.admin.tariff.kindService", "Service"),
    }[k] || k;
  }
  function renderTariff(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return Promise.all([c.api("/bill/tariff?orgId=" + encodeURIComponent(c.state.orgId)), c.api("/wards?orgId=" + encodeURIComponent(c.state.orgId)).catch(function () { return null; })]).then(function (both) {
      var r = both[0], wr = both[1];
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.tariff.loadFailed", "The price list could not be loaded. Do not read this as an empty price list.")) + "</div>"; return; }
      var items = r.items || [];
      // null = the wards could not be read: a per-ward bed price then cannot be offered, and the screen says so.
      var wards = wr && wr.ok ? (wr.wards || []).map(function (w) { return w.name; }).filter(Boolean) : null;
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.tariff.title", "Price list")) + "</h2>" +
        (items.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.tariff.colItem", "Item")) + "</th><th>" + c.esc(T(c, "site.admin.tariff.colCode", "Code")) + "</th><th>" + c.esc(T(c, "site.admin.tariff.colKind", "Kind")) + "</th><th>" + c.esc(T(c, "site.admin.tariff.colPrice", "Price (Rs)")) + "</th><th></th></tr></thead><tbody>" +
          items.map(function (t) {
            var daily = t.kind === "bed" || t.kind === "nursing" || t.kind === "visit";
            return "<tr><td>" + c.esc(t.name) + "</td><td>" + c.esc(t.code || "") + "</td><td>" + c.esc(tariffKindLabel(c, t.kind)) +
              (daily ? "<br><small>" + c.esc(t.ward ? T(c, "site.admin.tariff.wardOnly", "{ward} only", { ward: t.ward }) : T(c, "site.admin.tariff.everyWard", "Every ward")) + "</small>" : "") + "</td><td>" + c.esc(rupees(t.price)) + "</td>" +
              '<td><button type="button" class="btn ghost" data-trf-edit="' + c.esc(t.id) + '">' + c.esc(T(c, "site.admin.tariff.changePrice", "Change price")) + '</button> ' +
              '<button type="button" class="btn ghost" data-trf-off="' + c.esc(t.id) + '">' + c.esc(T(c, "site.admin.tariff.withdraw", "Withdraw")) + "</button></td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.tariff.none", "No prices set yet.")) + "</p>") +
        '<h3>' + c.esc(T(c, "site.admin.tariff.addItem", "Add an item")) + '</h3><div class="row">' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.tariff.name", "Name")) + '</span><input id="admTrfName"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.tariff.colCode", "Code")) + '</span><input id="admTrfCode"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.tariff.colKind", "Kind")) + '</span><select id="admTrfKind">' + TARIFF_KINDS.map(function (k) { return '<option value="' + k + '">' + c.esc(tariffKindLabel(c, k)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.tariff.ward", "Ward (per-day charges)")) + '</span><select id="admTrfWard"><option value="">' + c.esc(T(c, "site.admin.tariff.everyWard", "Every ward")) + "</option>" +
          (wards || []).map(function (w) { return '<option value="' + c.esc(w) + '">' + c.esc(w) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.tariff.colPrice", "Price (Rs)")) + '</span><input id="admTrfPrice" inputmode="decimal"></label>' +
        '</div>' + (wards === null ? '<div class="msg err">' + c.esc(T(c, "site.admin.tariff.wardsFailed", "The wards could not be loaded, so a bed price can only be set for every ward right now.")) + "</div>" : "") +
        '<p class="quiet">' + c.esc(T(c, "site.admin.tariff.howBilled", "Bed, nursing and doctor visit prices are charged for each day of an inpatient stay. Name a test or medicine exactly as it is ordered, so the bill can find its price.")) + "</p>" +
        '<button type="button" class="btn" id="admTrfAdd">' + c.esc(T(c, "site.admin.add", "Add")) + '</button><div id="admTrfMsg"></div>' +
        '<p class="quiet">' + c.esc(T(c, "site.admin.tariff.everyChange", "Every change is recorded with the old and new price.")) + "</p></div>";

      function save(item) {
        return c.api("/bill/tariff", Object.assign({ orgId: c.state.orgId }, item)).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          c.toast(T(c, "site.admin.saved", "Saved.")); renderTariff(c, body);
        });
      }
      /* Rupees in, paise out. A price that is not plainly a number is refused here, never guessed at. */
      function toPaise(v) { var t = String(v || "").trim(); return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null; }

      document.getElementById("admTrfAdd").onclick = function () {
        var name = document.getElementById("admTrfName").value.trim();
        var price = toPaise(document.getElementById("admTrfPrice").value);
        if (!name) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.tariff.errName", "Give the item a name.")) + "</div>"; return; }
        if (price === null) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.tariff.errPrice", "The price has to be a plain amount in rupees, like 450 or 450.50.")) + "</div>"; return; }
        save({ name: name, code: document.getElementById("admTrfCode").value.trim(), kind: document.getElementById("admTrfKind").value, ward: document.getElementById("admTrfWard").value, price: price });
      };
      body.querySelectorAll("[data-trf-edit]").forEach(function (b) {
        b.onclick = function () {
          var t = items.filter(function (x) { return x.id === b.getAttribute("data-trf-edit"); })[0]; if (!t) return;
          var v = prompt(T(c, "site.admin.tariff.newPricePrompt", "New price for {name} in rupees (now {price})", { name: t.name, price: rupees(t.price) })); if (v == null) return;
          var price = toPaise(v);
          if (price === null) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.tariff.errPrice2", "The price has to be a plain amount in rupees.")) + "</div>"; return; }
          save({ id: t.id, name: t.name, code: t.code, kind: t.kind, ward: t.ward || "", price: price });
        };
      });
      body.querySelectorAll("[data-trf-off]").forEach(function (b) {
        b.onclick = function () {
          var t = items.filter(function (x) { return x.id === b.getAttribute("data-trf-off"); })[0]; if (!t) return;
          if (!confirm(T(c, "site.admin.tariff.withdrawConfirm", "Withdraw {name} from the price list? Old bills keep it.", { name: t.name }))) return;
          save({ id: t.id, name: t.name, code: t.code, kind: t.kind, ward: t.ward || "", price: t.price, active: false });
        };
      });
    });
  }

  // ---- Departments ------------------------------------------------------------------------------
  function renderDepts(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      /* A failed load is not "no departments" - said plainly, and the list is not drawn. */
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.depts.loadFailed", "The departments could not be loaded. Do not read this as none set up.")) + "</div>"; return; }
      var depts = r.departments || [];
      if (c.state.org) c.state.org._departments = depts;
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.depts.title", "Departments")) + "</h2>" +
        (depts.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.depts.name", "Name")) + "</th><th>" + c.esc(T(c, "site.admin.depts.code", "Code")) + "</th><th>" + c.esc(T(c, "site.admin.depts.type", "Type")) + "</th><th>" + c.esc(T(c, "site.admin.depts.active", "Active")) + "</th></tr></thead><tbody>" +
          depts.map(function (d) { return "<tr><td>" + c.esc(d.name) + "</td><td>" + c.esc(d.code) + "</td><td>" + c.esc(d.type) + "</td><td>" + c.esc(d.active ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.depts.none", "No departments yet.")) + "</p>") +
        '<h3>' + c.esc(T(c, "site.admin.depts.addTitle", "Add a department")) + '</h3><div class="row">' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.depts.name", "Name")) + '</span><input id="admDeptName"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.depts.code", "Code")) + '</span><input id="admDeptCode"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.depts.type", "Type")) + '</span><input id="admDeptType" placeholder="general"></label>' +
        '<button class="btn" id="admDeptAdd" type="button">' + c.ms("add") + c.esc(T(c, "site.admin.add", "Add")) + "</button></div><div id=\"admDeptMsg\"></div></div>";
      document.getElementById("admDeptAdd").onclick = function () {
        var name = (document.getElementById("admDeptName").value || "").trim();
        if (!name) { document.getElementById("admDeptMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.depts.errName", "Give the department a name.")) + "</div>"; return; }
        c.api("/dept", { orgId: c.state.orgId, name: name, code: document.getElementById("admDeptCode").value, type: document.getElementById("admDeptType").value }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admDeptMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.depts.added", "Department added.")); WSQ.render("admin");
        });
      };
    });
  }

  // ---- Wards and beds ---------------------------------------------------------------------------
  // Element ids are a contract the browser acceptance journey (test/run-wardsynq-com-journey.mjs)
  // drives directly: #admWardName, #admWardCode, #admWardAdd, each ward row data-ward-id="<id>",
  // #admBedWard (options = ward ids), #admBedLabel, #admBedAdd, each bed row data-bed-id="<id>".
  function renderWards(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/wards?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.wards.title", "Wards")) + '</h2><div class="msg err">' + c.esc(T(c, "site.admin.wards.loadFailed", "Wards could not be loaded. Do not read this as no wards.")) + " " + EN(c, c.esc(refusal(c, r))) + "</div></div>"; return; }
      var wards = r.wards || [];
      var wardOpts = wards.map(function (w) { return '<option value="' + c.esc(w.id) + '">' + c.esc(w.name) + "</option>"; }).join("");
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.wards.title", "Wards")) + "</h2>" +
        (wards.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.wards.name", "Name")) + "</th><th>" + c.esc(T(c, "site.admin.wards.code", "Code")) + "</th><th>" + c.esc(T(c, "site.admin.wards.type", "Type")) + "</th><th>" + c.esc(T(c, "site.admin.wards.active", "Active")) + "</th><th></th></tr></thead><tbody>" +
          wards.map(function (w) { return '<tr data-ward-id="' + c.esc(w.id) + '"><td>' + c.esc(w.name) + "</td><td>" + c.esc(w.code) + "</td><td>" + c.esc(w.type) + "</td><td>" + c.esc(w.active ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td>" +
            '<td><button class="btn ghost sm" type="button" data-ward-rename="' + c.esc(w.id) + '" data-ward-name="' + c.esc(w.name) + '">' + c.esc(T(c, "site.admin.wards.rename", "Rename")) + '</button> ' +
            '<button class="btn ghost sm" type="button" data-ward-active="' + c.esc(w.id) + '" data-to="' + (w.active ? "0" : "1") + '">' + c.esc(w.active ? T(c, "site.admin.wards.deactivate", "Deactivate") : T(c, "site.admin.wards.reactivate", "Reactivate")) + "</button></td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.wards.none", "No wards yet.")) + "</p>") +
        '<h3>' + c.esc(T(c, "site.admin.wards.addTitle", "Add a ward")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.wards.name", "Name")) + '</span><input id="admWardName"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.wards.code", "Code")) + '</span><input id="admWardCode"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.wards.type", "Type")) + '</span><input id="admWardType" placeholder="general"></label>' +
        '<button class="btn" id="admWardAdd" type="button">' + c.ms("add") + c.esc(T(c, "site.admin.add", "Add")) + "</button></div><div id=\"admWardMsg\"></div></div>" +
        '<div class="card" id="admBedsCard">' + (wards.length ?
          '<h2>' + c.esc(T(c, "site.admin.wards.bedsTitle", "Beds")) + '</h2><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.wards.ward", "Ward")) + '</span><select id="admBedWard">' + wardOpts + "</select></label></div>" +
          '<div id="admBedsList"><span class="spin"></span></div>' +
          '<h3>' + c.esc(T(c, "site.admin.wards.addBed", "Add a bed")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.wards.name", "Name")) + '</span><input id="admBedLabel"></label>' +
          '<button class="btn" id="admBedAdd" type="button">' + c.ms("add") + c.esc(T(c, "site.admin.add", "Add")) + "</button></div><div id=\"admBedMsg\"></div>"
          : '<p class="quiet">' + c.esc(T(c, "site.admin.wards.addWardFirst", "Add a ward, then its beds.")) + "</p>") + "</div>";
      var wardUpdate = function (patch, done) {
        c.api("/ward/update", Object.assign({ orgId: c.state.orgId }, patch)).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          c.toast(done); WSQ.render("admin");
        });
      };
      body.querySelectorAll("[data-ward-rename]").forEach(function (b) {
        b.onclick = function () {
          var name = (window.prompt(T(c, "site.admin.wards.renamePrompt", "New name for this ward"), b.getAttribute("data-ward-name")) || "").trim();
          if (name) wardUpdate({ wardId: b.getAttribute("data-ward-rename"), name: name }, T(c, "site.admin.wards.renamed", "Ward renamed."));
        };
      });
      body.querySelectorAll("[data-ward-active]").forEach(function (b) {
        b.onclick = function () {
          var on = b.getAttribute("data-to") === "1";
          if (!on && !window.confirm(T(c, "site.admin.wards.deactivateConfirm", "Deactivate this ward? Nothing already recorded changes, and it can be reactivated."))) return;
          wardUpdate({ wardId: b.getAttribute("data-ward-active"), active: on }, on ? T(c, "site.admin.wards.reactivated", "Ward reactivated.") : T(c, "site.admin.wards.deactivated", "Ward deactivated."));
        };
      });
      document.getElementById("admWardAdd").onclick = function () {
        var name = (document.getElementById("admWardName").value || "").trim();
        if (!name) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.wards.errName", "Give the ward a name.")) + "</div>"; return; }
        c.api("/ward", { orgId: c.state.orgId, name: name, code: document.getElementById("admWardCode").value, type: document.getElementById("admWardType").value }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.wards.added", "Ward added.")); WSQ.render("admin");
        });
      };
      if (!wards.length) return;
      var sel = document.getElementById("admBedWard");
      sel.value = (c.state._admWard && wards.some(function (w) { return w.id === c.state._admWard; })) ? c.state._admWard : wards[0].id;
      sel.onchange = function () { c.state._admWard = sel.value; loadBeds(); };
      function loadBeds() {
        var list = document.getElementById("admBedsList"), wid = sel.value;
        list.innerHTML = '<span class="spin"></span>';
        c.api("/beds?orgId=" + encodeURIComponent(c.state.orgId) + "&wardId=" + encodeURIComponent(wid)).then(function (br) {
          if (!br || !br.ok) { list.innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.wards.bedsLoadFailed", "Beds could not be loaded. Do not read this as no beds.")) + " " + EN(c, c.esc(refusal(c, br))) + "</div>"; return; }
          var beds = br.beds || [];
          /* BUG-MU072XAL-4EHO: a bed is taken out of use by retiring it (kept, with its history), never deleted;
           * the server refuses to retire a bed with a patient in it. */
          list.innerHTML = beds.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.wards.name", "Name")) + "</th><th>" + c.esc(T(c, "site.admin.wards.bedState", "State")) + "</th><th>" + c.esc(T(c, "site.admin.wards.isolation", "Isolation")) + "</th><th>" + c.esc(T(c, "site.admin.wards.inUse", "In use")) + "</th><th></th></tr></thead><tbody>" +
            beds.map(function (bd) {
              var pillCls = bd.state === "available" ? " ok" : (bd.state === "blocked" || bd.state === "maintenance") ? " stop" : "";
              return '<tr data-bed-id="' + c.esc(bd.id) + '"><td>' + c.esc(bd.name) + '</td><td><span class="pill' + pillCls + '">' + c.esc(bedStateLabel(c, bd.state)) + "</span></td><td>" + c.esc(bd.isolation ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td><td>" + c.esc(bd.active ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.wards.retiredState", "retired")) + "</td><td>" +
                BED_STATES.filter(function (s) { return s !== bd.state; }).map(function (s) {
                  return '<button type="button" class="btn quiet" data-bed="' + c.esc(bd.id) + '" data-state="' + s + '">' + c.esc(bedStateLabel(c, s)) + "</button>";
                }).join(" ") +
                ' <button type="button" class="btn ghost sm" data-bed-active="' + c.esc(bd.id) + '" data-to="' + (bd.active ? "0" : "1") + '">' + c.esc(bd.active ? T(c, "site.admin.wards.retire", "Retire") : T(c, "site.admin.wards.bringBack", "Bring back into use")) + "</button></td></tr>";
            }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.wards.noBeds", "No beds in this ward yet.")) + "</p>";
          list.querySelectorAll("[data-bed-active]").forEach(function (b) {
            b.onclick = function () {
              var on = b.getAttribute("data-to") === "1";
              if (!on && !window.confirm(T(c, "site.admin.wards.retireConfirm", "Retire this bed? It stays on record but can no longer be admitted into."))) return;
              c.api("/bed/update", { orgId: c.state.orgId, bedId: b.getAttribute("data-bed-active"), active: on }).then(function (r) {
                if (!r || !r.ok) { list.innerHTML += '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; if (r && r.error === "bed_changed") loadBeds(); return; }
                c.toast(on ? T(c, "site.admin.wards.bedInUse", "Bed back in use.") : T(c, "site.admin.wards.bedRetired", "Bed retired.")); loadBeds();
              });
            };
          });
          list.querySelectorAll("[data-bed]").forEach(function (b) {
            b.onclick = function () {
              c.api("/bed/update", { orgId: c.state.orgId, bedId: b.getAttribute("data-bed"), state: b.getAttribute("data-state") }).then(function (r) {
                if (!r || !r.ok) { list.innerHTML += '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; if (r && r.error === "bed_changed") loadBeds(); return; }
                c.toast(T(c, "site.admin.wards.bedUpdated", "Bed updated.")); loadBeds();
              });
            };
          });
        });
      }
      document.getElementById("admBedAdd").onclick = function () {
        var name = (document.getElementById("admBedLabel").value || "").trim();
        if (!name) { document.getElementById("admBedMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.wards.errBedName", "Give the bed a name.")) + "</div>"; return; }
        // The server's bed() factory field is "name" (see functions/_opd_org.js / _opd_org_store.js
        // createBed) even though the on-screen input is #admBedLabel per the journey's id contract.
        c.api("/bed", { orgId: c.state.orgId, wardId: sel.value, name: name }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admBedMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.wards.bedAdded", "Bed added.")); document.getElementById("admBedLabel").value = ""; loadBeds();
        });
      };
      loadBeds();
    });
  }

  // ---- Rooms (OPD consulting rooms) --------------------------------------------------------------
  function renderRooms(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    /* D7: a room belongs to a department (or none). A patient registered into the room is numbered in that
     * department when each department numbers separately, and the waiting hall shows the room under it. */
    return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.rooms.title", "Rooms")) + '</h2><div class="msg err">' + c.esc(T(c, "site.admin.rooms.loadFailed", "Rooms could not be loaded. Do not read this as no rooms.")) + " " + EN(c, c.esc(refusal(c, r))) + "</div></div>"; return; }
      var rooms = r.rooms || [], depts = (r.departments || []).filter(function (d) { return d.active !== false; });
      var deptSel = function (cls, cur, attr) {
        return '<select class="' + cls + '"' + (attr || "") + '><option value="">' + c.esc(T(c, "site.admin.rooms.noDept", "No department")) + '</option>' + depts.map(function (d) {
          return '<option value="' + c.esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + c.esc(d.name) + "</option>";
        }).join("") + "</select>";
      };
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.rooms.title", "Rooms")) + "</h2>" +
        (rooms.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.rooms.name", "Name")) + "</th><th>" + c.esc(T(c, "site.admin.rooms.number", "Number")) + "</th><th>" + c.esc(T(c, "site.admin.rooms.dept", "Department")) + "</th><th>" + c.esc(T(c, "site.admin.rooms.assignment", "Assignment")) + "</th><th>" + c.esc(T(c, "site.admin.rooms.active", "Active")) + "</th></tr></thead><tbody>" +
          rooms.map(function (rm) { return "<tr><td>" + c.esc(rm.name) + "</td><td>" + c.esc(rm.number) + "</td><td>" + deptSel("admRoomDept", rm.departmentId || "", ' data-room="' + c.esc(rm.id) + '"') + "</td><td>" + c.esc((rm.assignment && rm.assignment.mode) || "") + "</td><td>" + c.esc(rm.active ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.rooms.none", "No consulting rooms yet.")) + "</p>") +
        '<h3>' + c.esc(T(c, "site.admin.rooms.addTitle", "Add a room")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.rooms.name", "Name")) + '</span><input id="admRoomName"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.rooms.dept", "Department")) + '</span>' + deptSel("", "", ' id="admRoomNewDept"') + "</label>" +
        '<button class="btn" id="admRoomAdd" type="button">' + c.ms("add") + c.esc(T(c, "site.admin.add", "Add")) + "</button></div><div id=\"admRoomMsg\"></div></div>";
      body.querySelectorAll(".admRoomDept").forEach(function (sel) {
        sel.onchange = function () {
          sel.disabled = true;
          c.api("/room/update", { orgId: c.state.orgId, roomId: sel.getAttribute("data-room"), departmentId: sel.value || null }).then(function (x) {
            sel.disabled = false;
            if (!x || !x.ok) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.rooms.notSavedLead", "The department was not saved:")) + " " + EN(c, c.esc(refusal(c, x))) + "</div>"; WSQ.render("admin"); return; }
            c.toast(x.room && x.room.department ? T(c, "site.admin.rooms.savedWith", "Room department saved: {dept}.", { dept: x.room.department }) : T(c, "site.admin.rooms.savedNone", "Room department saved: none."));
          });
        };
      });
      document.getElementById("admRoomAdd").onclick = function () {
        var name = (document.getElementById("admRoomName").value || "").trim();
        if (!name) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.rooms.errName", "Give the room a name.")) + "</div>"; return; }
        c.api("/room", { orgId: c.state.orgId, name: name, departmentId: document.getElementById("admRoomNewDept").value || null }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.rooms.added", "Room added.")); WSQ.render("admin");
        });
      };
    });
  }

  // ---- Staff and roles ----------------------------------------------------------------------------
  /* REQUIRE TWO-STEP SIGN-IN, per role. The server enforces it on every request; this card only sets it.
   * Staff of a ticked role who have not set it up can still sign in, but can do nothing except set it up. */
  function twoStepPolicyCard(c) {
    var on = ((c.state.org && c.state.org.security && c.state.org.security.requireTwoStepRoles) || []);
    return '<div class="card"><h2>' + c.esc(T(c, "site.admin.staff.twoStep.title", "Require two-step sign-in")) + "</h2>" +
      '<p class="quiet">' + c.esc(T(c, "site.admin.staff.twoStep.intro", "Staff in a ticked role must use a code from an authenticator app when they sign in. Anyone in that role who has not set it up yet can sign in, but can only reach the set-up page until they do. A lost phone is fixed with Reset access.")) + "</p>" +
      '<div class="row">' + ROLES.map(function (r) {
        return '<label class="f" style="flex:0 1 170px"><span><input type="checkbox" class="admTwoStepRole" value="' + c.esc(r) + '"' + (on.indexOf(r) >= 0 ? " checked" : "") + "> " + c.esc(r.replace(/_/g, " ")) + "</span></label>";
      }).join("") + "</div>" +
      '<button class="btn" id="admTwoStepSave" type="button">' + c.esc(T(c, "site.admin.save", "Save")) + '</button><div id="admTwoStepMsg"></div></div>';
  }
  function wireTwoStepPolicy(c) {
    var btn = document.getElementById("admTwoStepSave"); if (!btn) return;
    btn.onclick = function () {
      var picked = [];
      document.querySelectorAll(".admTwoStepRole").forEach(function (b) { if (b.checked) picked.push(b.value); });
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, security: { requireTwoStepRoles: picked } }).then(function (r) {
        btn.disabled = false;
        var m = document.getElementById("admTwoStepMsg");
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
        c.state.org = r.org;
        var saved = (r.org && r.org.security && r.org.security.requireTwoStepRoles) || [];
        m.innerHTML = '<div class="msg ok">' + (saved.length ? c.esc(T(c, "site.admin.staff.twoStep.savedLead", "Saved. Required for:")) + " " + EN(c, c.esc(saved.join(", "))) + "." : c.esc(T(c, "site.admin.staff.twoStep.savedNone", "Saved. Two-step sign-in is optional for everyone."))) + "</div>";
      });
    };
  }
  function renderStaff(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/members?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var members = (r && r.ok && r.members) || [];
      var roleOpts = ROLES.map(function (rn) { return '<option value="' + rn + '">' + rn + "</option>"; }).join("");
      body.innerHTML =
        '<div class="card"><h2>' + c.esc(T(c, "site.admin.staff.whatEachCredential", "What each credential lets a person do")) + "</h2>" +
        roleNoteRows(c).map(function (l) { return '<p class="quiet"><b>' + c.esc(l[0]) + ":</b> " + c.esc(l[1]) + "</p>"; }).join("") + "</div>" +
        twoStepPolicyCard(c) +
        '<div class="card"><h2>' + c.esc(T(c, "site.admin.staff.title", "Staff")) + "</h2>" +
        (members.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.staff.identity", "Identity")) + "</th><th>" + c.esc(T(c, "site.admin.staff.nameCol", "Name (employee ID)")) + "</th><th>" + c.esc(T(c, "site.admin.staff.role", "Role")) + "</th><th>" + c.esc(T(c, "site.admin.staff.active", "Active")) + "</th><th>" + c.esc(T(c, "site.admin.staff.email", "Email")) + "</th><th>" + c.esc(T(c, "site.admin.staff.pinSet", "PIN set")) + "</th><th>" + c.esc(T(c, "site.admin.staff.alertMobile", "Alert mobile")) + "</th><th></th></tr></thead><tbody>" +
          members.map(function (m) {
            return '<tr data-identity="' + c.esc(m.identity) + '"><td>' + c.esc(m.identity) + "</td><td>" + (m.displayName ? EN(c, c.esc(m.displayName)) : c.esc(T(c, "site.admin.staff.nameNotSet", "Name not set"))) + (m.employeeId ? " (" + EN(c, c.esc(m.employeeId)) + ")" : "") + "</td><td>" + c.esc(m.role) + "</td><td>" + c.esc(m.active ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td><td>" + c.esc(m.email || T(c, "site.admin.staff.noneEmail", "none")) + "</td><td>" + c.esc(m.hasPin ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</td><td>" + c.esc(m.alertMobile ? T(c, "site.admin.staff.mobileSet", "set") : T(c, "site.admin.staff.noneEmail", "none")) + "</td><td>" +
              '<button type="button" class="btn quiet" data-mact="' + (m.active ? "disable" : "restore") + '" data-id="' + c.esc(m.identity) + '">' + c.esc(m.active ? T(c, "site.admin.staff.disable", "Disable") : T(c, "site.admin.staff.restore", "Restore")) + "</button> " +
              '<button type="button" class="btn quiet" data-mact="reset" data-id="' + c.esc(m.identity) + '">' + c.esc(T(c, "site.admin.staff.resetAccess", "Reset access")) + "</button></td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.admin.staff.none", "No staff added yet.")) + "</p>") +
        "</div>" +
        '<div class="card"><h2>' + c.esc(T(c, "site.admin.staff.addTitle", "Add or update a staff member")) + '</h2><p class="quiet">' + c.esc(T(c, "site.admin.staff.hospitalCode", "Hospital code for sign-in:")) + ' <span class="mono">' + c.esc((c.state.org && c.state.org.code) || "") + "</span></p>" +
        '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.staff.identityLabel", "Identity (staff ID or email)")) + '</span><input id="admMemberIdentity"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.role", "Role")) + '</span><select id="admMemberRole">' + roleOpts + "</select></label>" +
        /* Owner 2026-09-16: the name and employee ID the ward shows beside everything this person records on a chart. */
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.nameLabel", "Name as the ward reads it")) + '</span><input id="admMemberName" autocomplete="off" placeholder="' + c.esc(T(c, "site.admin.staff.blankKeeps", "blank keeps what is saved")) + '"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.employeeId", "Employee ID")) + '</span><input id="admMemberEmpId" autocomplete="off" placeholder="' + c.esc(T(c, "site.admin.staff.blankKeeps", "blank keeps what is saved")) + '"></label>' +
        /* The hospital vouching that this person is a registered practitioner. Without it a doctor
         * who signs in as hospital staff can write the chart and cannot SIGN anything - no
         * prescription, no note, no discharge summary - because the only other source of a signing
         * credential is a StewardMD account's verified claim. Every signed record records which of
         * the two vouched, so this is an assertion the hospital makes and is accountable for. */
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.regNo", "Registration number (prescribers)")) + '</span><input id="admMemberRegNo" placeholder="' + c.esc(T(c, "site.admin.staff.regNoPlaceholder", "leave blank if not a prescriber")) + '"></label>' +
        // S3 P0: where a critical-result SMS goes when no phone confirmed the push. Blank keeps what is saved.
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.alertMobileLabel", "Alert mobile (critical-result SMS)")) + '</span><input id="admMemberMobile" inputmode="tel" placeholder="' + c.esc(T(c, "site.admin.staff.mobilePlaceholder", "blank keeps the saved number")) + '"></label>' +
        '<button class="btn" id="admMemberAdd" type="button">' + c.esc(T(c, "site.admin.staff.saveMembership", "Save membership")) + '</button></div><div id="admMemMsg"></div>' +
        '<p class="quiet">' + c.esc(T(c, "site.admin.staff.regNoNote", "A member with no registration number can use WardSynQ but cannot sign a prescription, a note or a discharge summary. The hospital is asserting this number; a StewardMD account that is already verified uses its own instead.")) + "</p>" +
        '<h3>' + c.esc(T(c, "site.admin.staff.setPin", "Set PIN")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.staff.identity", "Identity")) + '</span><input id="admPinId"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.pin", "PIN")) + '</span><input id="admPinVal" type="password"></label>' +
        '<button class="btn quiet" id="admPinSave" type="button">' + c.esc(T(c, "site.admin.staff.setPin", "Set PIN")) + '</button></div><div id="admPinMsg"></div>' +
        '<h3>' + c.esc(T(c, "site.admin.staff.setEmailPassword", "Set email + password")) + '</h3><div class="row"><label class="f"><span>' + c.esc(T(c, "site.admin.staff.identity", "Identity")) + '</span><input id="admPwId"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.email", "Email")) + '</span><input id="admPwEmail" type="email"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.staff.password", "Password")) + '</span><input id="admPwVal" type="password"></label>' +
        '<button class="btn quiet" id="admPwSave" type="button">' + c.esc(T(c, "site.admin.staff.setPassword", "Set password")) + '</button></div><div id="admPwMsg"></div>' +
        "</div>";
      wireTwoStepPolicy(c);
      body.querySelectorAll("[data-mact]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-mact"), id = b.getAttribute("data-id");
          if (!MEMBER_ACTION_ROUTE[act]) return;
          c.api("/member/" + MEMBER_ACTION_ROUTE[act], { orgId: c.state.orgId, identity: id }).then(function (r) {
            if (!r || !r.ok) { c.toast(refusal(c, r)); return; }
            c.toast(T(c, "site.admin.staff.updated", "Updated.")); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admMemberAdd").onclick = function () {
        var id = (document.getElementById("admMemberIdentity").value || "").trim();
        if (!id) { document.getElementById("admMemMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.staff.errIdentity", "Enter the staff ID or email.")) + "</div>"; return; }
        var memberBody = { orgId: c.state.orgId, identity: id, role: document.getElementById("admMemberRole").value, regNo: (document.getElementById("admMemberRegNo").value || "").trim() };
        var mobile = (document.getElementById("admMemberMobile").value || "").trim();
        if (mobile) memberBody.alertMobile = mobile;
        var dname = (document.getElementById("admMemberName").value || "").trim(), empId = (document.getElementById("admMemberEmpId").value || "").trim();
        if (dname) memberBody.displayName = dname;
        if (empId) memberBody.employeeId = empId;
        c.api("/member", memberBody).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admMemMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.staff.saved", "Staff saved.")); WSQ.render("admin");
        });
      };
      document.getElementById("admPinSave").onclick = function () {
        var id = (document.getElementById("admPinId").value || "").trim(), pin = document.getElementById("admPinVal").value;
        if (!id || !pin) { document.getElementById("admPinMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.staff.errPin", "Enter the identity and a PIN.")) + "</div>"; return; }
        c.api("/member/pin", { orgId: c.state.orgId, identity: id, pin: pin }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admPinMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.staff.pinSetToast", "PIN set.")); document.getElementById("admPinVal").value = "";
        });
      };
      document.getElementById("admPwSave").onclick = function () {
        var id = (document.getElementById("admPwId").value || "").trim(), email = document.getElementById("admPwEmail").value, pw = document.getElementById("admPwVal").value;
        if (!id || !email || !pw) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.staff.errPassword", "Enter identity, email and password.")) + "</div>"; return; }
        c.api("/member/password", { orgId: c.state.orgId, identity: id, email: email, password: pw }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
          c.toast(T(c, "site.admin.staff.passwordSetToast", "Password set.")); document.getElementById("admPwVal").value = "";
        });
      };
    });
  }
  // ---- Hospital group (P2.14) ------------------------------------------------------------------
  /* Two halves on one tab, because the same person is often on both sides. THIS HOSPITAL'S SIDE:
   * invitations to accept or decline (only the owner can; the server says so to anyone else), groups
   * it belongs to, leaving, and adopting a group's recommended settings as a copy. GROUPS YOU RUN:
   * create, invite by hospital id or code, remove, publish recommended settings, open the overview.
   * A group sees counts only, never a patient. An invitation alone does not make a hospital a member. */
  // The only actions each half sends to /group/<action>; anything else sends nothing.
  var GROUP_SIDE_ROUTE = { accept: "accept", decline: "decline", remove: "remove", adopt: "adopt" };
  var GROUP_RUN_ROUTE = { invite: "invite", remove: "remove", policy: "policy", adminAdd: "admin-add", adminRemove: "admin-remove", staleAfter: "stale-after" };
  function groupSideHtml(c, r) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.group.side.title", "This hospital's groups")) + "</h2>";
    if (r == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.group.loading", "Loading...")) + "</div>";
    if (r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.group.loadFailedLead", "Could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.group.side.loadFailedTrail", "Do not read this as no groups or invitations.")) + "</div></div>";
    if (!r.groups.length) return h + '<p class="quiet">' + esc(T(c, "site.admin.group.side.none", "This hospital is not in a hospital group and has no invitations.")) + "</p></div>";
    /* D4 B: groups read what this hospital PUBLISHES, not its live record. Say what was last published, by whom
     * and when, and offer to publish now. A snapshot that could not be read is said, never shown as none. */
    var s = r.snapshot, when = function (ms) { return new Date(ms).toLocaleString(); };
    var member = r.groups.some(function (g) { return g.state === "member"; });
    var pub = !member ? "" : '<h3>' + esc(T(c, "site.admin.group.side.publishedTitle", "Counts published to groups")) + '</h3>' +
      (s === false ? '<div class="msg err">' + esc(T(c, "site.admin.group.side.snapshotFailed", "What this hospital last published could not be read.")) + '</div>'
        : s ? "<p>" + esc(T(c, "site.admin.group.side.lastPublished", "Last published {when} by {by}.", { when: when(s.publishedAt), by: s.publishedBy || T(c, "site.admin.group.side.unknown", "unknown") })) + "</p>"
        : '<p class="quiet">' + esc(T(c, "site.admin.group.side.notPublished", "Not published yet: groups see this hospital as \"not published\".")) + "</p>") +
      '<p><button type="button" class="btn" data-grp-publish="1">' + esc(T(c, "site.admin.group.side.publishNow", "Publish counts now")) + '</button> <span class="quiet">' + esc(T(c, "site.admin.group.side.publishNowNote", "Groups see the counts as they are at this moment, with this time on them.")) + "</span></p>";
    return h + '<p class="quiet">' + esc(T(c, "site.admin.group.side.intro", "A group sees the counts this hospital publishes (census, free beds, ED waiting, open critical results, staff short). It never sees a patient. Leaving takes effect at once.")) + "</p>" + pub +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.group.side.colGroup", "Group")) + "</th><th>" + esc(T(c, "site.admin.group.side.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.admin.group.side.colPolicy", "Recommended settings")) + "</th><th></th></tr></thead><tbody>" +
      r.groups.map(function (g) {
        var id = esc(g.groupId);
        var pol = g.policy ? Object.keys(g.policy) : [];
        return "<tr><td>" + esc(g.name || g.groupId) + "</td><td>" + (g.state === "member" ? '<span class="pill ok">' + esc(T(c, "site.admin.group.side.member", "member")) + "</span>" : '<span class="pill warn">' + esc(T(c, "site.admin.group.side.invitedNotMember", "invited, not a member yet")) + "</span>") + "</td><td>" +
          (g.state !== "member" ? "" : pol.length ? EN(c, esc(pol.join(", "))) + " " + esc(T(c, "site.admin.group.side.version", "(version {v})", { v: g.policyVersion })) : '<span class="quiet">' + esc(T(c, "site.admin.group.side.nonePublished", "none published")) + "</span>") + "</td><td>" +
          (g.state === "invited"
            ? '<button type="button" class="btn" data-grp-side="accept" data-grp="' + id + '">' + esc(T(c, "site.admin.group.side.accept", "Accept")) + '</button> <button type="button" class="btn ghost" data-grp-side="decline" data-grp="' + id + '">' + esc(T(c, "site.admin.group.side.decline", "Decline")) + '</button>'
            : (pol.length ? '<button type="button" class="btn" data-grp-side="adopt" data-grp="' + id + '">' + esc(T(c, "site.admin.group.side.adopt", "Adopt recommended settings")) + '</button> ' : "") +
              '<button type="button" class="btn ghost" data-grp-side="remove" data-grp="' + id + '">' + esc(T(c, "site.admin.group.side.leave", "Leave group")) + '</button>') + "</td></tr>";
      }).join("") + '</tbody></table></div><div id="grpSideMsg"></div></div>';
  }
  function groupRunHtml(c, r) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.group.run.title", "Hospital groups you run")) + "</h2>";
    if (r == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.group.loading", "Loading...")) + "</div>";
    if (r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.group.loadFailedLead", "Could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ".</div></div>";
    h += r.groups.length ? r.groups.map(function (g) {
      var id = esc(g.id);
      /* Who runs this group beside you. The server names opaque account ids, not emails, so they
       * read as-is; removing is per admin, and the last one has no button because the server
       * refuses to leave a group with nobody able to run it. */
      var admins = Array.isArray(g.adminUids) ? g.adminUids : [];
      var adminHtml = "<p>" + esc(T(c, "site.admin.group.run.admins", "Administrators:")) + "</p><ul>" + admins.map(function (u) {
        return '<li><span class="mono">' + esc(u) + "</span>" + (admins.length > 1 ?
          ' <button type="button" class="btn quiet" data-grp-run="adminRemove" data-grp="' + id + '" data-uid="' + esc(u) + '">' + esc(T(c, "site.admin.group.run.remove", "Remove")) + '</button>' : "") + "</li>";
      }).join("") + "</ul>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.group.run.addAdmin", "Add administrator (their StewardMD account email)")) + '</span><input type="email" data-grp-adminadd-input="' + id + '"></label>' +
        '<button type="button" class="btn" data-grp-run="adminAdd" data-grp="' + id + '">' + esc(T(c, "site.admin.group.run.addAdminBtn", "Add administrator")) + '</button></div>';
      return "<h3>" + esc(g.name) + "</h3>" +
        '<p><button type="button" class="btn ghost" data-go="group/' + id + '">' + esc(T(c, "site.admin.group.run.openOverview", "Open group overview")) + '</button></p>' +
        adminHtml +
        (g.members.length ? "<p>" + esc(T(c, "site.admin.group.run.members", "Members:")) + "</p><ul>" + g.members.map(function (m) {
          return "<li>" + esc(m.name || m.orgId) + ' <span class="mono">' + esc(m.orgId) + '</span> <button type="button" class="btn quiet" data-grp-run="remove" data-grp="' + id + '" data-org="' + esc(m.orgId) + '">' + esc(T(c, "site.admin.group.run.remove", "Remove")) + '</button></li>';
        }).join("") + "</ul>" : '<p class="quiet">' + esc(T(c, "site.admin.group.run.noMembers", "No member hospitals yet.")) + "</p>") +
        (g.invited.length ? "<p>" + String(T(c, "site.admin.group.run.invitedWaiting", "Invited, waiting for the hospital's owner to accept:")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</p><ul>" + g.invited.map(function (m) {
          return '<li><span class="mono">' + esc(m.orgId) + '</span> <button type="button" class="btn quiet" data-grp-run="remove" data-grp="' + id + '" data-org="' + esc(m.orgId) + '">' + esc(T(c, "site.admin.group.run.withdraw", "Withdraw invitation")) + '</button></li>';
        }).join("") + "</ul>" : "") +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.group.run.inviteLabel", "Invite a hospital (id or SMD code)")) + '</span><input data-grp-invite-input="' + id + '"></label>' +
        '<button type="button" class="btn" data-grp-run="invite" data-grp="' + id + '">' + esc(T(c, "site.admin.group.run.invite", "Invite")) + '</button></div>' +
        '<label class="f"><span>' + esc(T(c, "site.admin.group.run.policyLabel", "Recommended settings (JSON, version {v})", { v: g.policyVersion })) + '</span><textarea rows="5" style="width:100%;font-family:monospace" data-grp-policy-input="' + id + '">' + esc(g.policy ? JSON.stringify(g.policy, null, 2) : "") + "</textarea></label>" +
        '<button type="button" class="btn ghost" data-grp-run="policy" data-grp="' + id + '">' + esc(T(c, "site.admin.group.run.publishPolicy", "Publish recommended settings")) + '</button>' +
        '<div class="row"><label class="f" style="flex:0 1 260px"><span>' + esc(T(c, "site.admin.group.run.staleAfter", "Mark a hospital's counts stale after (minutes)")) + '</span><input type="number" min="5" max="10080" data-grp-stale-input="' + id + '" value="' + esc(g.staleAfterMinutes || 60) + '"></label>' +
        '<button type="button" class="btn ghost" data-grp-run="staleAfter" data-grp="' + id + '">' + esc(T(c, "site.admin.save", "Save")) + '</button></div>' +
        '<p class="quiet">' + esc(T(c, "site.admin.group.run.adoptNote", "A member hospital's admin decides whether to adopt them. Nothing changes in any hospital until they do.")) + "</p>";
    }).join("") : '<p class="quiet">' + esc(T(c, "site.admin.group.run.none", "You do not run a hospital group.")) + "</p>";
    return h + '<h3>' + esc(T(c, "site.admin.group.run.createTitle", "Create a group")) + '</h3><div class="row"><label class="f"><span>' + esc(T(c, "site.admin.group.run.groupName", "Group name")) + '</span><input id="grpNewName"></label>' +
      '<button type="button" class="btn" id="grpCreate">' + esc(T(c, "site.admin.group.run.createBtn", "Create group")) + '</button></div><div id="grpRunMsg"></div></div>';
  }
  WSQ._groupAdmin = { side: groupSideHtml, run: groupRunHtml };

  function renderGroup(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = '<div id="grpSide">' + groupSideHtml(c, null) + '</div><div id="grpRun">' + groupRunHtml(c, null) + "</div>";
    var say = function (id, x) { var m = document.getElementById(id); if (m) m.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; };
    var sayT = function (id, msg) { var m = document.getElementById(id); if (m) m.innerHTML = '<div class="msg err">' + c.esc(msg) + "</div>"; };
    var side = c.api("/group/memberships" + q).then(function (r) {
      var box = document.getElementById("grpSide");
      box.innerHTML = groupSideHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) });
      var pb = box.querySelector("[data-grp-publish]");
      if (pb) pb.onclick = function () {
        pb.disabled = true;
        c.api("/group/publish-counts", { orgId: c.state.orgId }).then(function (x) {
          if (!x || !x.ok) { pb.disabled = false; say("grpSideMsg", x); return; }
          c.toast(T(c, "site.admin.group.side.published", "Counts published.")); WSQ.render("admin");
        });
      };
      box.querySelectorAll("[data-grp-side]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-grp-side"), gid = b.getAttribute("data-grp");
          if (!GROUP_SIDE_ROUTE[act]) return;
          if (act === "remove" && !window.confirm(T(c, "site.admin.group.side.leaveConfirm", "Leave this group? It stops seeing this hospital's counts at once."))) return;
          if (act === "adopt" && !window.confirm(T(c, "site.admin.group.side.adoptConfirm", "Copy the group's recommended settings into this hospital's own configuration? Settings of the same name are replaced; this is recorded in the audit trail."))) return;
          b.disabled = true;
          c.api("/group/" + GROUP_SIDE_ROUTE[act], { orgId: c.state.orgId, groupId: gid }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; say("grpSideMsg", x); return; }
            if (act === "adopt" && x.org) c.state.org = x.org;
            c.toast({
              accept: T(c, "site.admin.group.side.joined", "Joined the group."),
              decline: T(c, "site.admin.group.side.declined", "Invitation declined."),
              remove: T(c, "site.admin.group.side.left", "Left the group."),
              adopt: T(c, "site.admin.group.side.adopted", "Recommended settings copied into this hospital."),
            }[act]);
            WSQ.render("admin");
          });
        };
      });
    });
    var run = c.api("/group/my-groups").then(function (r) {
      var box = document.getElementById("grpRun");
      box.innerHTML = groupRunHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) });
      var create = document.getElementById("grpCreate");
      if (create) create.onclick = function () {
        var name = (document.getElementById("grpNewName").value || "").trim();
        if (!name) { sayT("grpRunMsg", T(c, "site.admin.group.run.errName", "Give the group a name.")); return; }
        create.disabled = true;
        c.api("/group/create", { name: name }).then(function (x) {
          if (!x || !x.ok) { create.disabled = false; say("grpRunMsg", x); return; }
          c.toast(T(c, "site.admin.group.run.created", "Group created.")); WSQ.render("admin");
        });
      };
      box.querySelectorAll("[data-grp-run]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-grp-run"), gid = b.getAttribute("data-grp"), payload = { groupId: gid };
          if (!GROUP_RUN_ROUTE[act]) return;
          if (act === "invite") {
            payload.orgId = (box.querySelector('[data-grp-invite-input="' + gid + '"]').value || "").trim();
            if (!payload.orgId) { sayT("grpRunMsg", T(c, "site.admin.group.run.errOrgId", "Enter the hospital's id or SMD code.")); return; }
          } else if (act === "remove") {
            payload.orgId = b.getAttribute("data-org");
            if (!window.confirm(T(c, "site.admin.group.run.removeConfirm", "Remove this hospital from the group?"))) return;
          } else if (act === "policy") {
            var raw = (box.querySelector('[data-grp-policy-input="' + gid + '"]').value || "").trim();
            try { payload.policy = raw ? JSON.parse(raw) : null; } catch (e) { sayT("grpRunMsg", T(c, "site.admin.group.run.errJson", "That is not valid JSON, so nothing was published.")); return; }
          } else if (act === "adminAdd") {
            payload.email = (box.querySelector('[data-grp-adminadd-input="' + gid + '"]').value || "").trim();
            if (!payload.email) { sayT("grpRunMsg", T(c, "site.admin.group.run.errEmail", "Enter the administrator's StewardMD account email.")); return; }
          } else if (act === "adminRemove") {
            payload.uid = b.getAttribute("data-uid");
            if (!window.confirm(T(c, "site.admin.group.run.removeAdminConfirm", "Remove this administrator from the group? They stop seeing it at once."))) return;
          } else if (act === "staleAfter") {
            payload.minutes = Number(box.querySelector('[data-grp-stale-input="' + gid + '"]').value);
          }
          b.disabled = true;
          c.api("/group/" + GROUP_RUN_ROUTE[act], payload).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; say("grpRunMsg", x); return; }
            c.toast({
              invite: T(c, "site.admin.group.run.invited", "Invitation sent. The hospital's owner must accept it."),
              remove: T(c, "site.admin.group.run.removed", "Removed."),
              policy: T(c, "site.admin.group.run.policyPublished", "Recommended settings published."),
              adminAdd: T(c, "site.admin.group.run.adminAdded", "Administrator added."),
              adminRemove: T(c, "site.admin.group.run.adminRemoved", "Administrator removed."),
              staleAfter: T(c, "site.admin.saved", "Saved."),
            }[act]);
            WSQ.render("admin");
          });
        };
      });
    });
    return Promise.all([side, run]);
  }

  // ---- MaiK clinical AI (WardSynQ hospitals only) --------------------------------------------------
  // Status shape comes verbatim from functions/_wardsynq/maik-gateway.js maikStatus(), wrapped in
  // {ok:true,...} by GET /ward/maik-status (functions/api/queue/[[path]].js). No key material is ever
  // in that response - do not render anything beyond credentialSource, which names the env binding,
  // not its value.
  function renderMaik(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/ward/maik-status?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
      // wardsynq.maik.phiApproved is a per-provider allowlist (see maik-gateway.js maikConfig), not a
      // plain flag. S7: Vertex AI is the one cloud provider with a patient-data agreement, so the cloud
      // switch approves "vertex" and nothing else; the gateway refuses PHI to AI Studio whatever is saved.
      var approved = Array.isArray(r.phiApproved) ? r.phiApproved : [];
      var cloudApproved = approved.indexOf("vertex") >= 0;
      var vx = (r.providers || []).filter(function (p) { return p.provider === "vertex"; })[0] || {};
      var localApproved = approved.indexOf("local-openai") >= 0;
      // The on-premises endpoint is configuration, not status, so it comes from the org document.
      var curMaik = ((c.state.org && c.state.org.wardsynq) || {}).maik || {};
      var localUrl = curMaik.localBaseUrl || "", localModel = curMaik.localModel || "";
      body.innerHTML = '<div class="card"><h2>' + c.esc(T(c, "site.admin.maik.title", "MaiK clinical AI")) + "</h2>" +
        '<div class="kv"><dt>' + c.esc(T(c, "site.admin.maik.enabled", "Enabled")) + "</dt><dd>" + c.esc(r.enabled ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</dd>" +
        "<dt>" + c.esc(T(c, "site.admin.maik.phiVertex", "Patient data approved for Vertex AI")) + "</dt><dd>" + c.esc(cloudApproved ? (vx.phiCapable ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.maik.approvedButCant", "approved, but this server cannot send patient data to Vertex yet")) : T(c, "site.admin.no", "no")) + "</dd>" +
        "<dt>" + c.esc(T(c, "site.admin.maik.allowlist", "Model allowlist")) + "</dt><dd>" + (Array.isArray(r.allow) && r.allow.length ? EN(c, c.esc(r.allow.join(", "))) : c.esc(T(c, "site.admin.maik.allowlistDefault", "none (registry default)"))) + "</dd>" +
        "<dt>" + c.esc(T(c, "site.admin.maik.timeout", "Timeout")) + "</dt><dd>" + c.esc(T(c, "site.admin.maik.timeoutMs", "{n} ms", { n: r.timeoutMs || "" })) + "</dd></div>" +
        '<h3>' + c.esc(T(c, "site.admin.maik.providers", "Providers")) + '</h3><div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.admin.maik.colProvider", "Provider")) + "</th><th>" + c.esc(T(c, "site.admin.maik.colConfigured", "Configured")) + "</th><th>" + c.esc(T(c, "site.admin.maik.colDetail", "Detail")) + "</th><th>" + c.esc(T(c, "site.admin.maik.colCredential", "Credential")) + "</th></tr></thead><tbody>" +
        (r.providers || []).map(function (p) {
          return "<tr><td>" + c.esc(p.provider) + '</td><td><span class="pill' + (p.configured ? " ok" : " stop") + '">' + c.esc(p.configured ? T(c, "site.admin.yes", "yes") : T(c, "site.admin.no", "no")) + "</span></td><td>" + c.esc(p.detail || "") + "</td><td>" + c.esc(p.credentialSource || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<h3>' + c.esc(T(c, "site.admin.maik.settings", "Settings")) + '</h3><div class="row">' +
        '<label class="f"><input type="checkbox" id="admMaikEnabled"' + (r.enabled ? " checked" : "") + "> " + c.esc(T(c, "site.admin.maik.enabledToggle", "MaiK enabled")) + "</label></div>" +
        /* The on-premises model. The gateway ranks a model on the hospital's own hardware ABOVE any
         * cloud one, so a hospital that runs its own never sends a chart off-site. It was reachable
         * only by editing the org document by hand until this existed. */
        '<h3>' + c.esc(T(c, "site.admin.maik.onPremTitle", "On-premises model")) + '</h3><div class="row">' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.maik.baseUrl", "Base URL (OpenAI-compatible)")) + '</span><input id="admMaikLocalUrl" placeholder="http://10.0.0.5:8000/v1" value="' + c.esc(localUrl) + '"></label>' +
        '<label class="f"><span>' + c.esc(T(c, "site.admin.maik.modelName", "Model name")) + '</span><input id="admMaikLocalModel" placeholder="' + c.esc(T(c, "site.admin.maik.modelNamePlaceholder", "the name the server answers to")) + '" value="' + c.esc(localModel) + '"></label></div>' +
        '<div class="row"><label class="f"><input type="checkbox" id="admMaikPhiLocal"' + (localApproved ? " checked" : "") + "> " + c.esc(T(c, "site.admin.maik.phiLocalToggle", "Patient data may be sent to the on-premises model")) + "</label></div>" +
        '<h3>' + c.esc(T(c, "site.admin.maik.cloudTitle", "Cloud model")) + '</h3><div class="row">' +
        '<label class="f"><input type="checkbox" id="admMaikPhi"' + (cloudApproved ? " checked" : "") + "> " + c.esc(T(c, "site.admin.maik.phiCloudToggle", "Patient data may be sent to Vertex AI (the cloud provider with a patient-data agreement)")) + "</label>" +
        (vx.phiCapable === false ? '<div class="msg err">' + EN(c, c.esc(vx.detail || T(c, "site.admin.maik.vertexNoPhi", "Vertex AI cannot receive patient data on this server."))) + "</div>" : "") +
        '<button class="btn" id="admMaikSave" type="button">' + c.esc(T(c, "site.admin.save", "Save")) + '</button></div><div id="admMaikMsg"></div>' +
        '<div class="msg note">' + c.esc(T(c, "site.admin.maik.note", "Enabling MaiK uses the providers listed above. A cloud provider only answers when the environment holds its key (named under Credential). Patient data leaves the hospital only when the second switch is on. Clinical content from MaiK is not signed off.")) + "</div>" +
        "</div>";
      document.getElementById("admMaikSave").onclick = function () {
        var btn = document.getElementById("admMaikSave");
        var enabled = document.getElementById("admMaikEnabled").checked;
        var phi = document.getElementById("admMaikPhi").checked;
        var phiLocal = document.getElementById("admMaikPhiLocal").checked;
        var lUrl = (document.getElementById("admMaikLocalUrl").value || "").trim();
        var lModel = (document.getElementById("admMaikLocalModel").value || "").trim();
        // Approval is PER PROVIDER in the gateway, never a single flag: approving the hospital's own
        // model must not silently approve a cloud one, which is exactly what one boolean would do.
        var approve = [];
        if (phiLocal) approve.push("local-openai");
        if (phi) approve.push("vertex");
        var existing = (c.state.org && c.state.org.wardsynq) || {};
        var wsq = Object.assign({}, existing, { maik: Object.assign({}, existing.maik, {
          enabled: enabled, phiApproved: approve, localBaseUrl: lUrl || null, localModel: lModel || null
        }) });
        btn.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, wardsynq: wsq }).then(function (ur) {
          if (!ur || !ur.ok) { btn.disabled = false; document.getElementById("admMaikMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, ur))) + "</div>"; return; }
          return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (or2) {
            btn.disabled = false;
            if (or2 && or2.ok) c.state.org = or2.org;
            c.toast(T(c, "site.admin.maik.saved", "MaiK settings saved.")); WSQ.render("admin");
          });
        }, function () { btn.disabled = false; document.getElementById("admMaikMsg").innerHTML = '<div class="msg err">' + c.esc(T(c, "site.admin.maik.noResponse", "No response from the server. The settings may not have been saved; reload to check.")) + "</div>"; });
      };
    });
  }
  // ---- Security review (P2.17) ----------------------------------------------------------------
  /* Advisory findings over the audit trail, a review queue for break-glass and admin acts, and data
   * protection. Loading, failed, unavailable and empty are four different sentences: a section that
   * could not be checked must never read as "nothing found", and nothing here is green without a
   * recorded backup AND a recorded restore test. */
  function secTypeLabel(c, t) {
    return {
      "chart-access-volume": T(c, "site.admin.security.type.volume", "Unusually many patients read"),
      "chart-access-off-hours": T(c, "site.admin.security.type.offHours", "Reads outside usual hours"),
      "repeated-denied": T(c, "site.admin.security.type.repeatedDenied", "Repeated denied actions"),
      "unusual-export": T(c, "site.admin.security.type.unusualExport", "Unusual export volume"),
      "out-of-assignment": T(c, "site.admin.security.type.outOfAssignment", "Read outside an assignment"),
      "failed-sign-ins": T(c, "site.admin.security.type.failedSignIns", "Many failed sign-ins"),
      "new-device": T(c, "site.admin.security.type.newDevice", "Sign-in from a new device"),
      "many-devices": T(c, "site.admin.security.type.manyDevices", "Many devices in a short time"),
    }[t] || t;
  }
  function secStatusLabel(c, s) {
    return {
      green: T(c, "site.admin.security.status.green", "Protected: recent backup and a successful restore test on record"),
      amber: T(c, "site.admin.security.status.amber", "Needs attention"),
      red: T(c, "site.admin.security.status.red", "Not protected"),
      unavailable: T(c, "site.admin.security.status.unavailable", "Unknown: could not be checked"),
    }[s];
  }

  /* LT-35: every person on the security review is the staff member (GET /ward/actor-names, the staff identity resolver
   * functions/_wardsynq/staff-identity.js), rendered the way the audit screen renders them (audit.js actorHtml): name,
   * employee id and role, never an account id ("fb:..."), an Access hash or a mobile number. `names` is that lookup,
   * null while it has not answered. */
  function who(c, id, names) {
    if (WSQ._audit && WSQ._audit.actorHtml) return WSQ._audit.actorHtml(c, id, names);
    // audit.js not on the page: still never an account id or a mobile number.
    id = String(id || "");
    return /^(fb|cfa|ghis):/.test(id) || /^\+?[\d\s().-]{7,}$/.test(id) ? c.esc(T(c, "site.audit.actorUnnamed", "Staff account, name not set")) : EN(c, c.esc(id));
  }
  /** Every actor id a security report names, for one lookup. */
  function secActorIds(r) {
    var ids = [], add = function (id) { id = String(id || ""); if (id && id.indexOf("system:") !== 0 && ids.indexOf(id) < 0) ids.push(id); };
    [r.chartAccess, r.exports, r.logins, r.assignmentAccess].forEach(function (s) {
      if (!s) return;
      (s.findings || []).forEach(function (f) { add(f.actor); (f.signIns || []).forEach(add); (f.evidence || []).forEach(function (e) { add(e.actor); }); });
      (s.notEvaluated || []).concat(s.exempt || []).forEach(function (x) { add(x.actor); });
    });
    ((r.reviewQueue && r.reviewQueue.items) || []).forEach(function (i) { add(i.actor); (i.reviews || []).forEach(function (v) { add(v.reviewedBy); }); });
    return ids;
  }
  WSQ._secActorIds = secActorIds;

  function secSection(c, title, s, days, names) {
    var esc = c.esc;
    var h = "<h3>" + esc(title) + "</h3>";
    if (!s || s.status !== "ok") return h + '<div class="msg err">' + esc(T(c, "site.admin.security.couldNotCheckLead", "Could not be checked")) + (s && s.detail ? ": " + EN(c, esc(s.detail)) : "") + ". " + esc(T(c, "site.admin.security.notSameAsNoneFound", "This is not the same as nothing being found.")) + "</div>";
    if (s.truncated || s.partial) h += '<div class="msg note">' + esc(T(c, "site.admin.security.partialLog", "Only part of the log could be read, so some activity may not have been checked.")) + "</div>";
    if (!s.findings.length) return h + '<p class="quiet">' + esc(T(c, "site.admin.security.noFindings", "No findings in the last {days} days.", { days: days })) + "</p>";
    return h + s.findings.map(function (f) {
      /* G11: an out-of-assignment finding shows the ward history behind each read. */
      var wards = f.type === "out-of-assignment";
      return "<details><summary><b>" + esc(secTypeLabel(c, f.type)) + "</b>: " + who(c, f.actor, names) + ". " + esc(f.summary) + "</summary>" +
        '<p class="quiet">' + esc(f.method) + "</p>" +
        ((f.signIns || []).length ? '<p class="quiet">' + esc(T(c, "site.admin.security.countedAsOne", "Counted as one reader across these sign-ins:")) + " " + f.signIns.map(function (s) { return who(c, s, names); }).join("; ") + "</p>" : "") +
        '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.security.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.security.colAction", "Action")) + "</th><th>" + esc(T(c, "site.admin.security.colType", "Type")) + "</th><th>" + esc(T(c, "site.admin.security.colPatientRef", "Patient ref")) + "</th>" + (wards ? "<th>" + String(T(c, "site.admin.security.colWardThen", "Patient's ward then")).replace(/[&<>]/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;" }[ch]; }) + "</th><th>" + esc(T(c, "site.admin.security.colRosteredThen", "Reader rostered on then")) + "</th>" : "") + "<th>" + esc(T(c, "site.admin.security.colOutcome", "Outcome")) + "</th><th>" + esc(T(c, "site.admin.security.colDetail", "Detail")) + "</th><th>" + esc(T(c, "site.admin.security.colAuditRow", "Audit row")) + "</th></tr></thead><tbody>" +
        f.evidence.map(function (e) {
          return "<tr><td>" + esc(e.ts) + "</td><td>" + esc(e.action) + "</td><td>" + esc(e.resourceType || "") + '</td><td class="mono">' + esc(e.patientRef || "") + "</td>" +
            (wards ? "<td>" + esc(e.wardAtRead || "") + "</td><td>" + esc((e.readerWardsAtRead || []).length ? e.readerWardsAtRead.join(", ") : T(c, "site.admin.security.noWardShift", "No ward shift")) + "</td>" : "") +
            "<td>" + esc(e.outcome || "") + "</td><td>" + esc(e.detail || "") + '</td><td class="mono">' + esc(e.id || "") + (e.recordId ? "<br>" + esc(e.recordId) : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (f.evidenceTotal > f.evidence.length ? '<p class="quiet">' + esc(T(c, "site.admin.security.showingRows", "Showing {n} of {total} rows.", { n: f.evidence.length, total: f.evidenceTotal })) + "</p>" : "") + openRowsHtml(c, f.evidence) + "</details>";
    }).join("");
  }

  /* G11 CLICKABLE EVIDENCE. A button that reads the audit rows behind a finding back from the audit trail
   * (GET /ward/audit-rows): null while loading, a failure says so, ids not found are named. */
  function openRowsHtml(c, evidence) {
    var ids = (evidence || []).map(function (e) { return e.id; }).filter(Boolean);
    if (!ids.length) return "";
    return '<button type="button" class="btn ghost sm" data-sec-rows="' + c.esc(ids.join(",")) + '">' + c.esc(T(c, "site.admin.security.openAuditRows", "Open these audit rows")) + '</button><div class="sec-rows-out"></div>';
  }
  function auditRowsHtml(c, r, names) {
    var esc = c.esc;
    if (r == null) return '<p class="quiet"><span class="spin"></span> ' + esc(T(c, "site.admin.security.readingRows", "Reading the audit rows...")) + "</p>";
    if (r.failed) return '<div class="msg err">' + esc(T(c, "site.admin.security.rowsFailedLead", "The audit rows could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.security.notSameAsNone", "This is not the same as there being none.")) + "</div>";
    var h = (r.missing || []).length ? '<div class="msg err">' + esc(T(c, "site.admin.security.missingRows", "{n} of the audit rows named were not found in this hospital's audit trail:", { n: r.missing.length })) + ' <span class="mono">' + r.missing.map(esc).join(", ") + "</span></div>" : "";
    if (!(r.rows || []).length) return h + '<p class="quiet">' + esc(T(c, "site.admin.security.noRowReturned", "No audit row was returned.")) + "</p>";
    return h + '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.security.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.security.colBy", "By")) + "</th><th>" + esc(T(c, "site.admin.security.colAction", "Action")) + "</th><th>" + esc(T(c, "site.admin.security.colType", "Type")) + "</th><th>" + esc(T(c, "site.admin.security.colRecord", "Record")) + "</th><th>" + esc(T(c, "site.admin.security.colPatientRef", "Patient ref")) + "</th><th>" + esc(T(c, "site.admin.security.colOutcome", "Outcome")) + "</th><th>" + esc(T(c, "site.admin.security.colChainedRow", "Chained row")) + "</th><th>" + esc(T(c, "site.admin.security.colAuditRow", "Audit row")) + "</th></tr></thead><tbody>" +
      r.rows.map(function (e) {
        return "<tr><td>" + esc(e.ts) + "</td><td>" + who(c, e.actor, names) + "</td><td>" + esc(e.action || "") + "</td><td>" + esc(e.resourceType || "") + '</td><td class="mono">' + esc(e.recordId || "") +
          '</td><td class="mono">' + esc(e.patientRef || "") + "</td><td>" + esc(e.outcome || "") + "</td><td>" + (e.chainSeq == null ? esc(T(c, "site.admin.security.notLinked", "Not linked")) : esc(e.chainSeq)) + '</td><td class="mono">' + esc(e.id || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  WSQ._auditRowsHtml = auditRowsHtml;

  /* Reads outside an assignment. "Not evaluated" is its own state and never renders as no findings. */
  function secAssignment(c, s, days, names) {
    var esc = c.esc;
    var h = "<h3>" + esc(T(c, "site.admin.security.outOfAssignmentTitle", "Reads outside an assignment")) + "</h3>";
    if (!s || (s.status !== "ok" && s.status !== "not_evaluated")) return h + '<div class="msg err">' + esc(T(c, "site.admin.security.couldNotCheckLead", "Could not be checked")) + (s && s.detail ? ": " + EN(c, esc(s.detail)) : "") + ". " + esc(T(c, "site.admin.security.notSameAsNoneFound", "This is not the same as nothing being found.")) + "</div>";
    var ex = (s.exemptions || []).length ? "<details><summary>" + esc(T(c, "site.admin.security.exempt", "Exempt from this check")) + "</summary><ul>" + s.exemptions.map(function (x) { return "<li>" + esc(x.rule) + " " + esc(x.reason) + "</li>"; }).join("") + "</ul></details>" : "";
    if (s.status === "not_evaluated") return h + '<div class="msg note">' + esc(T(c, "site.admin.security.notEvaluatedLead", "Not evaluated:")) + " " + EN(c, esc(s.reason)) + " " + esc(T(c, "site.admin.security.notSameAsNoFindings", "This is not the same as no findings.")) + "</div>" + ex;
    if (s.truncated) h += '<div class="msg note">' + esc(T(c, "site.admin.security.partialReads", "Only part of the log could be read, so some reads may not have been checked.")) + "</div>";
    if ((s.incomplete || []).length) h += '<div class="msg note">' + esc(T(c, "site.admin.security.incompleteLead", "Incomplete:")) + " " + EN(c, esc(s.incomplete.join("; "))) + ".</div>";
    if ((s.matching || []).length) h += '<div class="msg note">' + EN(c, esc(s.matching.join(" "))) + "</div>";
    h += '<p class="quiet">' + esc(T(c, "site.admin.security.readsInPeriod", "{n} reads in the period: {assigned} within an assignment.", { n: s.readsInPeriod, assigned: s.assignedReads })) + "</p>";
    h += s.findings.length ? secSection(c, "", { status: "ok", findings: s.findings }, days, names).replace("<h3></h3>", "") : '<p class="quiet">' + esc(T(c, "site.admin.security.noOutOfAssignment", "No reads outside an assignment among the reads that could be compared.")) + "</p>";
    var list = function (title, rows, field) {
      return rows.length ? "<details><summary>" + esc(T(c, "site.admin.security.readsCount", "{title} ({n} reads)", { title: title, n: rows.reduce(function (n, x) { return n + x.reads; }, 0) })) + "</summary><ul>" +
        rows.map(function (x) {
          return "<li>" + who(c, x.actor, names) + ": " + esc(T(c, "site.admin.security.readsN", "{n} reads.", { n: x.reads })) + " " + esc(x[field]) + ' <span class="quiet mono">' + x.evidence.map(function (e) { return esc(e.id); }).join(", ") + "</span> " + openRowsHtml(c, x.evidence) + "</li>";
        }).join("") + "</ul></details>" : "";
    };
    return h + list(T(c, "site.admin.security.notEvaluated", "Not evaluated"), s.notEvaluated || [], "reason") + list(T(c, "site.admin.security.exemptShort", "Exempt"), s.exempt || [], "exemption") + ex;
  }

  function securityReviewHtml(c, r, names) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><span class="spin"></span> ' + esc(T(c, "site.admin.security.loading", "Loading the security review...")) + "</div>";
    if (r.failed) return '<div class="card"><div class="msg err">' + esc(T(c, "site.admin.security.loadFailedLead", "The security review could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.security.notSameAsNothing", "This is not the same as there being nothing to review.")) + "</div></div>";
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.security.title", "Security review, last {days} days", { days: r.days })) + "</h2>" +
      '<div class="msg note">' + EN(c, esc(r.note)) + "</div>";
    var types = Object.keys(r.counts || {});
    h += types.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.security.colFinding", "Finding")) + "</th><th>" + esc(T(c, "site.admin.security.colCount", "Count")) + "</th></tr></thead><tbody>" +
      types.map(function (t) { return "<tr><td>" + esc(secTypeLabel(c, t)) + "</td><td>" + esc(r.counts[t]) + "</td></tr>"; }).join("") + "</tbody></table></div>"
      : '<p class="quiet">' + esc(T(c, "site.admin.security.noFindingsChecked", "No findings in the sections that could be checked. Check each section below for any that could not.")) + "</p>";
    h += secSection(c, T(c, "site.admin.security.chartAccess", "Chart access"), r.chartAccess, r.days, names) + secAssignment(c, r.assignmentAccess, r.days, names) + secSection(c, T(c, "site.admin.security.exports", "Exports"), r.exports, r.days, names) + secSection(c, T(c, "site.admin.security.signIns", "Sign-ins"), r.logins, r.days, names);
    h += "<h3>" + esc(T(c, "site.admin.security.notCheckedTitle", "Not checked, and why")) + "</h3><ul>" + (r.notDetected || []).map(function (n) { return "<li>" + esc(n.rule) + ": " + esc(n.reason) + "</li>"; }).join("") + "</ul></div>";

    var q = r.reviewQueue || {};
    h += '<div class="card"><h2>' + esc(T(c, "site.admin.security.reviewQueue", "Review queue")) + "</h2>";
    if (q.status === "ok" || q.status === "partial") {
      if (q.missing && q.missing.length) h += '<div class="msg note">' + esc(T(c, "site.admin.security.incompleteLead", "Incomplete:")) + " " + EN(c, esc(q.missing.join("; "))) + ".</div>";
      h += q.items.length ? '<p class="quiet">' + esc(T(c, "site.admin.security.awaitingReview", "{n} awaiting review.", { n: q.awaiting })) + "</p>" +
        '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.security.colWhat", "What")) + "</th><th>" + esc(T(c, "site.admin.security.colBy", "By")) + "</th><th>" + esc(T(c, "site.admin.security.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.security.colDetail", "Detail")) + "</th><th>" + esc(T(c, "site.admin.security.colStatus", "Status")) + "</th><th></th></tr></thead><tbody>" +
        q.items.map(function (i) {
          var key = esc(i.kind + "|" + i.subjectId);
          var hist = i.reviews.map(function (v) { return esc(v.decision) + " " + esc(T(c, "site.admin.security.by", "by")) + " " + who(c, v.reviewedBy, names) + " (" + esc(v.at) + ")" + (v.note ? ": " + esc(v.note) : ""); }).join("<br>");
          return "<tr><td>" + esc(i.kind === "break-glass" ? T(c, "site.admin.security.breakGlass", "Break-glass") : i.action) + "</td><td>" + who(c, i.actor, names) + "</td><td>" + esc(i.at || "") + "</td><td>" + esc(i.detail) + "</td><td>" +
            esc(i.status === "awaiting" ? T(c, "site.admin.security.awaiting", "Awaiting review") : i.status === "appropriate" ? T(c, "site.admin.security.appropriate", "Reviewed, appropriate") : T(c, "site.admin.security.followUp", "Needs follow-up")) + (hist ? '<br><span class="quiet">' + hist + "</span>" : "") + "</td><td>" +
            (i.ownAction ? '<span class="quiet">' + esc(T(c, "site.admin.security.ownAction", "Your own action: another administrator must review it.")) + '</span>'
              : '<button type="button" class="btn ghost" data-sec-review="' + key + '|appropriate">' + esc(T(c, "site.admin.security.appropriate", "Reviewed, appropriate")) + '</button> ' +
                '<button type="button" class="btn ghost" data-sec-review="' + key + '|follow-up">' + esc(T(c, "site.admin.security.followUp", "Needs follow-up")) + '</button>') + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<p class="quiet">' + esc(T(c, "site.admin.security.noQueue", "No break-glass grants or admin actions to review.")) + "</p>";
    } else h += '<div class="msg err">' + esc(T(c, "site.admin.security.queueFailedLead", "The review queue could not be loaded")) + (q.detail ? ": " + EN(c, esc(q.detail)) : "") + ". " + esc(T(c, "site.admin.security.notSameAsNoneAwaiting", "This is not the same as nothing awaiting review.")) + "</div>";
    h += '<div id="secRevMsg"></div></div>';

    var d = r.dataProtection || {};
    h += '<div class="card"><h2>' + esc(T(c, "site.admin.security.dataProtection", "Data protection")) + "</h2><p><b>" + esc(secStatusLabel(c, d.status) || T(c, "site.admin.security.unknown", "Unknown")) + "</b></p>" +
      ((d.reasons || []).length ? "<ul>" + d.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "");
    if (d.status !== "unavailable") {
      h += "<p>" + esc(T(c, "site.admin.security.lastBackupLead", "Last backup:")) + " " + (d.lastBackup ? esc(T(c, "site.admin.security.lastBackup", "{at}, {rows} rows, stored at {loc}", { at: d.lastBackup.at, rows: d.lastBackup.rows, loc: d.lastBackup.location })) : esc(T(c, "site.admin.security.neverRecorded", "never recorded"))) + "</p>" +
        "<p>" + esc(T(c, "site.admin.security.lastRestoreLead", "Last restore test:")) + " " + (d.lastRestoreTest ? esc(T(c, "site.admin.security.lastRestore", "{at}, {outcome}, restored {what}, by {by}", { at: d.lastRestoreTest.at, outcome: d.lastRestoreTest.outcome, what: d.lastRestoreTest.restoredWhat, by: d.lastRestoreTest.performedBy })) : esc(T(c, "site.admin.security.neverRecorded", "never recorded"))) + "</p>";
    }
    h += "<h3>" + esc(T(c, "site.admin.security.recordRestoreTest", "Record a restore test")) + "</h3><div class=\"row\">" +
      '<label class="f"><span>' + esc(T(c, "site.admin.security.whatWasRestored", "What was restored")) + '</span><input id="secRtWhat" placeholder="' + esc(T(c, "site.admin.security.whatWasRestoredPlaceholder", "Backup of 12 Sep into a test database")) + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.security.outcome", "Outcome")) + '</span><select id="secRtOutcome"><option value="">' + esc(T(c, "site.admin.security.choose", "Choose")) + '</option><option value="success">' + esc(T(c, "site.admin.security.success", "Success")) + '</option><option value="partial">' + esc(T(c, "site.admin.security.partial", "Partial")) + '</option><option value="failed">' + esc(T(c, "site.admin.security.failed", "Failed")) + '</option></select></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.security.doneBy", "Done by")) + '</span><input id="secRtBy"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.security.note", "Note")) + '</span><input id="secRtNote"></label>' +
      '</div><button type="button" class="btn" id="secRtSave">' + esc(T(c, "site.admin.security.recordRestoreTestBtn", "Record restore test")) + '</button><div id="secRtMsg"></div></div>';

    var a = r.auditRetention || {};
    h += '<div class="card"><h2>' + esc(T(c, "site.admin.security.auditRetention", "Audit retention")) + "</h2>";
    h += a.status === "ok"
      ? "<p>" + EN(c, esc(a.configuredNote)) + "</p><p>" + esc(T(c, "site.admin.security.oldestAuditRow", "Oldest audit row:")) + " " + esc(a.oldestAuditAt || T(c, "site.admin.security.noneFound", "none found")) + "</p><p>" + esc(T(c, "site.admin.security.oldestRecord", "Oldest record:")) + " " + esc(a.oldestRecordAt || T(c, "site.admin.security.noneShort", "none")) + "</p>" +
        (a.gap ? '<div class="msg err">' + EN(c, esc(a.gap)) + "</div>" : "")
      : '<div class="msg err">' + esc(T(c, "site.admin.security.retentionCheckFailed", "Audit retention could not be checked.")) + "</div>";
    h += "<h3>" + esc(T(c, "site.admin.security.tamperEvidence", "Tamper evidence")) + "</h3>" + auditIntegrityHtml(c, a.integrity, a.anchors);
    /* G3: the hospital event log is chained on its own and reported on its own. */
    h += "<h3>" + esc(T(c, "site.admin.security.tamperEvidenceEventLog", "Tamper evidence: hospital event log")) + "</h3><p class=\"quiet\">" + esc(T(c, "site.admin.security.eventLogNote", "Sign-ins, staff changes, hospital setting changes, and queue and billing actions.")) + "</p>" +
      auditIntegrityHtml(c, a.orgIntegrity, a.orgAnchors, "event-log") + orgUnlinkedHtml(c, a.orgUnlinked);
    return h + "</div>";
  }
  WSQ._securityReviewHtml = securityReviewHtml;

  /* G3. Event-log rows with no link are never verified. Rows added after linking began are listed;
   * a count that could not be made says so, never "every row linked". */
  function orgUnlinkedHtml(c, u) {
    var esc = c.esc;
    if (!u || u.status !== "ok") return '<div class="msg err">' + esc(T(c, "site.admin.security.unlinkedNotCountedLead", "Unlinked rows not counted:")) + " " + EN(c, esc((u && u.message) || T(c, "site.admin.security.noResultReturned", "no result was returned"))) + " " + esc(T(c, "site.admin.security.notSameAsEveryLinked", "This is not the same as every row being linked.")) + "</div>";
    var cls = u.after ? "err" : (u.unlinked || u.partial ? "note" : "ok");
    var h = '<div class="msg ' + cls + '"><b>' + esc(u.after ? T(c, "site.admin.security.rowsWithoutLink", "Rows without a link") : u.unlinked ? T(c, "site.admin.security.unlinkedRows", "Unlinked rows") : T(c, "site.admin.security.everyRowLinked", "Every row read is linked")) + "</b>: " + EN(c, esc(u.message)) + "</div>";
    if ((u.evidence || []).length) {
      h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.security.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.security.colBy", "By")) + "</th><th>" + esc(T(c, "site.admin.security.colAction", "Action")) + "</th><th>" + esc(T(c, "site.admin.security.colRow", "Row")) + "</th></tr></thead><tbody>" +
        u.evidence.map(function (e) { return "<tr><td>" + esc(e.ts) + "</td><td>" + esc(e.actor || "") + "</td><td>" + esc(e.action || "") + '</td><td class="mono">' + esc(e.id || "") + "</td></tr>"; }).join("") +
        "</tbody></table></div>" + (u.after > u.evidence.length ? '<p class="quiet">' + esc(T(c, "site.admin.security.showingRows", "Showing {n} of {total} rows.", { n: u.evidence.length, total: u.after })) + "</p>" : "");
    }
    return h;
  }
  WSQ._orgUnlinkedHtml = orgUnlinkedHtml;

  /* P2.17. Only "ok" and "empty" read as fine. Broken and gap name the row; not verified and a missing
   * result both say the integrity is unknown, never that it is intact. */
  function integrityLabel(c, s) {
    return {
      ok: T(c, "site.admin.security.integrity.ok", "Intact"),
      empty: T(c, "site.admin.security.integrity.empty", "Nothing to verify yet"),
      broken: T(c, "site.admin.security.integrity.broken", "Altered"),
      gap: T(c, "site.admin.security.integrity.gap", "Rows missing"),
      not_verified: T(c, "site.admin.security.integrity.notVerified", "Not verified"),
    }[s];
  }
  /* P2.17 anchors. One line for the outside copy whatever state it is in: matches, differs, nothing
   * recorded yet, or not verified. A missing anchor result is unknown, never intact. A differing
   * copy names the governance lead because restoring over it would destroy the evidence. */
  function anchorLabel(c, s) {
    return {
      ok: T(c, "site.admin.security.anchor.ok", "Outside copy matches"),
      rewritten: T(c, "site.admin.security.anchor.rewritten", "Outside copy differs"),
      truncated: T(c, "site.admin.security.anchor.truncated", "Newest rows removed"),
      "no-anchors": T(c, "site.admin.security.anchor.noAnchors", "No outside copy yet"),
      "not-verified": T(c, "site.admin.security.anchor.notVerified", "Outside copy not verified"),
      disagree: T(c, "site.admin.security.anchor.disagree", "Outside copies disagree"),
    }[s];
  }
  /* G12: `chain` is "" for the clinical audit trail and "event-log" for the hospital event log; the
   * acknowledgement form of each carries its own ids so both can be on the page at once. */
  var ACK_SUFFIX = { "": "", "event-log": "Org" };
  function anchorHtml(c, a, chain) {
    var esc = c.esc;
    if (a == null) return "";
    /* A restarted log names its acknowledgement instead of reading silently green. */
    if (a.status === "ok" && a.acknowledgement) return anchorAckLineHtml(c, a.acknowledgement);
    var cls = a.status === "ok" ? "ok" : (a.status === "no-anchors" ? "note" : "err");
    var h = '<div class="msg ' + cls + '"><b>' + esc(anchorLabel(c, a.status) || T(c, "site.admin.security.anchor.notVerified", "Outside copy not verified")) + "</b>: " + EN(c, esc(a.message || ""));
    if (a.status === "disagree") return h + " " + esc(T(c, "site.admin.security.tellGovernance", "Tell the information governance lead. Do not restore or re-import.")) + "</div>";
    if (a.status === "rewritten" || a.status === "truncated") {
      h += " " + esc(T(c, "site.admin.security.tellGovernance", "Tell the information governance lead. Do not restore or re-import.")) + "</div>";
      h += '<div class="msg note">' + esc(T(c, "site.admin.security.restoreNote", "If the database was restored on purpose (for example a point in time restore), this report is expected and stays until it is acknowledged. Only the owner of this hospital can acknowledge a legitimate restore, with a reason and an incident reference. Do not acknowledge a difference nobody can explain: ask the information governance lead first.")) + "</div>";
      /* The form is the owner's alone. Everyone else sees what happened and who may act. Whether
       * this viewer is the owner arrives on the report from the server; anything else would let a
       * screen decide its own authority. */
      if (a.canAcknowledge === true) h += anchorAckFormHtml(c, chain);
      return h;
    }
    return h + "</div>";
  }
  WSQ._anchorHtml = anchorHtml;
  /* P2.17 acknowledgement line: who accepted the restore, when, why, under which incident, and
   * what the copy reported before. Rendered instead of the tamper line once the log restarts. */
  function ackPreviousLabel(c, s) {
    return {
      rewritten: T(c, "site.admin.security.ackPrevious.rewritten", "differed from the database"),
      truncated: T(c, "site.admin.security.ackPrevious.truncated", "showed rows removed below the application"),
    }[s];
  }
  function anchorAckLineHtml(c, k) {
    var esc = c.esc;
    k = k || {};
    var h = '<div class="msg ok"><b>' + esc(T(c, "site.admin.security.ackRestore", "Acknowledged restore")) + "</b>: " + esc(T(c, "site.admin.security.ackLine", "{by} acknowledged a legitimate restore on {at} (incident {incident}). Before the acknowledgement the outside copy {previous}", { by: k.by || "", at: k.at || "", incident: k.incidentRef || "", previous: ackPreviousLabel(c, k.previousStatus) || T(c, "site.admin.security.ackPreviousFallback", "reported {status}", { status: k.previousStatus || T(c, "site.admin.security.aBreak", "a break") }) })) +
      (k.previousAtSeq != null ? " " + esc(T(c, "site.admin.security.atChainedRow", "at chained row {n}", { n: k.previousAtSeq })) : "") + ".";
    if (k.reason) h += "<br>" + esc(T(c, "site.admin.security.reasonGiven", "Reason given:")) + " " + EN(c, esc(k.reason));
    h += "</div>" + '<p class="quiet">' + esc(T(c, "site.admin.security.ackArchiveNote", "The anchor log from before this acknowledgement is kept as an archive and is never deleted. A new difference after this point is reported again.")) + "</p>";
    return h;
  }
  WSQ._anchorAckLineHtml = anchorAckLineHtml;
  /* P2.17 acknowledgement form (owner only, see anchorHtml). The reason needs at least 20
   * characters and an incident reference; the server checks both again. Nothing here decides
   * authority: a non-owner who forges this form gets a 403 from the route. */
  function anchorAckFormHtml(c, chain) {
    var esc = c.esc;
    var x = ACK_SUFFIX[chain || ""] || "";
    return '<div class="card"><h3>' + esc(x ? T(c, "site.admin.security.ackFormTitleOrg", "Acknowledge a legitimate restore of the hospital event log") : T(c, "site.admin.security.ackFormTitle", "Acknowledge a legitimate restore")) + "</h3>" +
      '<p class="quiet">' + TS(c, "site.admin.security.ackFormIntro", "This archives the current outside copy and restarts it from the newest row, and records the acknowledgement in the audit trail under your name. Only do this when the restore was planned and is written up under the incident reference below. Never put patient details in the reason.") + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.security.whyRestored", "Why was the database restored (at least 20 characters)")) + '</span><input id="secAckReason' + x + '" placeholder="' + esc(T(c, "site.admin.security.whyRestoredPlaceholder", "Planned point in time restore after...")) + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.security.incidentRef", "Incident reference")) + '</span><input id="secAckIncident' + x + '" placeholder="INC-123"></label></div>' +
      '<button type="button" class="btn" id="secAckReview' + x + '">' + esc(T(c, "site.admin.security.reviewAck", "Review acknowledgement")) + '</button><div id="secAckConfirm' + x + '"></div><div id="secAckMsg' + x + '"></div></div>';
  }
  WSQ._anchorAckFormHtml = anchorAckFormHtml;
  /* The confirm step: the entered values read back before anything is sent. Pure so it renders
   * the same in the page and in tests. */
  function anchorAckConfirmHtml(c, reason, incident, chain) {
    var esc = c.esc, x = ACK_SUFFIX[chain || ""] || "";
    return '<div class="msg note"><b>' + esc(T(c, "site.admin.security.checkBeforeConfirming", "Check before confirming.")) + '</b> ' + esc(x ? T(c, "site.admin.security.ackingOrg", "You are acknowledging a legitimate restore of the hospital event log.") : T(c, "site.admin.security.acking", "You are acknowledging a legitimate restore of the audit trail.")) + "<br>" +
      esc(T(c, "site.admin.security.reason", "Reason:")) + " " + EN(c, esc(reason)) + "<br>" + esc(T(c, "site.admin.security.incident", "Incident:")) + " " + EN(c, esc(incident)) + "</div>" +
      '<button type="button" class="btn" id="secAckGo' + x + '">' + esc(T(c, "site.admin.security.confirmAck", "Confirm acknowledgement")) + '</button> <button type="button" class="btn ghost" id="secAckBack' + x + '">' + esc(T(c, "site.admin.security.back", "Back")) + '</button>';
  }
  WSQ._anchorAckConfirmHtml = anchorAckConfirmHtml;
  function auditIntegrityHtml(c, ig, anchors, chain) {
    var esc = c.esc;
    if (!ig) return '<div class="msg err">' + esc(T(c, "site.admin.security.integrityNoResult", "Not verified: no integrity result was returned. This is not the same as the audit trail being intact.")) + "</div>" + anchorHtml(c, anchors === undefined ? null : anchors, chain);
    var fine = ig.status === "ok" || ig.status === "empty";
    var h = '<div class="msg ' + (fine ? "ok" : "err") + '"><b>' + esc(integrityLabel(c, ig.status) || T(c, "site.admin.security.integrity.notVerified", "Not verified")) + "</b>: " + EN(c, esc(ig.message || "")) + "</div>";
    if (ig.atSeq != null) {
      h += '<div class="tbl"><table><tbody><tr><th>' + esc(T(c, "site.admin.security.chainedRow", "Chained row")) + "</th><td>" + esc(ig.atSeq) + "</td></tr>" +
        (ig.auditId ? '<tr><th>' + esc(T(c, "site.admin.security.colAuditRow", "Audit row")) + '</th><td class="mono">' + esc(ig.auditId) + "</td></tr>" : "") +
        (ig.expected ? '<tr><th>' + esc(T(c, "site.admin.security.expected", "Expected")) + '</th><td class="mono">' + esc(ig.expected) + '</td></tr><tr><th>' + esc(T(c, "site.admin.security.found", "Found")) + '</th><td class="mono">' + esc(ig.found || "") + "</td></tr>" : "") +
        "</tbody></table></div>";
    }
    if (anchors !== undefined && anchors !== null) h += anchorHtml(c, anchors, chain);
    return h + '<p class="quiet">' + esc(T(c, "site.admin.security.integrityNote", "Each audit row is linked to the one before it by a hash, so a change or removal made in the database itself shows here. The newest rows are checked each time. Once an hour the newest row number is also copied to two stores outside the database (KV and Firestore) and compared here, and the two copies are compared with each other. Rows written before this was switched on are not linked and cannot be checked.")) + "</p>";
  }
  WSQ._auditIntegrityHtml = auditIntegrityHtml;

  /* DATA EXPORT (FHIR). The hospital's record as FHIR Bulk Data NDJSON (functions/_wardsynq/fhir-bulk.js).
   * The list is null while loading and false when it failed, and a failed load never renders as "no
   * exports". Each status reads differently: running, done (with its files and counts, even when a
   * type had nothing), failed (with the reason), cancelled, expired. Anything the export could not
   * include is listed under the job, never hidden. */
  function exportStatusLabel(c, s) {
    return {
      "in-progress": T(c, "site.admin.export.status.running", "Running"),
      complete: T(c, "site.admin.export.status.done", "Done"),
      failed: T(c, "site.admin.export.status.failed", "Failed"),
      cancelled: T(c, "site.admin.export.status.cancelled", "Cancelled"),
      expired: T(c, "site.admin.export.status.expired", "Expired, files deleted"),
    }[s];
  }
  /* G9. `groups` is the ward census as a FHIR Bundle of Group (fhir-group.js): null while loading, false when
   * it failed. A failed ward list leaves the whole-hospital export available and says the wards could not be
   * listed, rather than offering none. */
  function exportHtml(c, r, groups) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("cloud_download") + " " + esc(T(c, "site.admin.export.title", "Data export (FHIR)")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.export.intro", "Exports this hospital's record as FHIR R4 NDJSON, one file per resource type, in the background. One export runs at a time. Files are downloaded here, or through the FHIR Bulk Data API ($export-status), with this hospital's authorization; every download is recorded in the audit trail, and files are deleted after 24 hours.")) + "</p>";
    if (r === null) return h + '<span class="spin"></span></div>';
    if (r === false || r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.export.loadFailedLead", "Exports could not be loaded")) + (r && r.message ? ": " + EN(c, esc(r.message)) : "") + ". " + esc(T(c, "site.admin.export.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    var wardOpts = groups && groups.entry ? groups.entry.filter(function (e) { return e.resource && e.resource.resourceType === "Group"; }).map(function (e) {
      return '<option value="' + esc(e.resource.id) + '">' + esc(T(c, "site.admin.export.wardOption", "{name} ({n} patients now)", { name: e.resource.name, n: e.resource.quantity })) + "</option>";
    }).join("") : "";
    h += "<h3>" + esc(T(c, "site.admin.export.startTitle", "Start an export")) + "</h3>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.export.whichPatients", "Which patients")) + '</span><select id="admExpGroup"><option value="">' + esc(T(c, "site.admin.export.wholeHospital", "The whole hospital")) + "</option>" + wardOpts + "</select></label></div>" +
      (groups === null || groups === undefined ? '<p class="quiet">' + esc(T(c, "site.admin.export.loadingWards", "Loading the wards...")) + "</p>"
        : groups === false || !groups.entry ? '<div class="msg err">' + esc(T(c, "site.admin.export.wardsFailed", "The wards could not be listed, so a single-ward export cannot be chosen right now. The whole-hospital export still works.")) + "</div>"
        : !wardOpts ? '<p class="quiet">' + esc(T(c, "site.admin.export.noWard", "No ward has an admitted patient right now, so there is no ward to export on its own.")) + "</p>" : "") +
      '<div class="row">' + (r.exportable || []).map(function (t) {
      return '<label class="f" style="flex:0 1 190px"><span><input type="checkbox" class="admExpType" value="' + esc(t) + '" checked> ' + esc(t) + "</span></label>";
    }).join("") + "</div>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.export.onlyChangedSince", "Only changed since (optional)")) + '</span><input type="datetime-local" id="admExpSince"></label></div>' +
      '<button type="button" class="btn" id="admExpStart">' + esc(T(c, "site.admin.export.start", "Start export")) + '</button> <button type="button" class="btn ghost" id="admExpRefresh">' + esc(T(c, "site.admin.export.refresh", "Refresh")) + '</button><div id="admExpMsg"></div>';
    h += "<h3>" + esc(T(c, "site.admin.export.exportsTitle", "Exports")) + "</h3>";
    if (!r.exports.length) return h + '<p class="quiet">' + esc(T(c, "site.admin.export.none", "No export has been started for this hospital.")) + "</p></div>";
    h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.export.colStarted", "Started")) + "</th><th>" + esc(T(c, "site.admin.export.colTypes", "Types")) + "</th><th>" + esc(T(c, "site.admin.export.colSince", "Since")) + "</th><th>" + esc(T(c, "site.admin.export.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.admin.export.colFiles", "Files")) + "</th><th></th></tr></thead><tbody>" +
      r.exports.map(function (x) {
        var status = esc(exportStatusLabel(c, x.status) || x.status);
        if (x.status === "in-progress") status += '<br><span class="quiet">' + esc(T(c, "site.admin.export.resourcesSoFar", "{n} resources so far", { n: x.exported })) + "</span>";
        if (x.status === "failed") status = '<span class="msg err">' + esc(T(c, "site.admin.export.failedLead", "Failed:")) + " " + EN(c, esc(x.error || T(c, "site.admin.export.noReason", "no reason recorded"))) + "</span>";
        var files = x.status === "complete"
          ? (x.files.length ? x.files.map(function (f) { return esc(f.name) + ": " + esc(f.count) + ' <button type="button" class="btn ghost sm" data-exp-file="' + esc(x.id) + '" data-exp-name="' + esc(f.name) + '">' + esc(T(c, "site.admin.export.download", "Download")) + '</button>'; }).join("<br>") : esc(T(c, "site.admin.export.doneNone", "Done. No resources matched this export.")))
          : '<span class="quiet">' + esc(x.files.length ? T(c, "site.admin.export.filesWritten", "{n} file(s) written", { n: x.files.length }) : T(c, "site.admin.export.filesNone", "none")) + "</span>";
        if (x.issues && x.issues.length) files += '<div class="msg err">' + esc(T(c, "site.admin.export.notIncludedLead", "Not included:")) + " " + EN(c, x.issues.map(function (i) { return esc(i.detail); }).join("<br>")) + "</div>";
        var act = (x.status === "in-progress" || x.status === "complete") ? '<button type="button" class="btn ghost" data-exp-cancel="' + esc(x.id) + '">' + esc(x.status === "complete" ? T(c, "site.admin.export.deleteFiles", "Delete files") : T(c, "site.admin.export.cancel", "Cancel")) + "</button>" : "";
        return "<tr><td>" + esc(x.requestedAt) + "<br><span class=\"quiet\">" + esc(x.requestedBy) + "</span></td><td>" + esc((x.types || []).join(", ")) + (x.groupName ? '<br><span class="quiet">' + esc(T(c, "site.admin.export.ward", "ward:")) + " " + esc(x.groupName) + "</span>" : "") + "</td><td>" + esc(x.since || T(c, "site.admin.export.all", "all")) + "</td><td>" + status + "</td><td>" + files + "</td><td>" + act + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h + "</div>";
  }
  WSQ._exportHtml = exportHtml;

  function renderExport(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = exportHtml(c, null);
    return Promise.all([c.api("/ward/fhir-exports" + q), c.api("/ward/fhir/Group" + q)]).then(function (rs) {
      var r = rs[0], groups = rs[1] && rs[1].resourceType === "Bundle" ? rs[1] : false;
      body.innerHTML = exportHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) }, groups);
      if (!r || !r.ok) return;
      var msg = function (t) { document.getElementById("admExpMsg").innerHTML = '<div class="msg err">' + c.esc(t) + "</div>"; };
      document.getElementById("admExpRefresh").onclick = function () { WSQ.render("admin"); };
      document.getElementById("admExpStart").onclick = function () {
        var btn = this, types = [];
        document.querySelectorAll(".admExpType").forEach(function (b) { if (b.checked) types.push(b.value); });
        if (!types.length) { msg(T(c, "site.admin.export.errType", "Choose at least one resource type.")); return; }
        var sinceRaw = document.getElementById("admExpSince").value, since = "";
        if (sinceRaw) { var d = new Date(sinceRaw); if (isNaN(d.getTime())) { msg(T(c, "site.admin.export.errDate", "That date is not valid.")); return; } since = d.toISOString(); }
        btn.disabled = true;
        var groupSel = document.getElementById("admExpGroup");
        c.api("/ward/fhir-export", { orgId: c.state.orgId, types: types, since: since, groupId: groupSel ? groupSel.value : "" }).then(function (x) {
          if (!x || !x.ok) { btn.disabled = false; msg(refusal(c, x)); return; }
          c.toast(T(c, "site.admin.export.started", "Export started.")); WSQ.render("admin");
        });
      };
      /* A download goes through the same authorised, audited $export-file route a bulk client uses: the
       * server refuses a download it could not record in the audit trail, and that refusal is shown. */
      body.querySelectorAll("[data-exp-file]").forEach(function (b) {
        b.onclick = function () {
          var name = b.getAttribute("data-exp-name");
          b.disabled = true;
          c.download("/ward/fhir/$export-file/" + encodeURIComponent(b.getAttribute("data-exp-file")) + "/" + encodeURIComponent(name) + q, name).then(function (x) {
            b.disabled = false;
            if (!x || !x.ok) { msg(T(c, "site.admin.export.downloadRefused", "Download refused: {why}", { why: (x && x.message) || T(c, "site.admin.export.noAnswer", "no answer from the server") })); return; }
            c.toast(T(c, "site.admin.export.downloaded", "Downloaded {name}. The download is in the audit trail.", { name: name }));
          });
        };
      });
      body.querySelectorAll("[data-exp-cancel]").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          c.api("/ward/fhir-export-cancel", { orgId: c.state.orgId, id: b.getAttribute("data-exp-cancel") }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; msg(refusal(c, x)); return; }
            c.toast(T(c, "site.admin.export.cancelled", "Export cancelled and its files deleted.")); WSQ.render("admin");
          });
        };
      });
    });
  }

  /* FHIR (functions/_wardsynq/fhir-terminology.js, fhir.js capabilityStatement). What this hospital's FHIR
   * server declares, and the value sets it serves, each expandable in place. Each load is null while
   * loading and a failure when it failed: a list that failed never reads as "no value sets", and a
   * fragment's warning is shown above its codes, never dropped. */
  function fhirFailed(c, r, type) {
    if (r && r.resourceType === type) return null;
    if (r && r.resourceType === "OperationOutcome") return (r.issue || []).map(function (i) { return i.diagnostics || i.code; }).join("; ");
    return refusal(c, r);
  }
  function fhirHtml(c, meta, sets) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("hub") + " " + esc(T(c, "site.admin.fhir.serverTitle", "FHIR server")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.fhir.serverIntro", "What this hospital's FHIR R4 API declares to other systems. A patient's International Patient Summary opens from their chart on the ward.")) + "</p>";
    if (meta === null) h += '<span class="spin"></span>';
    else if (fhirFailed(c, meta, "CapabilityStatement")) h += '<div class="msg err">' + esc(T(c, "site.admin.fhir.capabilityFailedLead", "The capability statement could not be loaded:")) + " " + EN(c, esc(fhirFailed(c, meta, "CapabilityStatement"))) + ".</div>";
    else {
      var rest = (meta.rest && meta.rest[0]) || {};
      h += '<div class="kv"><dt>' + esc(T(c, "site.admin.fhir.version", "FHIR version")) + "</dt><dd>" + esc(meta.fhirVersion) + "</dd><dt>" + esc(T(c, "site.admin.fhir.software", "Software")) + "</dt><dd>" + esc((meta.software && meta.software.name) || "") + " " + esc((meta.software && meta.software.version) || "") + "</dd>" +
        "<dt>" + esc(T(c, "site.admin.fhir.smart", "SMART on FHIR")) + "</dt><dd>" + esc(rest.security && rest.security.service ? T(c, "site.admin.fhir.enabled", "enabled") : T(c, "site.admin.fhir.notEnabled", "not enabled")) + "</dd>" +
        "<dt>" + esc(T(c, "site.admin.fhir.writes", "Writes")) + "</dt><dd>" + esc((rest.interaction || []).length ? T(c, "site.admin.fhir.writesAccepted", "accepted (inbound FHIR is enabled)") : T(c, "site.admin.fhir.writesNone", "none, read only")) + "</dd>" +
        "<dt>" + esc(T(c, "site.admin.fhir.operations", "Operations")) + "</dt><dd>" + esc((rest.operation || []).map(function (o) { return "$" + o.name; }).join(", ")) + "</dd></div>" +
        '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.fhir.colResource", "Resource")) + "</th><th>" + esc(T(c, "site.admin.fhir.colInteractions", "Interactions")) + "</th></tr></thead><tbody>" +
        (rest.resource || []).map(function (r) {
          return "<tr><td>" + esc(r.type) + "</td><td>" + esc((r.interaction || []).map(function (i) { return i.code; }).join(", ")) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    h += '</div><div class="card"><h2>' + c.ms("menu_book") + " " + esc(T(c, "site.admin.fhir.terminology", "Terminology")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.fhir.terminologyIntro", "The code lists this server answers $expand and $validate-code for. This hospital's own lists are complete. LOINC and other published systems are only the codes this server carries: it is not an authoritative source for them.")) + "</p>";
    if (sets === null) return h + '<span class="spin"></span></div>';
    if (fhirFailed(c, sets, "Bundle")) return h + '<div class="msg err">' + esc(T(c, "site.admin.fhir.valueSetsFailedLead", "Value sets could not be loaded:")) + " " + EN(c, esc(fhirFailed(c, sets, "Bundle"))) + ". " + esc(T(c, "site.admin.fhir.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    var entries = sets.entry || [];
    entries.forEach(function (e) { if (e.resource && e.resource.resourceType === "OperationOutcome") h += '<div class="msg note">' + EN(c, esc(fhirFailed(c, e.resource, "Bundle"))) + "</div>"; });
    var vs = entries.filter(function (e) { return e.resource && e.resource.resourceType === "ValueSet"; }).map(function (e) { return e.resource; });
    if (!vs.length) return h + '<p class="quiet">' + esc(T(c, "site.admin.fhir.noValueSets", "This server serves no value sets.")) + "</p></div>";
    return h + '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.fhir.filterCodes", "Filter codes when expanding (optional)")) + '</span><input id="admVsFilter" placeholder="' + esc(T(c, "site.admin.fhir.filterPlaceholder", "code or name")) + '"></label></div>' +
      vs.map(function (v) {
        return "<h3>" + esc(v.title || v.id) + (v.experimental ? ' <span class="pill warn">' + esc(T(c, "site.admin.fhir.draft", "draft")) + "</span>" : "") + "</h3>" +
          '<p class="quiet">' + esc(v.description || "") + ' <span class="mono">' + esc(v.url) + "</span></p>" +
          '<button type="button" class="btn ghost" data-vs-expand="' + esc(v.id) + '">' + esc(T(c, "site.admin.fhir.expand", "Expand")) + '</button><div id="admVs-' + esc(v.id) + '"></div>';
      }).join("") + "</div>";
  }
  WSQ._fhirHtml = fhirHtml;
  function expansionHtml(c, r) {
    var esc = c.esc;
    if (r === null) return '<span class="spin"></span>';
    if (fhirFailed(c, r, "ValueSet") || !r.expansion) return '<div class="msg err">' + esc(T(c, "site.admin.fhir.expandFailedLead", "Could not expand:")) + " " + EN(c, esc(fhirFailed(c, r, "ValueSet") || T(c, "site.admin.fhir.noExpansion", "no expansion returned"))) + ".</div>";
    var x = r.expansion, rows = x.contains || [];
    return (x.parameter || []).filter(function (p) { return p.name === "warning"; }).map(function (w) { return '<div class="msg note">' + EN(c, esc(w.valueString)) + "</div>"; }).join("") +
      '<p class="quiet">' + esc(rows.length < x.total ? T(c, "site.admin.fhir.codeCountShowing", "{n} code(s), showing the first {shown}", { n: x.total, shown: rows.length }) : T(c, "site.admin.fhir.codeCount", "{n} code(s)", { n: x.total })) + ".</p>" +
      (rows.length ? '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.fhir.colCode", "Code")) + "</th><th>" + esc(T(c, "site.admin.fhir.colDisplay", "Display")) + "</th><th>" + esc(T(c, "site.admin.fhir.colSystem", "System")) + "</th></tr></thead><tbody>" +
        rows.map(function (k) { return '<tr><td class="mono">' + esc(k.code) + "</td><td>" + esc(k.display || "") + '</td><td class="mono">' + esc(k.system) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="quiet">' + esc(T(c, "site.admin.fhir.noCodes", "No codes match.")) + "</p>");
  }
  WSQ._expansionHtml = expansionHtml;

  function renderFhir(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = fhirHtml(c, null, null);
    return Promise.all([c.api("/ward/fhir/metadata" + q), c.api("/ward/fhir/ValueSet" + q)]).then(function (res) {
      body.innerHTML = fhirHtml(c, res[0] || {}, res[1] || {});
      body.querySelectorAll("[data-vs-expand]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-vs-expand"), out = document.getElementById("admVs-" + id);
          var filter = String(document.getElementById("admVsFilter").value || "").trim();
          out.innerHTML = expansionHtml(c, null);
          c.api("/ward/fhir/ValueSet/" + encodeURIComponent(id) + "/$expand" + q + "&count=200" + (filter ? "&filter=" + encodeURIComponent(filter) : "")).then(function (x) {
            out.innerHTML = expansionHtml(c, x || {});
          });
        };
      });
    });
  }

  function renderSecurity(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = securityReviewHtml(c, null);
    var names = null;
    return c.api("/ward/security-report" + q + "&days=7").then(function (r) {
      // LT-35: the people named, looked up once before the review is drawn; a failed lookup still shows no raw id.
      var ids = r && r.ok ? secActorIds(r) : [];
      if (!ids.length) return r;
      return c.api("/ward/actor-names" + q + "&ids=" + encodeURIComponent(ids.slice(0, 100).join(","))).then(function (nr) { names = nr && nr.ok ? nr.names : null; return r; }, function () { return r; });
    }).then(function (r) {
      body.innerHTML = securityReviewHtml(c, r && r.ok ? r : { failed: true, message: refusal(c, r) }, names);
      if (!r || !r.ok) return;
      body.querySelectorAll("[data-sec-review]").forEach(function (b) {
        b.onclick = function () {
          var parts = b.getAttribute("data-sec-review").split("|");
          var note = "";
          if (parts[2] === "follow-up") { note = window.prompt(T(c, "site.admin.security.followUpPrompt", "What needs following up?")) || ""; if (!note) return; }
          b.disabled = true;
          c.api("/ward/security-review", { orgId: c.state.orgId, subjectKind: parts[0], subjectId: parts.slice(1, -1).join("|"), decision: parts[parts.length - 1], note: note }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; document.getElementById("secRevMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
            c.toast(T(c, "site.admin.security.reviewRecorded", "Review recorded.")); WSQ.render("admin");
          });
        };
      });
      body.querySelectorAll("[data-sec-rows]").forEach(function (b) {
        b.onclick = function () {
          var out = b.nextElementSibling;
          b.disabled = true;
          out.innerHTML = auditRowsHtml(c, null);
          c.api("/ward/audit-rows" + q + "&ids=" + encodeURIComponent(b.getAttribute("data-sec-rows"))).then(function (x) {
            b.disabled = false;
            out.innerHTML = auditRowsHtml(c, x && x.ok ? x : { failed: true, message: refusal(c, x) }, names);
          }, function () { b.disabled = false; out.innerHTML = auditRowsHtml(c, { failed: true, message: T(c, "site.admin.err.noResponse", "No response from the server.") }); });
        };
      });
      var save = document.getElementById("secRtSave");
      if (save) save.onclick = function () {
        var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
        save.disabled = true;
        c.api("/ward/restore-test", { orgId: c.state.orgId, restoredWhat: val("secRtWhat"), outcome: val("secRtOutcome"), performedBy: val("secRtBy"), note: val("secRtNote") }).then(function (x) {
          if (!x || !x.ok) { save.disabled = false; document.getElementById("secRtMsg").innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
          c.toast(T(c, "site.admin.security.restoreTestRecorded", "Restore test recorded.")); WSQ.render("admin");
        });
      };
      /* P2.17 anchor acknowledgement (owner only; the form renders only for the owner). Review
       * first, then confirm: acknowledging archives the outside copy, which must stay deliberate. */
      /* G12: one form per chain (clinical, hospital event log), each with its own ids. */
      ["", "event-log"].forEach(function (chain) {
        var sx = ACK_SUFFIX[chain];
        var ackReview = document.getElementById("secAckReview" + sx);
        if (ackReview) ackReview.onclick = function () {
          var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
          var reason = val("secAckReason" + sx), incident = val("secAckIncident" + sx), msg = document.getElementById("secAckMsg" + sx);
          if (reason.length < 20 || !incident) { msg.innerHTML = '<div class="msg err">' + TS(c, "site.admin.security.ackNeeds", "Give a reason of at least 20 characters and the incident reference. The server checks both again.") + "</div>"; return; }
          msg.innerHTML = "";
          document.getElementById("secAckConfirm" + sx).innerHTML = anchorAckConfirmHtml(c, reason, incident, chain);
          document.getElementById("secAckBack" + sx).onclick = function () { document.getElementById("secAckConfirm" + sx).innerHTML = ""; };
          document.getElementById("secAckGo" + sx).onclick = function () {
            var go = document.getElementById("secAckGo" + sx);
            go.disabled = true;
            c.api("/ward/audit-anchor-acknowledge", { orgId: c.state.orgId, reason: reason, incidentRef: incident, chain: chain }).then(function (x) {
              if (!x || !x.ok) { go.disabled = false; msg.innerHTML = '<div class="msg err">' + EN(c, c.esc(refusal(c, x))) + "</div>"; return; }
              c.toast(T(c, "site.admin.security.ackDone", "Restore acknowledged. The outside copies restart from the newest row."));
              WSQ.render("admin");
            });
          };
        };
      });
    });
  }

  // ---- System health (P2.15) ------------------------------------------------------------------
  /* null = loading, {failed} = the report itself did not load. Neither may look like all healthy. */
  function healthLabel(c, s) {
    return {
      up: T(c, "site.admin.health.up", "Up"),
      degraded: T(c, "site.admin.health.degraded", "Degraded"),
      down: T(c, "site.admin.health.down", "Down"),
    }[s];
  }
  /* LT-34: a check time in this browser's own clock, day first, digits only ("15-09-2026 22:15"), never a raw UTC
   * ISO string. Anything that is not a time is shown as it came. */
  function localAt(iso) {
    var d = new Date(iso), p = function (n) { return (n < 10 ? "0" : "") + n; };
    if (!iso || isNaN(d.getTime())) return iso == null ? "" : String(iso);
    return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  function systemHealthHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><h2>' + esc(T(c, "site.admin.health.title", "System health")) + '</h2><span class="spin"></span> ' + esc(T(c, "site.admin.health.checking", "Checking each dependency...")) + "</div>";
    if (r.failed) return '<div class="card"><h2>' + esc(T(c, "site.admin.health.title", "System health")) + '</h2><div class="msg err">' + esc(T(c, "site.admin.health.loadFailedLead", "System health could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) +
      ". " + esc(T(c, "site.admin.health.unknownNote", "The status of every dependency is unknown. This is not the same as everything being up.")) + "</div></div>";
    var head = r.overall === "up" ? '<div class="msg ok">' + esc(T(c, "site.admin.health.allUp", "Every dependency answered its check.")) + "</div>"
      : '<div class="msg err">' + esc(T(c, "site.admin.health.someDown", "{n} of {total} dependencies are not fully up.", { n: r.dependencies.filter(function (d) { return d.status !== "up"; }).length, total: r.dependencies.length })) + "</div>";
    return '<div class="card"><h2>' + esc(T(c, "site.admin.health.title", "System health")) + '</h2><p class="quiet">' + esc(T(c, "site.admin.health.checkedAt", "Checked {at}. Each check gives up after {ms} ms and counts as down.", { at: localAt(r.generatedAt), ms: r.timeoutMs })) + "</p>" + head +
      '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.health.colDependency", "Dependency")) + "</th><th>" + esc(T(c, "site.admin.health.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.admin.health.colChecked", "Checked")) + "</th><th>" + esc(T(c, "site.admin.health.colMeaning", "What it means")) + "</th></tr></thead><tbody>" +
      r.dependencies.map(function (d) {
        // LT-34: never set up (the platform owner's pending choice, or MaiK with no approved model) reads as that, not as a bare Down.
        var label = d.setup ? T(c, "site.admin.health.notSetUp", "Not set up yet") : healthLabel(c, d.status);
        return '<tr class="' + (d.status === "up" ? "" : "warn") + '"><td>' + esc(d.name) + "</td><td><b>" + esc(label || T(c, "site.admin.health.unknown", "Unknown")) + "</b></td><td>" + esc(localAt(d.checkedAt)) + "</td><td>" +
          (d.consequence ? EN(c, esc(d.consequence)) + "<br>" : "") + (d.reason ? '<span class="quiet">' + EN(c, esc(d.reason)) + "</span>" : "") + "</td></tr>";
      }).join("") + '</tbody></table></div><button type="button" class="btn ghost" id="healthRecheck">' + esc(T(c, "site.admin.health.checkAgain", "Check again")) + "</button></div>";
  }
  WSQ._systemHealthHtml = systemHealthHtml;

  function renderHealth(c, body) {
    body.innerHTML = systemHealthHtml(c, null);
    return c.api("/ward/system-health?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      body.innerHTML = systemHealthHtml(c, r && r.ok && r.dependencies ? r : { failed: true, message: refusal(c, r) });
      var again = document.getElementById("healthRecheck");
      if (again) again.onclick = function () { WSQ.render("admin"); };
    }, function () { body.innerHTML = systemHealthHtml(c, { failed: true, message: T(c, "site.admin.err.noResponse", "No response from the server.") }); });
  }

  // ---- Integrations > Webhooks (P2.13) --------------------------------------------------------
  /* null = loading, {failed} = the list did not load. Neither may look like "no webhooks". `shown` is the
   * secret from the registration or rotation that just happened: it is in that one answer only. */
  function whStatusLabel(c, s) {
    return {
      active: T(c, "site.admin.webhooks.status.active", "Active"),
      disabled: T(c, "site.admin.webhooks.status.disabled", "Disabled"),
      "auto-disabled": T(c, "site.admin.webhooks.status.autoDisabled", "Turned off after repeated failures"),
    }[s];
  }
  function webhooksHtml(c, r, shown) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.webhooks.title", "Webhooks")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.webhooks.intro1", "A webhook tells another system that something happened here. It carries the event type and an opaque id only: never a name, a number, a test or a value.")) + " " +
      esc(T(c, "site.admin.webhooks.intro2", "The receiving system reads the details through the WardSynQ FHIR API with its own SMART access, where this hospital's permissions and audit trail apply.")) + " " +
      esc(T(c, "site.admin.webhooks.intro3", "Each call is signed: X-WardSynQ-Signature is HMAC-SHA256 of the X-WardSynQ-Timestamp, a dot, and the body, with the endpoint's secret.")) + "</p>";
    if (r == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.webhooks.loading", "Loading webhooks...")) + "</div>";
    if (r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.webhooks.loadFailedLead", "Webhooks could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.webhooks.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    if (shown && shown.secret) {
      h += '<div class="msg ok">' + esc(T(c, "site.admin.webhooks.secretFor", "Signing secret for {url}:", { url: shown.url })) + ' <code style="user-select:all;word-break:break-all">' + esc(shown.secret) + "</code><br>" + esc(T(c, "site.admin.webhooks.copyNow", "Copy it now. It is not shown again. The previous secret keeps working for 24 hours so the receiving system can be updated.")) + "</div>";
    }
    var label = {};
    (r.eventTypes || []).forEach(function (t) { label[t.id] = t.label; });
    h += "<h3>" + esc(T(c, "site.admin.webhooks.registered", "Registered webhooks")) + "</h3>";
    if (!r.webhooks.length) h += '<p class="quiet">' + esc(T(c, "site.admin.webhooks.none", "No webhooks are registered for this hospital.")) + "</p>";
    else {
      h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.webhooks.colAddress", "Address")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colEvents", "Events")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colLastAttempt", "Last attempt")) + "</th><th></th></tr></thead><tbody>" +
        r.webhooks.map(function (w) {
          var status = "<b>" + esc(whStatusLabel(c, w.status) || w.status) + "</b>" + (w.disabledReason ? '<br><span class="quiet">' + EN(c, esc(w.disabledReason)) + "</span>" : "") +
            (w.consecutiveFailures ? '<br><span class="msg err">' + esc(T(c, "site.admin.webhooks.failedInRow", "{n} failed in a row", { n: w.consecutiveFailures })) + "</span>" : "");
          var last = w.lastAttemptAt ? esc(w.lastAttemptAt) + "<br>" + esc(w.lastOk ? T(c, "site.admin.webhooks.delivered", "Delivered") : T(c, "site.admin.webhooks.failed", "Failed")) + (w.lastResponseCode ? " (" + esc(w.lastResponseCode) + ")" : "") : '<span class="quiet">' + esc(T(c, "site.admin.webhooks.noneYet", "None yet")) + "</span>";
          return '<tr class="' + (w.active ? "" : "warn") + '"><td>' + esc(w.url) + (w.description ? '<br><span class="quiet">' + esc(w.description) + "</span>" : "") +
            (w.payload === "fhir-id-only" ? '<br><span class="pill">' + esc(T(c, "site.admin.webhooks.fhirSubIdOnly", "FHIR Subscription, id only")) + "</span>" : "") + "</td><td>" +
            w.eventTypes.map(function (t) { return esc(label[t] || t); }).join("<br>") + "</td><td>" + status + "</td><td>" + last + "</td><td>" +
            '<button type="button" class="btn ghost" data-wh-test="' + esc(w.id) + '"' + (w.active ? "" : " disabled") + ">" + esc(T(c, "site.admin.webhooks.sendTest", "Send test")) + "</button> " +
            '<button type="button" class="btn ghost" data-wh-log="' + esc(w.id) + '">' + esc(T(c, "site.admin.webhooks.deliveryLog", "Delivery log")) + '</button> ' +
            '<button type="button" class="btn ghost" data-wh-edit="' + esc(w.id) + '">' + esc(T(c, "site.admin.webhooks.changeAddress", "Change address")) + '</button> ' +
            '<button type="button" class="btn ghost" data-wh-rotate="' + esc(w.id) + '">' + esc(T(c, "site.admin.webhooks.rotateSecret", "Rotate secret")) + '</button> ' +
            '<button type="button" class="btn ghost" data-wh-active="' + esc(w.id) + '" data-on="' + (w.active ? "0" : "1") + '">' + esc(w.active ? T(c, "site.admin.webhooks.disable", "Disable") : T(c, "site.admin.webhooks.enable", "Enable")) + "</button></td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    h += '<div id="whLog"></div><div id="whMsg"></div><h3>' + esc(T(c, "site.admin.webhooks.addTitle", "Add a webhook")) + "</h3>";
    if (!r.keyConfigured) return h + '<div class="msg err">' + esc(T(c, "site.admin.webhooks.keyNotConfigured", "Webhook secrets cannot be stored encrypted on this server, so a webhook cannot be added.")) + "</div></div>";
    return h + '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.webhooks.address", "Address (https only)")) + '</span><input type="url" id="whUrl" placeholder="https://"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.webhooks.label", "Label (optional)")) + '</span><input type="text" id="whDesc" maxlength="120"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.webhooks.payload", "Payload")) + '</span><select id="whPayload"><option value="wardsynq">' + esc(T(c, "site.admin.webhooks.payloadWsq", "WardSynQ JSON (event type and id)")) + '</option>' +
      '<option value="fhir-id-only">' + esc(T(c, "site.admin.webhooks.payloadFhir", "FHIR Subscription notification (R4 backport, id only)")) + '</option></select></label></div><div class="row">' +
      (r.eventTypes || []).map(function (t) {
        return '<label class="f" style="flex:0 1 240px"><span><input type="checkbox" class="whType" value="' + esc(t.id) + '"> ' + esc(t.label) + "</span></label>";
      }).join("") + '</div><button type="button" class="btn" id="whAdd">' + esc(T(c, "site.admin.webhooks.addBtn", "Add webhook")) + '</button></div>';
  }
  WSQ._webhooksHtml = webhooksHtml;

  function deliveryStatusLabel(c, s) {
    return {
      delivered: T(c, "site.admin.webhooks.delivery.delivered", "Delivered"),
      failed: T(c, "site.admin.webhooks.delivery.failed", "Failed, will retry"),
      dead: T(c, "site.admin.webhooks.delivery.dead", "Failed for good"),
      skipped: T(c, "site.admin.webhooks.delivery.skipped", "Not sent"),
    }[s];
  }
  /* One endpoint's attempts, newest first, a page at a time. `older` says whether this is past the first page. */
  function webhookDeliveriesHtml(c, d, url, older) {
    var esc = c.esc;
    var h = "<h3>" + esc(url ? T(c, "site.admin.webhooks.deliveryLogFor", "Delivery log for {url}", { url: url }) : T(c, "site.admin.webhooks.deliveryLog", "Delivery log")) + "</h3>";
    if (d == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.webhooks.loadingDeliveries", "Loading deliveries...")) ;
    if (d.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.webhooks.deliveryLogFailedLead", "The delivery log could not be loaded:")) + " " + EN(c, esc(d.message || "failed")) + ". " + esc(T(c, "site.admin.webhooks.notSameAsNoneSent", "This is not the same as nothing having been sent.")) + "</div>";
    var nav = (older ? '<button type="button" class="btn ghost" data-wh-page="">' + esc(T(c, "site.admin.webhooks.newest", "Newest")) + '</button> ' : "") +
      (d.next ? '<button type="button" class="btn ghost" data-wh-page="' + esc(d.next) + '">' + esc(T(c, "site.admin.webhooks.older", "Older")) + '</button>' : "");
    if (!d.deliveries.length) return h + '<p class="quiet">' + esc(older ? T(c, "site.admin.webhooks.noOlder", "No older delivery attempts.") : T(c, "site.admin.webhooks.noneRecorded", "No delivery attempts are recorded for this webhook yet.")) + "</p>" + nav;
    return h + '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.webhooks.colWhen", "When")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colEvent", "Event")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colAttempts", "Attempts")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colResult", "Result")) + "</th><th>" + esc(T(c, "site.admin.webhooks.colResponseCode", "Response code")) + "</th></tr></thead><tbody>" +
      d.deliveries.map(function (x) {
        return '<tr class="' + (x.status === "delivered" ? "" : "warn") + '"><td>' + esc(x.at) + "</td><td>" + esc(x.eventType) + (x.test ? " (" + esc(T(c, "site.admin.webhooks.test", "test")) + ")" : "") + '<br><span class="quiet">' + esc(x.eventId) + "</span></td><td>" + esc(x.attempt) +
          "</td><td>" + esc(deliveryStatusLabel(c, x.status) || x.status) + (x.reason ? '<br><span class="quiet">' + EN(c, esc(x.reason)) + "</span>" : "") + "</td><td>" + (x.responseCode ? esc(x.responseCode) : esc(T(c, "site.admin.webhooks.none2", "none"))) + "</td></tr>";
      }).join("") + "</tbody></table></div>" + nav;
  }
  /* Changing where an endpoint points. The server re-runs the https and public-address checks; the secret stays. */
  function webhookEditHtml(c, w) {
    var esc = c.esc;
    return "<h3>" + esc(T(c, "site.admin.webhooks.changeAddress", "Change address")) + "</h3><p class=\"quiet\">" + esc(T(c, "site.admin.webhooks.changeAddressNote", "The new address is checked like a new webhook (https, a public address). The signing secret does not change.")) + "</p>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.webhooks.address", "Address (https only)")) + '</span><input type="url" id="whEditUrl" value="' + esc(w.url) + '"></label></div>' +
      '<button type="button" class="btn" id="whEditSave" data-id="' + esc(w.id) + '">' + esc(T(c, "site.admin.webhooks.saveAddress", "Save address")) + '</button> <button type="button" class="btn ghost" id="whEditCancel">' + esc(T(c, "site.admin.webhooks.cancel", "Cancel")) + '</button>';
  }
  WSQ._webhookEditHtml = webhookEditHtml;
  WSQ._webhookDeliveriesHtml = webhookDeliveriesHtml;

  // ---- Integrations > Connected apps (SMART) ---------------------------------------------
  /* null = loading, {failed} = the list did not load. Neither may look like "no apps". The scope
   * checkboxes are built from the answer's own scopeCatalog, never from a list kept here: a scope
   * the server would refuse is a scope the screen must not offer. `editingId` is the client shown
   * in the form, or null for adding. Keys are never shown again (the answer carries counts and key
   * ids only), so editing a backend client replaces its keys only when new ones are pasted. */
  var scCache = null;
  function scScopeChecks(c, catalog, kind, selected) {
    var esc = c.esc;
    var groups = kind === "backend" ? [["system", T(c, "site.admin.smart.scope.system", "System (a backend system reads across patients)")], ["special", T(c, "site.admin.smart.scope.special", "Special")]]
      : [["user", T(c, "site.admin.smart.scope.user", "User (reads as the clinician)")], ["patient", T(c, "site.admin.smart.scope.patient", "Patient (confined to one patient)")], ["special", T(c, "site.admin.smart.scope.special", "Special")]];
    var sel = {};
    (selected || []).forEach(function (s) { sel[s] = true; });
    return groups.map(function (g) {
      return '<div style="flex:1 1 220px"><b>' + esc(g[1]) + "</b><br>" + (((catalog && catalog[g[0]]) || []).map(function (s) {
        return '<label class="f" style="font-weight:normal"><span><input type="checkbox" class="scScope" value="' + esc(s) + '"' + (sel[s] ? " checked" : "") + "> <code>" + esc(s) + "</code></span></label>";
      }).join("") || '<span class="quiet">' + esc(T(c, "site.admin.smart.scope.none", "none")) + "</span>") + "</div>";
    }).join("");
  }
  function smartClientsHtml(c, r, editingId) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + esc(T(c, "site.admin.smart.title", "Connected apps (SMART)")) + "</h2>" +
      '<p class="quiet">' + esc(T(c, "site.admin.smart.intro1", "Outside applications this hospital allows to read its record over SMART on FHIR: an app a clinician uses (public), or a registered system with a key (backend).")) + " " +
      esc(T(c, "site.admin.smart.intro2", "Registration is the allowlist: an app not named here gets nothing, and removing one stops its tokens at once. Turning the switch off closes the SMART door for every app.")) + "</p>";
    if (r == null) return h + '<span class="spin"></span> ' + esc(T(c, "site.admin.smart.loading", "Loading connected apps...")) + "</div>";
    if (r.failed) return h + '<div class="msg err">' + esc(T(c, "site.admin.smart.loadFailedLead", "Connected apps could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.smart.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    h += '<label class="f"><span><input type="checkbox" id="scEnabled"' + (r.enabled ? " checked" : "") + "> " + esc(T(c, "site.admin.smart.enabledToggle", "SMART access is on for this hospital")) + "</span></label>";
    var list = r.clients || [];
    h += "<h3>" + esc(T(c, "site.admin.smart.registeredApps", "Registered apps")) + "</h3>";
    if (!list.length) h += '<p class="quiet">' + esc(T(c, "site.admin.smart.noApps", "No connected apps are registered for this hospital. Until one is, no outside application can connect.")) + "</p>";
    else {
      h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.smart.colName", "Name")) + "</th><th>" + esc(T(c, "site.admin.smart.colClientId", "Client ID")) + "</th><th>" + esc(T(c, "site.admin.smart.colKind", "Kind")) + "</th><th>" + esc(T(c, "site.admin.smart.colRedirects", "Redirects")) + "</th><th>" + esc(T(c, "site.admin.smart.colScopes", "Scopes")) + "</th><th>" + esc(T(c, "site.admin.smart.colKeys", "Keys")) + "</th><th></th></tr></thead><tbody>" +
        list.map(function (a) {
          var kids = (a.keys || []).map(function (k) { return k.kid || T(c, "site.admin.smart.noKid", "(no kid)"); }).join(", ");
          var keys = esc(T(c, "site.admin.smart.inlineKeys", "{n} inline", { n: a.keyCount || 0 })) + (kids ? '<br><span class="quiet">' + esc(kids) + "</span>" : "") +
            (a.jwksUri ? '<br><span class="quiet">' + esc(T(c, "site.admin.smart.jwksSet", "JWKS address set")) + "</span>" : "");
          return "<tr><td>" + esc(a.name) + "</td><td><code>" + esc(a.clientId) + "</code></td><td>" + esc(a.kind) + "</td><td>" +
            ((a.redirectUris || []).length ? a.redirectUris.map(function (u) { return esc(u); }).join("<br>") : '<span class="quiet">' + esc(T(c, "site.admin.smart.scope.none", "none")) + "</span>") + "</td><td>" +
            (a.scopes || []).map(function (s) { return "<code>" + esc(s) + "</code>"; }).join("<br>") + "</td><td>" + keys + "</td><td>" +
            '<button type="button" class="btn ghost" data-sc-edit="' + esc(a.clientId) + '">' + esc(T(c, "site.admin.smart.edit", "Edit")) + '</button> ' +
            '<button type="button" class="btn ghost" data-sc-remove="' + esc(a.clientId) + '">' + esc(T(c, "site.admin.smart.remove", "Remove")) + '</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    var ed = null;
    if (editingId) ed = list.filter(function (a) { return a.clientId === editingId; })[0] || null;
    var kind = ed ? ed.kind : "public";
    h += '<div id="scMsg"></div><h3 id="scFormHead">' + esc(ed ? T(c, "site.admin.smart.editTitle", "Edit {id}", { id: ed.clientId }) : T(c, "site.admin.smart.addTitle", "Add a connected app")) + "</h3>" +
      '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.smart.clientId", "Client ID (letters, digits, dot, underscore, hyphen)")) + '</span><input type="text" id="scId" maxlength="64" value="' + esc(ed ? ed.clientId : "") + '"' + (ed ? " disabled" : "") + "></label>" +
      '<label class="f"><span>' + esc(T(c, "site.admin.smart.name", "Name (shown on the consent screen)")) + '</span><input type="text" id="scName" maxlength="120" value="' + esc(ed ? ed.name : "") + '"></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.smart.kind", "Kind")) + '</span><select id="scKind"><option value="public"' + (kind === "public" ? " selected" : "") + ">" + esc(T(c, "site.admin.smart.kindPublic", "Public (an app a clinician uses)")) + "</option>" +
      '<option value="backend"' + (kind === "backend" ? " selected" : "") + ">" + esc(T(c, "site.admin.smart.kindBackend", "Backend (a system with a key)")) + "</option></select></label></div>" +
      '<div class="row" id="scRedirectWrap" style="' + (kind === "public" ? "" : "display:none") + '"><label class="f"><span>' + esc(T(c, "site.admin.smart.redirects", "Redirect URIs, one per line (https, no fragment)")) + '</span><textarea id="scRedirects" rows="2">' +
      esc(ed ? (ed.redirectUris || []).join("\n") : "") + "</textarea></label></div>" +
      '<div id="scBackendWrap" style="' + (kind === "backend" ? "" : "display:none") + '"><div class="row"><label class="f"><span>' + esc(T(c, "site.admin.smart.publicKeys", "Public keys (JWKS JSON with a keys list)")) + '</span><textarea id="scJwks" rows="3" placeholder=\'{"keys": [...]}\'></textarea></label>' +
      '<label class="f"><span>' + esc(T(c, "site.admin.smart.jwksAddress", "Or a JWKS address (https)")) + '</span><input type="url" id="scJwksUri" placeholder="https://"></label></div>' +
      '<p class="quiet">' + esc(T(c, "site.admin.smart.publicOnly", "Send only the public half. A private key is refused, never stored.")) + (ed ? " " + esc(T(c, "site.admin.smart.keysNeverShown", "Keys are never shown again: paste them only to replace what is registered.")) : "") + "</p></div>" +
      "<h3>" + esc(T(c, "site.admin.smart.scopesTitle", "Scopes")) + "</h3>" + '<div class="row" id="scScopes">' + scScopeChecks(c, r.scopeCatalog || {}, kind, ed ? ed.scopes : []) + "</div>" +
      '<button type="button" class="btn" id="scSave"' + (ed ? ' data-sc-editing="' + esc(ed.clientId) + '"' : "") + ">" + esc(ed ? T(c, "site.admin.smart.saveChanges", "Save changes") : T(c, "site.admin.smart.addApp", "Add connected app")) + "</button>";
    if (ed) h += ' <button type="button" class="btn ghost" id="scCancel">' + esc(T(c, "site.admin.smart.cancel", "Cancel")) + '</button>';
    return h + "</div>";
  }
  WSQ._smartClientsHtml = smartClientsHtml;

  function bindSmart(c, body) {
    var msg = function (t) { var m = document.getElementById("scMsg"); if (m) m.innerHTML = '<div class="msg err">' + c.esc(t) + "</div>"; };
    var en = document.getElementById("scEnabled");
    if (en) en.onchange = function () {
      var want = en.checked;
      en.disabled = true;
      c.api("/ward/smart-enable", { orgId: c.state.orgId, enabled: want }).then(function (x) {
        if (!x || !x.ok) { en.disabled = false; en.checked = !want; msg(refusal(c, x)); return; }
        c.toast(want ? T(c, "site.admin.smart.savedOn", "SMART access is on for this hospital.") : T(c, "site.admin.smart.savedOff", "SMART access is off. No outside app can connect until it is back on."));
        renderIntegrations(c, body);
      }, function () { en.disabled = false; en.checked = !want; msg(T(c, "site.admin.smart.switchNoResponse", "No response from the server. The switch may not have moved; reload to check.")); });
    };
    var kind = document.getElementById("scKind");
    var paintScopes = function () {
      var box = document.getElementById("scScopes");
      var k = document.getElementById("scKind");
      var isB = !!(k && k.value === "backend");
      var rw = document.getElementById("scRedirectWrap"), bw = document.getElementById("scBackendWrap");
      if (rw) rw.style.display = isB ? "none" : "";
      if (bw) bw.style.display = isB ? "" : "none";
      if (!box || !scCache || !scCache.scopeCatalog) return;
      var keep = {};
      box.querySelectorAll(".scScope").forEach(function (b) { if (b.checked) keep[b.value] = true; });
      box.innerHTML = scScopeChecks(c, scCache.scopeCatalog, isB ? "backend" : "public", Object.keys(keep));
    };
    if (kind) kind.onchange = paintScopes;
    var cancel = document.getElementById("scCancel");
    if (cancel) cancel.onclick = function () {
      var card = document.getElementById("scCard");
      card.innerHTML = smartClientsHtml(c, scCache, null);
      bindSmart(c, body);
    };
    var save = document.getElementById("scSave");
    if (save) save.onclick = function () {
      var editing = save.getAttribute("data-sc-editing") || "";
      var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
      var k = val("scKind") === "backend" ? "backend" : "public";
      var scopes = [];
      document.querySelectorAll(".scScope").forEach(function (b) { if (b.checked) scopes.push(b.value); });
      var client = { clientId: editing || val("scId"), name: val("scName"), kind: k,
        redirectUris: val("scRedirects").split("\n").map(function (s) { return s.trim(); }).filter(Boolean), scopes: scopes };
      if (k === "backend") {
        var jwt = val("scJwks");
        if (jwt) {
          try { client.jwks = JSON.parse(jwt); }
          catch (e) { msg(T(c, "site.admin.smart.badKeysJson", "The keys are not valid JSON: {why}", { why: e.message })); return; }
        } else if (!editing) {
          /* A new backend client with neither keys nor address is the server's refusal, with the
           * field named; an edit may keep what is registered, so it is allowed through. */
        }
        client.jwksUri = val("scJwksUri");
      }
      save.disabled = true;
      c.api("/ward/smart-client-save", { orgId: c.state.orgId, client: client }).then(function (x) {
        if (!x || !x.ok) { save.disabled = false; msg(refusal(c, x)); return; }
        c.toast(editing ? T(c, "site.admin.smart.updated", "Connected app updated.") : T(c, "site.admin.smart.registered", "Connected app registered."));
        renderIntegrations(c, body);
      }, function () { save.disabled = false; msg(T(c, "site.admin.smart.saveNoResponse", "No response from the server. The app may not have been saved; reload to check.")); });
    };
    body.querySelectorAll("[data-sc-edit]").forEach(function (b) {
      b.onclick = function () {
        var card = document.getElementById("scCard");
        card.innerHTML = smartClientsHtml(c, scCache, b.getAttribute("data-sc-edit"));
        bindSmart(c, body);
        var head = document.getElementById("scFormHead");
        if (head && head.scrollIntoView) head.scrollIntoView();
      };
    });
    body.querySelectorAll("[data-sc-remove]").forEach(function (b) {
      b.onclick = function () {
        var id = b.getAttribute("data-sc-remove");
        if (!window.confirm(T(c, "site.admin.smart.removeConfirm", "Remove {id}? Its tokens stop working at once, and it cannot connect again until it is re-registered.", { id: id }))) return;
        b.disabled = true;
        c.api("/ward/smart-client-remove", { orgId: c.state.orgId, clientId: id }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; msg(refusal(c, x)); return; }
          c.toast(T(c, "site.admin.smart.removed", "Connected app removed. Its tokens no longer work."));
          renderIntegrations(c, body);
        }, function () { b.disabled = false; msg(T(c, "site.admin.smart.removeNoResponse", "No response from the server. The app may not have been removed; reload to check.")); });
      };
    });
  }

  // ---- Integrations > Connectors (owner S2, S4, S5) -------------------------------------------
  /* The hospital's own imaging archive, payers and payment gateway. Every form is drawn from the
   * server's catalogue, so a field the server does not take is never offered. Credentials are typed in
   * and never shown again: the list says which are set and when. null = loading, {failed} = not loaded. */
  var CN_STATE = { editing: null, result: {} };
  function connectorFormHtml(c, kind, cur) {
    var esc = c.esc;
    var provs = kind.providers;
    var pid = (cur && cur.provider) || CN_STATE.provider && CN_STATE.provider[kind.kind] || provs[0].id;
    var p = provs.filter(function (x) { return x.id === pid; })[0] || provs[0];
    var settings = (cur && cur.settings) || {}, set = (cur && cur.secretsSet) || [];
    var h = '<div class="cnForm" data-cn-kind="' + esc(kind.kind) + '"><h3>' + esc(cur ? T(c, "site.admin.connectors.change", "Change {name}", { name: cur.name || cur.id }) : T(c, "site.admin.connectors.add", "Add")) + "</h3>";
    h += '<div class="row"><label class="f"><span>' + esc(T(c, "site.admin.connectors.provider", "Provider")) + '</span><select class="cnProvider">' + provs.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === p.id ? " selected" : "") + ">" + esc(x.label) + "</option>";
    }).join("") + "</select></label>" +
      '<label class="f"><span>' + esc(T(c, "site.admin.connectors.label", "Label (optional)")) + '</span><input class="cnName" maxlength="120" value="' + esc((cur && cur.name) || "") + '"></label></div>';
    if (p.help) h += '<p class="quiet">' + esc(p.help) + "</p>";
    h += '<div class="row">' + p.settings.map(function (f) {
      var v = settings[f.key];
      if (f.type === "checkbox") return '<label class="f"><span><input type="checkbox" class="cnSet" data-key="' + esc(f.key) + '" data-type="checkbox"' + (v ? " checked" : "") + "> " + esc(f.label) + "</span></label>";
      if (f.type === "select") return '<label class="f"><span>' + esc(f.label) + '</span><select class="cnSet" data-key="' + esc(f.key) + '">' + f.options.map(function (o) {
        return '<option value="' + esc(o[0]) + '"' + (v === o[0] ? " selected" : "") + ">" + esc(o[1]) + "</option>"; }).join("") + "</select></label>";
      return '<label class="f"><span>' + esc(f.label) + (f.required ? " *" : "") + '</span><input class="cnSet" data-key="' + esc(f.key) + '"' + (f.type === "url" ? ' type="url" placeholder="https://"' : "") +
        ' value="' + esc(v == null ? "" : v) + '"' + (cur && f.key === "ref" ? " readonly" : "") + "></label>";
    }).join("") + "</div>";
    if (p.secrets.length) h += '<div class="row">' + p.secrets.map(function (f) {
      var isSet = cur && cur.provider === p.id && set.indexOf(f.key) >= 0;
      return '<label class="f"><span>' + esc(f.label) + (isSet ? " " + esc(T(c, "site.admin.connectors.secretSet", "(set; leave blank to keep, type a new one to rotate)")) : "") + '</span><input type="password" autocomplete="new-password" class="cnSecret" data-key="' + esc(f.key) + '"></label>';
    }).join("") + "</div>";
    return h + '<button type="button" class="btn" data-cn-save="' + esc(kind.kind) + '"' + (cur ? ' data-cn-id="' + esc(cur.id) + '"' : "") + ">" + esc(T(c, "site.admin.save", "Save")) + "</button>" +
      (cur ? ' <button type="button" class="btn ghost" data-cn-cancel="1">' + esc(T(c, "site.admin.connectors.cancel", "Cancel")) + '</button>' : "") + "</div>";
  }
  function connectorsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><h2>' + esc(T(c, "site.admin.connectors.title", "Connectors")) + '</h2><span class="spin"></span> ' + esc(T(c, "site.admin.connectors.loading", "Loading connectors...")) + "</div>";
    if (r.failed) return '<div class="card"><h2>' + esc(T(c, "site.admin.connectors.title", "Connectors")) + '</h2><div class="msg err">' + esc(T(c, "site.admin.connectors.loadFailedLead", "Connectors could not be loaded:")) + " " + EN(c, esc(r.message || "failed")) + ". " + esc(T(c, "site.admin.connectors.notSameAsNone", "This is not the same as there being none.")) + "</div></div>";
    return r.catalogue.filter(function (kind) { return kind.kind !== "abdm"; }).map(function (kind) {   // ABDM: pages/abdm.js
      var mine = r.connectors.filter(function (x) { return x.kind === kind.kind; });
      var h = '<div class="card"><h2>' + esc(kind.label) + "</h2>" + (kind.help ? '<p class="quiet">' + esc(kind.help) + "</p>" : "");
      if (!mine.length) h += '<p class="quiet">' + esc(T(c, "site.admin.connectors.none", "None configured for this hospital.")) + "</p>";
      else h += '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.admin.connectors.colConnector", "Connector")) + "</th><th>" + esc(T(c, "site.admin.connectors.colProvider", "Provider")) + "</th><th>" + esc(T(c, "site.admin.connectors.colStatus", "Status")) + "</th><th>" + esc(T(c, "site.admin.connectors.colCredentials", "Credentials")) + "</th><th></th></tr></thead><tbody>" + mine.map(function (x) {
        var prov = kind.providers.filter(function (p) { return p.id === x.provider; })[0] || {};
        var res = CN_STATE.result[x.id];
        /* The gateway's webhook goes to this address. It names the hospital only; the gateway's signature is what is trusted. */
        var callback = x.kind === "payment" && x.provider !== "manual"
          ? '<br><span class="quiet">' + esc(T(c, "site.admin.connectors.gatewayWebhook", "Gateway webhook address:")) + ' <code style="user-select:all;word-break:break-all">' + esc(location.origin + "/api/queue/payment-callback/" + encodeURIComponent(c.state.orgId)) + "</code></span>" : "";
        return '<tr class="' + (x.active ? "" : "warn") + '"><td>' + esc(x.name || x.id) + callback + (res ? '<br><span class="msg ' + (res.passed ? "ok" : "err") + '">' + esc(res.detail) + "</span>" : "") + "</td><td>" + esc(prov.label || x.provider) + "</td><td><b>" + esc(x.active ? T(c, "site.admin.connectors.on", "On") : T(c, "site.admin.connectors.off", "Off")) + "</b></td><td>" +
          (x.secretsSet.length ? esc(x.secretsSet.join(", ")) + '<br><span class="quiet">' + esc(T(c, "site.admin.connectors.setAt", "set {at}", { at: x.secretsSetAt || "" })) + "</span>" : '<span class="quiet">' + esc(T(c, "site.admin.connectors.noneSet", "none")) + "</span>") + "</td><td>" +
          '<button type="button" class="btn ghost" data-cn-edit="' + esc(x.id) + '">' + esc(T(c, "site.admin.connectors.change2", "Change")) + '</button> ' +
          (prov.testable ? '<button type="button" class="btn ghost" data-cn-test="' + esc(x.id) + '">' + esc(T(c, "site.admin.connectors.testConnection", "Test connection")) + '</button> ' : "") +
          '<button type="button" class="btn ghost" data-cn-active="' + esc(x.id) + '" data-on="' + (x.active ? "0" : "1") + '">' + esc(x.active ? T(c, "site.admin.connectors.turnOff", "Turn off") : T(c, "site.admin.connectors.turnOn", "Turn on")) + "</button></td></tr>";
      }).join("") + "</tbody></table></div>";
      var editing = mine.filter(function (x) { return x.id === CN_STATE.editing; })[0];
      if (!r.keyConfigured) h += '<div class="msg err">' + esc(T(c, "site.admin.connectors.keyNotConfigured", "Credentials cannot be stored encrypted on this server, so a connector with credentials cannot be saved.")) + "</div>";
      if (editing) h += connectorFormHtml(c, kind, editing);
      else if (!(kind.singleton && mine.length)) h += connectorFormHtml(c, kind, null);
      return h + '<div class="cnMsg" data-cn-msg="' + esc(kind.kind) + '"></div></div>';
    }).join("");
  }
  WSQ._connectorsHtml = connectorsHtml;
  function loadConnectors(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    var card = document.getElementById("cnCard");
    if (!card) return;
    c.api("/ward/connectors" + q).then(function (r) {
      var ok = r && r.ok && r.catalogue && r.connectors;
      card.innerHTML = connectorsHtml(c, ok ? r : { failed: true, message: r ? refusal(c, r) : T(c, "site.admin.err.noResponse", "No response from the server.") });
      if (ok) bindConnectors(c, body, r);
    }, function () { card.innerHTML = connectorsHtml(c, { failed: true, message: T(c, "site.admin.err.noResponse", "No response from the server.") }); });
  }
  function bindConnectors(c, body, r) {
    var card = document.getElementById("cnCard");
    var say = function (kind, t, ok) { var m = card.querySelector('[data-cn-msg="' + kind + '"]'); if (m) m.innerHTML = '<div class="msg ' + (ok ? "ok" : "err") + '">' + c.esc(t) + "</div>"; };
    var byId = function (id) { return r.connectors.filter(function (x) { return x.id === id; })[0]; };
    card.querySelectorAll(".cnProvider").forEach(function (sel) {
      sel.onchange = function () {
        var form = sel.closest(".cnForm"), kind = form.getAttribute("data-cn-kind");
        CN_STATE.provider = CN_STATE.provider || {}; CN_STATE.provider[kind] = sel.value;
        var k = r.catalogue.filter(function (x) { return x.kind === kind; })[0];
        var cur = CN_STATE.editing ? byId(CN_STATE.editing) : null;
        var shadow = document.createElement("div");
        // Another provider starts with no settings and no credentials set: the old ones do not carry over.
        var same = cur && cur.provider === sel.value;
        shadow.innerHTML = connectorFormHtml(c, k, cur ? Object.assign({}, cur, { provider: sel.value, settings: same ? cur.settings : { ref: cur.settings.ref }, secretsSet: same ? cur.secretsSet : [] }) : null);
        form.parentNode.replaceChild(shadow.firstChild, form);
        bindConnectors(c, body, r);
      };
    });
    card.querySelectorAll("[data-cn-save]").forEach(function (b) {
      b.onclick = function () {
        var form = b.closest(".cnForm"), kind = b.getAttribute("data-cn-save");
        var settings = {}, secrets = {};
        form.querySelectorAll(".cnSet").forEach(function (i) { settings[i.getAttribute("data-key")] = i.getAttribute("data-type") === "checkbox" ? i.checked : String(i.value || "").trim(); });
        form.querySelectorAll(".cnSecret").forEach(function (i) { if (String(i.value || "").trim()) secrets[i.getAttribute("data-key")] = String(i.value).trim(); });
        b.disabled = true;
        c.api("/ward/connector-save", { orgId: c.state.orgId, kind: kind, provider: form.querySelector(".cnProvider").value, name: form.querySelector(".cnName").value,
          settings: settings, secrets: Object.keys(secrets).length ? secrets : undefined, id: b.getAttribute("data-cn-id") || undefined }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; say(kind, refusal(c, x)); return; }
          form.querySelectorAll(".cnSecret").forEach(function (i) { i.value = ""; });
          CN_STATE.editing = null;
          c.toast(x.unchanged ? T(c, "site.admin.connectors.nothingChanged", "Nothing changed.") : T(c, "site.admin.connectors.saved", "Connector saved.") + (x.secretsNote ? " " + x.secretsNote : ""));
          loadConnectors(c, body);
        }, function () { b.disabled = false; say(kind, T(c, "site.admin.connectors.saveNoResponse", "No response from the server. The connector may not have been saved; reload to check.")); });
      };
    });
    card.querySelectorAll("[data-cn-edit]").forEach(function (b) { b.onclick = function () { CN_STATE.editing = b.getAttribute("data-cn-edit"); card.innerHTML = connectorsHtml(c, r); bindConnectors(c, body, r); }; });
    card.querySelectorAll("[data-cn-cancel]").forEach(function (b) { b.onclick = function () { CN_STATE.editing = null; card.innerHTML = connectorsHtml(c, r); bindConnectors(c, body, r); }; });
    card.querySelectorAll("[data-cn-test]").forEach(function (b) {
      b.onclick = function () {
        var x = byId(b.getAttribute("data-cn-test"));
        b.disabled = true;
        c.api("/ward/connector-test", { orgId: c.state.orgId, id: x.id }).then(function (t) {
          b.disabled = false;
          if (!t || !t.ok || !t.test) { say(x.kind, refusal(c, t)); return; }
          CN_STATE.result[x.id] = t.test;
          card.innerHTML = connectorsHtml(c, r); bindConnectors(c, body, r);
        }, function () { b.disabled = false; say(x.kind, T(c, "site.admin.connectors.testUnknown", "No response from the server. The test result is not known.")); });
      };
    });
    card.querySelectorAll("[data-cn-active]").forEach(function (b) {
      b.onclick = function () {
        var x = byId(b.getAttribute("data-cn-active")), on = b.getAttribute("data-on") === "1";
        b.disabled = true;
        c.api("/ward/connector-save", { orgId: c.state.orgId, kind: x.kind, provider: x.provider, name: x.name, settings: x.settings, active: on }).then(function (y) {
          if (!y || !y.ok) { b.disabled = false; say(x.kind, refusal(c, y)); return; }
          c.toast(on ? T(c, "site.admin.connectors.turnedOn", "Connector turned on.") : T(c, "site.admin.connectors.turnedOff", "Connector turned off.")); loadConnectors(c, body);
        }, function () { b.disabled = false; say(x.kind, T(c, "site.admin.connectors.switchNoResponse", "No response from the server. The switch may not have moved; reload to check.")); });
      };
    });
  }

  function renderIntegrations(c, body, shown) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = '<div id="cnCard">' + connectorsHtml(c, null) + '</div><div id="abdmCard"></div><div id="whCard">' + webhooksHtml(c, null) + '</div><div id="scCard">' + smartClientsHtml(c, null) + "</div>";
    loadConnectors(c, body);
    if (WSQ._abdmLoad) WSQ._abdmLoad(c);   // pages/abdm.js: the ABDM connector has its own card
    var fail = function (r) { return { failed: true, message: r ? refusal(c, r) : T(c, "site.admin.err.noResponse", "No response from the server.") }; };
    /* The connected-apps card loads beside the webhooks, into its own wrapper, so whichever answer
     * arrives first is never wiped by the other. */
    c.api("/ward/smart-clients" + q).then(function (sc) {
      var card = document.getElementById("scCard");
      if (!card) return;
      scCache = (sc && sc.ok && sc.clients && sc.scopeCatalog) ? sc : null;
      card.innerHTML = smartClientsHtml(c, scCache || fail(sc));
      if (scCache) bindSmart(c, body);
    }, function () {
      var card = document.getElementById("scCard");
      if (card) card.innerHTML = smartClientsHtml(c, fail(null));
    });
    return c.api("/ward/webhooks" + q).then(function (r) {
      var wh = document.getElementById("whCard");
      if (wh) wh.innerHTML = webhooksHtml(c, r && r.ok && r.webhooks ? r : fail(r), shown);
      else body.innerHTML = webhooksHtml(c, r && r.ok && r.webhooks ? r : fail(r), shown);
      if (!r || !r.ok) return;
      var msg = function (t) { document.getElementById("whMsg").innerHTML = '<div class="msg err">' + c.esc(t) + "</div>"; };
      var urlOf = function (id) { var w = r.webhooks.filter(function (x) { return x.id === id; })[0]; return w ? w.url : ""; };
      var add = document.getElementById("whAdd");
      if (add) add.onclick = function () {
        var types = [];
        document.querySelectorAll(".whType").forEach(function (b) { if (b.checked) types.push(b.value); });
        var url = String(document.getElementById("whUrl").value || "").trim();
        if (!/^https:\/\//i.test(url)) { msg(T(c, "site.admin.webhooks.errHttps", "The address must start with https://.")); return; }
        if (!types.length) { msg(T(c, "site.admin.webhooks.errEvent", "Choose at least one event.")); return; }
        add.disabled = true;
        c.api("/ward/webhook", { orgId: c.state.orgId, url: url, eventTypes: types, description: document.getElementById("whDesc").value, payload: document.getElementById("whPayload").value }).then(function (x) {
          if (!x || !x.ok || !x.secret) { add.disabled = false; msg(refusal(c, x)); return; }
          renderIntegrations(c, body, { url: x.webhook.url, secret: x.secret });
        }, function () { add.disabled = false; msg(T(c, "site.admin.webhooks.addNoResponse", "No response from the server. The webhook may not have been added; reload to check.")); });
      };
      body.querySelectorAll("[data-wh-rotate]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-wh-rotate");
          if (!window.confirm(T(c, "site.admin.webhooks.rotateConfirm", "Make a new signing secret? The current one keeps working for 24 hours."))) return;
          b.disabled = true;
          c.api("/ward/webhook-rotate", { orgId: c.state.orgId, id: id }).then(function (x) {
            if (!x || !x.ok || !x.secret) { b.disabled = false; msg(refusal(c, x)); return; }
            renderIntegrations(c, body, { url: urlOf(id), secret: x.secret });
          });
        };
      });
      body.querySelectorAll("[data-wh-active]").forEach(function (b) {
        b.onclick = function () {
          var on = b.getAttribute("data-on") === "1";
          b.disabled = true;
          c.api("/ward/webhook-update", { orgId: c.state.orgId, id: b.getAttribute("data-wh-active"), active: on }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; msg(refusal(c, x)); return; }
            c.toast(on ? T(c, "site.admin.webhooks.enabled", "Webhook enabled.") : T(c, "site.admin.webhooks.disabled", "Webhook disabled. Nothing more is sent to it.")); renderIntegrations(c, body);
          });
        };
      });
      body.querySelectorAll("[data-wh-test]").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          c.api("/ward/webhook-test", { orgId: c.state.orgId, id: b.getAttribute("data-wh-test") }).then(function (x) {
            b.disabled = false;
            if (!x || !x.ok) { msg(refusal(c, x)); return; }
            c.toast(T(c, "site.admin.webhooks.testDelivered", "Test event delivered (response {code}).", { code: x.responseCode }));
          });
        };
      });
      var showLog = function (id, before) {
        var log = document.getElementById("whLog");
        log.innerHTML = webhookDeliveriesHtml(c, null, urlOf(id));
        c.api("/ward/webhook-deliveries" + q + "&id=" + encodeURIComponent(id) + (before ? "&before=" + encodeURIComponent(before) : "")).then(function (d) {
          log.innerHTML = webhookDeliveriesHtml(c, d && d.ok && d.deliveries ? d : fail(d), urlOf(id), !!before);
          log.querySelectorAll("[data-wh-page]").forEach(function (p) { p.onclick = function () { showLog(id, p.getAttribute("data-wh-page")); }; });
        }, function () { log.innerHTML = webhookDeliveriesHtml(c, fail(null), urlOf(id), !!before); });
      };
      body.querySelectorAll("[data-wh-log]").forEach(function (b) {
        b.onclick = function () { showLog(b.getAttribute("data-wh-log"), ""); };
      });
      body.querySelectorAll("[data-wh-edit]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-wh-edit"), log = document.getElementById("whLog");
          log.innerHTML = webhookEditHtml(c, { id: id, url: urlOf(id) });
          document.getElementById("whEditCancel").onclick = function () { log.innerHTML = ""; };
          var save = document.getElementById("whEditSave");
          save.onclick = function () {
            var url = String(document.getElementById("whEditUrl").value || "").trim();
            if (!/^https:\/\//i.test(url)) { msg(T(c, "site.admin.webhooks.errHttps", "The address must start with https://.")); return; }
            save.disabled = true;
            c.api("/ward/webhook-update", { orgId: c.state.orgId, id: id, url: url }).then(function (x) {
              if (!x || !x.ok) { save.disabled = false; msg(refusal(c, x)); return; }
              c.toast(x.unchanged ? T(c, "site.admin.webhooks.alreadyAddress", "That is already the address.") : T(c, "site.admin.webhooks.addressChanged", "Address changed. The signing secret is the same.")); renderIntegrations(c, body);
            }, function () { save.disabled = false; msg(T(c, "site.admin.webhooks.addressNoResponse", "No response from the server. The address may not have changed; reload to check.")); });
          };
        };
      });
    }, function () {
      var wh = document.getElementById("whCard");
      if (wh) wh.innerHTML = webhooksHtml(c, fail(null));
      else body.innerHTML = webhooksHtml(c, fail(null));
    });
  }
})();
