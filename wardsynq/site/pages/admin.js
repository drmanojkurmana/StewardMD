/* wardsynq/site/pages/admin.js - wardsynq.com Admin Center: hospital, departments, wards/beds, rooms,
 * staff and roles. Buildless ES5, registers onto the global WSQ (window.WSQ, set by shell.js) the same
 * way every page in this directory does. Every button here calls a real /api/queue route - see
 * functions/api/queue/[[path]].js and functions/_opd_org_store.js for what each one accepts.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  // Bed states, verbatim from functions/_opd_org.js BED_STATES - never invented here.
  var BED_STATES = ["available", "reserved", "occupied", "blocked", "cleaning", "maintenance"];

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
  var ROLE_NOTES = [
    ["admin", "Full technical administration: staff, wards, beds, departments, rooms, billing config. Not clinical protocol sign-off."],
    ["doctor", "Full clinical workflow: queue, EMR, orders, prescriptions, own patients."],
    ["nurse", "Runs the queue at the desk, records vitals, gives medicines at the bedside (eMAR). No prescribing."],
    ["reception", "Registers and checks in patients, assigns to a doctor. Reads the chart, cannot edit it."],
    ["pharmacy", "Reads and dispenses medication orders, verifies an order against the chart. No consultation notes."],
    ["lab", "Sees ordered tests and releases results. No other chart access."],
    ["billing", "Reads charges, invoices and claims. Cannot take payment (see Cashier for that)."],
    ["him", "Reads the chart to decide and record release-of-information requests."],
    ["blood_bank", "Crossmatches, issues and administers transfusions only."],
    ["radiographer", "Acquires the imaging study. Reads the chart, cannot file a report or protocol a study."],
    ["radiologist", "Protocols and reports imaging studies (the same authority a lab result release uses). No other chart write."],
  ];

  // The only actions the staff table sends to /member/<action>; anything else sends nothing.
  var MEMBER_ACTION_ROUTE = { disable: "disable", restore: "restore", reset: "reset" };

  function refusal(r) {
    if (!r) return "No response from the server.";
    if (r.message) return r.message;
    if (r.reasons) return (r.error || "refused") + ": " + (Array.isArray(r.reasons) ? r.reasons.join(", ") : String(r.reasons));
    return r.error || "failed";
  }

  var TABS = [["hospital", "Hospital"], ["departments", "Departments"], ["wards", "Wards and beds"], ["rooms", "Rooms"], ["staff", "Staff and roles"], ["tariff", "Price list"], ["advisories", "Safety reminders"], ["forms", "Forms"], ["pathways", "Clinical pathways"], ["group", "Hospital group"]];

  WSQ.page("admin", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("staff.admin")) {
      el.innerHTML = '<div class="title"><h1>Admin Center</h1></div>' +
        '<div class="msg note">Your role does not include staff.admin, so the Admin Center is not available to you.</div>';
      return;
    }
    var tabs = TABS.slice();
    if (c.isWardsynq()) tabs.push(["seed", "Clinical seed data"], ["maik", "MaiK clinical AI"], ["security", "Security review"], ["health", "System health"], ["export", "Data export"], ["fhir", "FHIR"], ["integrations", "Integrations"]);
    var tab = st._adminTab || "hospital";
    if ((tab === "seed" || tab === "maik" || tab === "security" || tab === "health" || tab === "export" || tab === "fhir" || tab === "integrations") && !c.isWardsynq()) tab = "hospital";
    el.innerHTML = '<div class="title"><h1>Admin Center</h1><span class="sub">' + c.esc((st.org && st.org.name) || "") + '</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + c.esc(t[1]) + "</button>";
      }).join("") + '</div><div id="adminBody"><span class="spin"></span></div>';
    el.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { st._adminTab = b.getAttribute("data-tab"); WSQ.render("admin"); };
    });
    var body = document.getElementById("adminBody");
    var renderers = { seed: renderSeed, hospital: renderHospital, departments: renderDepts, wards: renderWards, rooms: renderRooms, staff: renderStaff, maik: renderMaik, security: renderSecurity, health: renderHealth, export: renderExport, fhir: renderFhir, integrations: renderIntegrations, tariff: renderTariff, advisories: renderAdvisories, forms: renderForms, pathways: renderPathways, group: renderGroup };
    return renderers[tab](c, body);
  } });

  // ---- Clinical seed data (D10) ------------------------------------------------------------------
  /* Clinical content that ships with WardSynQ (allergy classes, dose ceilings, default critical limits and
   * the other seed lists), item by item. An item is UNAPPROVED until signed off by the named signatory for its
   * CURRENT content; a signed item whose content later changed is unapproved again (the server decides by
   * fingerprint). Every hospital admin sees the state; only the StewardMD platform owner is offered sign-off,
   * and the server refuses anyone else. r: undefined = loading, { failed } = could not be loaded. */
  function seedHtml(esc, r) {
    var h = '<div class="card"><h2>Clinical seed data</h2>';
    if (r === undefined) return h + '<p><span class="spin"></span> Loading...</p></div>';
    if (r.failed) return h + '<div class="msg err">The sign-off state could not be loaded: ' + esc(r.message || "failed") + ". Treat every item as UNAPPROVED.</div></div>";
    var total = 0, unapproved = 0;
    r.lists.forEach(function (l) { total += l.items.length; unapproved += l.unapproved; });
    return h + '<p class="quiet">Clinical content shipped with WardSynQ. Each item is UNAPPROVED until ' + esc(r.signatory) + " signs off its exact current content. " +
      "Signing records the sign-off; it does not change how any safety check behaves.</p>" +
      '<p><span class="pill ' + (unapproved ? "warn" : "ok") + '">' + unapproved + " of " + total + " items unapproved</span></p>" +
      r.lists.map(function (l) {
        return "<h3>" + esc(l.title) + ' <span class="quiet">(' + esc(l.source) + ")</span></h3>" +
          '<div class="tbl"><table><thead><tr><th>Item</th><th>Version</th><th>Sign-off</th>' + (r.canSign ? "<th></th>" : "") + "</tr></thead><tbody>" +
          l.items.map(function (it) {
            var signed = it.status === "signed";
            return '<tr data-seed="' + esc(l.id) + "/" + esc(it.id) + '"><td>' + esc(it.label) + '<details><summary class="quiet">content</summary><pre style="white-space:pre-wrap;max-width:60ch">' + esc(it.content) + "</pre></details></td>" +
              '<td class="mono">' + esc(it.version) + "</td>" +
              "<td>" + (signed ? '<span class="pill ok">' + esc(it.signoff.text) + "</span>" : '<span class="pill stop">UNAPPROVED</span>') + "</td>" +
              (r.canSign ? "<td>" + (signed ? "" : '<button type="button" class="btn ghost" data-seed-sign="' + esc(l.id) + '" data-seed-item="' + esc(it.id) + '" data-seed-hash="' + esc(it.contentHash) + '">Sign off</button>') + "</td>" : "") + "</tr>";
          }).join("") + "</tbody></table></div>";
      }).join("") + '<div id="seedMsg"></div></div>';
  }
  WSQ._seedHtml = seedHtml;
  function renderSeed(c, body) {
    body.innerHTML = seedHtml(c.esc, undefined);
    return c.api("/seed/status?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      body.innerHTML = seedHtml(c.esc, r && r.ok ? r : { failed: true, message: refusal(r) });
      body.querySelectorAll("[data-seed-sign]").forEach(function (b) {
        b.onclick = function () {
          var name = window.prompt("Sign off this item's content as shown.\n\nType the signatory's name exactly (" + r.signatory + "):", "");
          if (name == null) return;
          if (!window.confirm("I have reviewed the content of " + b.getAttribute("data-seed-item") + " and sign it off as " + name + ".")) return;
          b.disabled = true;
          c.api("/seed/signoff", { listId: b.getAttribute("data-seed-sign"), itemId: b.getAttribute("data-seed-item"), contentHash: b.getAttribute("data-seed-hash"), signatory: name, attest: true }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; document.getElementById("seedMsg").innerHTML = '<div class="msg err">Not signed: ' + c.esc(refusal(x)) + "</div>"; return; }
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
    return '<div class="card"><h2>' + c.ms("edit_note") + " Who may write a clinical note</h2>" +
      '<p class="quiet">Doctors and admins can always write a note. Tick any other role your hospital trusts to document on the patient timeline. This lets them write a note and nothing else: it does not let them prescribe, order or change anything.</p>' +
      '<div class="row">' + NOTE_ROLE_CHOICES.map(row).join("") + "</div>" +
      '<p class="quiet">Always allowed: ' + ALWAYS_WRITE.join(", ").replace(/_/g, " ") + ".</p>" +
      '<button class="btn" id="admNoteSave" type="button">Save</button><div id="admNoteMsg"></div></div>';
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
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org;
        c.toast(picked.length ? "Saved. " + picked.length + " extra role" + (picked.length === 1 ? "" : "s") + " may write a note." : "Saved. Only prescribers may write a note.");
      });
    };
  }
  /* PRINTOUTS IN THE PATIENT'S LANGUAGE (owner decision 2026-09-15: English main, other languages optional).
   * Off by default. On, the Patient copy and the discharge summary offer a second language per print, beside an
   * English print that is always whole; only headings, labels and the closed-list patient instructions are
   * translated (wardsynq/site/print-lang.js). */
  function printLangCard(c, o) {
    var on = !!(o && o.wardsynq && o.wardsynq.printLanguages && o.wardsynq.printLanguages.enabled === true);
    return '<div class="card"><h2>' + c.ms("translate") + " Printouts in the patient's language</h2>" +
      '<label class="f"><span><input type="checkbox" id="admPrintLang"' + (on ? " checked" : "") + "> Offer a second language on the patient's prescription and discharge summary prints</span></label>" +
      '<p class="quiet">The English print is always complete and is the authoritative one. The second language is printed beside it, marked as a translation, and covers only headings, labels and the patient instructions a prescriber picked from the fixed list. Medicine names, doses, frequencies, diagnoses, results and anything typed are printed in English only. Translations not yet written show in English.</p>' +
      '<button class="btn" id="admPrintLangSave" type="button">Save</button><div id="admPrintLangMsg"></div></div>';
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
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org;
        c.toast(enabled ? "Saved. Prints offer a second language." : "Saved. Prints are in English only.");
      });
    };
  }
  /* APPROVAL RULES (P1.3). How many people must approve each kind of request, which roles may, how
   * long a request stays open, and extra approvers above an amount. The amount is always the one the
   * server works out from the thing itself (a purchase order's priced lines); a request with no known
   * amount gets the strictest level. Deciding an approval needs emr.treat, so only roles holding it
   * are offered. ponytail: one amount step per kind on screen; the server accepts a list. */
  var APPROVAL_KINDS = [["PurchaseOrder", "Purchase orders"], ["StockRequisition", "Stock requests"], ["RestrictedMedication", "Restricted medicines"], ["Invoice", "Invoices"], ["Discharge", "Discharges"], ["Incident", "Incident reports"]];
  var APPROVER_ROLES = ["admin", "doctor", "pg_faculty", "pg_hod"];
  function approvalRulesHtml(esc, cfg) {
    cfg = cfg || {};
    var levels = cfg.approvalLevels || {}, policy = cfg.approvalPolicy || {};
    var rows = APPROVAL_KINDS.map(function (k) {
      var p = policy[k[0]] || {}, t = (p.amountThresholds || [])[0] || {};
      var roles = Array.isArray(p.approverRoles) ? p.approverRoles : [];
      return "<tr data-kind=\"" + esc(k[0]) + "\"><td>" + esc(k[1]) + "</td>" +
        '<td><input class="apLevels" type="number" min="1" max="5" value="' + esc(levels[k[0]] || 1) + '" style="width:4em"></td>' +
        "<td>" + APPROVER_ROLES.map(function (r) { return '<label style="white-space:nowrap"><input type="checkbox" class="apRole" value="' + r + '"' + (roles.indexOf(r) >= 0 ? " checked" : "") + "> " + esc(r.replace(/_/g, " ")) + "</label> "; }).join("") + "</td>" +
        '<td><input class="apExpires" type="number" min="1" placeholder="never" value="' + esc(p.expiresHours || "") + '" style="width:5em"></td>' +
        '<td>above Rs <input class="apAbove" inputmode="decimal" placeholder="none" value="' + esc(t.abovePaise != null ? t.abovePaise / 100 : "") + '" style="width:7em"> needs <input class="apAboveLevels" type="number" min="1" max="5" value="' + esc(t.levels || "") + '" style="width:4em"></td></tr>';
    }).join("");
    return '<div class="card"><h2>Approval rules</h2>' +
      '<p class="quiet">Nobody can approve their own request. No roles ticked means any role that may approve can. Amounts are taken from the request itself on the server; a request whose amount is not known needs the highest number you set.</p>' +
      '<div class="tbl"><table><thead><tr><th>Kind</th><th>Approvals</th><th>Only these roles</th><th>Expires after (hours)</th><th>Extra approvers by amount</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      '<button class="btn" id="apSave" type="button">Save approval rules</button><div id="apMsg"></div></div>';
  }
  /* Reads the table back. Returns { approvalLevels, approvalPolicy } or { error }. */
  function readApprovalRules(rowEls) {
    var levels = {}, policy = {};
    for (var i = 0; i < rowEls.length; i++) {
      var tr = rowEls[i], kind = tr.getAttribute("data-kind");
      var q = function (sel) { return tr.querySelector(sel); };
      var n = parseInt(q(".apLevels").value, 10);
      if (!(n >= 1 && n <= 5)) return { error: "Approvals must be between 1 and 5." };
      levels[kind] = n;
      var p = {};
      var roles = []; tr.querySelectorAll(".apRole").forEach(function (b) { if (b.checked) roles.push(b.value); });
      if (roles.length) p.approverRoles = roles;
      var exp = String(q(".apExpires").value || "").trim();
      if (exp) { var h = Number(exp); if (!(h > 0)) return { error: "Expiry must be a number of hours above zero." }; p.expiresHours = h; }
      var above = String(q(".apAbove").value || "").trim(), aboveN = String(q(".apAboveLevels").value || "").trim();
      if (above || aboveN) {
        if (!/^\d+(\.\d{1,2})?$/.test(above) || !(parseInt(aboveN, 10) >= 1)) return { error: "An amount step needs both a rupee amount and a number of approvals." };
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
  function labCheckHtml(esc, cfg) {
    var on = !!(cfg && cfg.labVerification && cfg.labVerification.mode === "second-person");
    return '<div class="card"><h2>Laboratory result checking</h2>' +
      '<label class="f"><span><input type="checkbox" id="labSecond"' + (on ? " checked" : "") + "> Require a second member of the laboratory to verify results that did not pass autoverification</span></label>" +
      '<p class="quiet">While waiting, the result is on the chart marked preliminary. A critical value still raises its alert straight away.</p>' +
      '<button class="btn" id="labSecondSave" type="button">Save</button></div>';
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
        if (!r || !r.ok) { c.toast(refusal(r)); return; }
        c.state.org = r.org; c.toast(on ? "Saved. Unverified results now need a second person." : "Saved. Results are released as entered.");
      });
    };
  }
  function wireApprovalRules(c) {
    var btn = document.getElementById("apSave");
    if (!btn) return;
    btn.onclick = function () {
      var m = document.getElementById("apMsg");
      var out = readApprovalRules(document.querySelectorAll("tr[data-kind]"));
      if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, wardsynq: out }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org; c.toast("Approval rules saved.");
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
  function tokenCardHtml(esc, tokens, departments) {
    var t = tokens || {}, dept = t.scope === "department", pre = t.prefixes || {}, al = t.deptAliases || {};
    var h = '<div class="card"><h2>OPD token numbers</h2>' +
      '<label class="f"><span>Numbering</span><select id="tokScope">' +
        '<option value="hospital"' + (dept ? "" : " selected") + ">One sequence for the whole hospital</option>" +
        '<option value="department"' + (dept ? " selected" : "") + ">Each department numbers separately</option></select></label>";
    if (departments === undefined) return h + '<p><span class="spin"></span> Loading departments...</p></div>';
    if (departments === null) return h + '<div class="msg err">The departments could not be loaded, so prefixes cannot be shown or saved. Do not read this as no departments.</div></div>';
    var act = departments.filter(function (d) { return d && d.id && d.active !== false; });
    var used = {};
    var rows = act.map(function (d) {
      var p = pre[lc(d.id)] || pre[lc(d.name)] || "";
      if (pre[lc(d.id)]) used[lc(d.id)] = 1; else if (pre[lc(d.name)]) used[lc(d.name)] = 1;
      var aka = Object.keys(al).filter(function (k) { return al[k] === d.id; });
      return '<tr data-tok-dept="' + esc(d.id) + '" data-tok-name="' + esc(d.name) + '"><td>' + esc(d.name) + (d.code ? ' <span class="quiet">(' + esc(d.code) + ")</span>" : "") + "</td>" +
        '<td><input class="tokPrefix" maxlength="3" style="width:5em" value="' + esc(p) + '" placeholder="' + esc(/^[A-Za-z0-9]{1,3}$/.test(d.code || "") ? String(d.code).toUpperCase() : "") + '"></td>' +
        '<td><input class="tokAka" style="width:100%" value="' + esc(aka.join(", ")) + '" placeholder="Names the EMR uses, comma separated"></td></tr>';
    }).join("");
    var stale = Object.keys(pre).filter(function (k) { return !used[k]; });
    return h + (act.length
        ? '<div class="tbl"><table><thead><tr><th>Department</th><th>Prefix</th><th>Also known as</th></tr></thead><tbody>' + rows + "</tbody></table></div>"
        : '<p class="quiet">No active departments. Add them under Departments before numbering per department.</p>') +
      (stale.length ? '<div class="msg note">Saved prefixes that name no department: ' + esc(stale.map(function (k) { return k + " = " + pre[k]; }).join(", ")) + ". Saving this card drops them.</div>" : "") +
      '<p class="quiet">Prefixes are used only when each department numbers separately, and then every department needs its own: the desk cannot give a token in a department without one. A blank prefix uses the department code shown grey when that code is one to three letters or digits. Numbers start again at 1 each day, and a token already given never changes, including when the patient is moved to a room in another department.</p>' +
      '<button class="btn" id="tokSave" type="button">Save</button><div id="tokMsg"></div></div>';
  }
  /* rows: [{ departmentId, prefix, aka }] read from the table. Returns { tokens } or { error }. */
  function readTokenCard(scope, rows) {
    var prefixes = {}, deptAliases = {}, taken = {}, perDept = scope === "department";
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i], p = String(r.prefix || "").trim().toUpperCase();
      if (p && !/^[A-Z0-9]{1,3}$/.test(p)) return { error: "A prefix is one to three letters or digits: " + p };
      if (p) prefixes[r.departmentId] = p;
      /* D14: numbering per department needs every department's own prefix (typed, or its code shown grey),
       * and no two alike, or two departments call the same number. The server refuses the same. */
      var eff = p || String(r.code || "").trim().toUpperCase();
      if (perDept && !/^[A-Z0-9]{1,3}$/.test(eff)) return { error: (r.name || "A department") + " needs a prefix before each department can number separately." };
      if (perDept && taken[eff]) return { error: taken[eff] + " and " + (r.name || "another department") + " both use the prefix " + eff + ". Give each department its own." };
      if (perDept) taken[eff] = r.name || r.departmentId;
      var names = String(r.aka || "").split(",");
      for (var j = 0; j < names.length; j++) {
        var n = lc(names[j]); if (!n) continue;
        if (deptAliases[n] && deptAliases[n] !== r.departmentId) return { error: "\"" + names[j].trim() + "\" is given to two departments. A name can point to one department only." };
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
      box.innerHTML = tokenCardHtml(c.esc, (c.state.org || {}).tokens, depts);
      var btn = document.getElementById("tokSave");
      if (!btn) return;
      btn.onclick = function () {
        var m = document.getElementById("tokMsg");
        var rows = Array.prototype.map.call(box.querySelectorAll("tr[data-tok-dept]"), function (tr) {
          var pin = tr.querySelector(".tokPrefix");
          return { departmentId: tr.getAttribute("data-tok-dept"), name: tr.getAttribute("data-tok-name"), prefix: pin.value, code: pin.getAttribute("placeholder"), aka: tr.querySelector(".tokAka").value };
        });
        var out = readTokenCard(document.getElementById("tokScope").value, rows);
        if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
        btn.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, tokens: out.tokens }).then(function (r) {
          btn.disabled = false;
          if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.state.org = r.org; draw(depts); c.toast("Token numbering saved.");
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
  function clinicalSettingsHtml(esc, r, saved) {
    var h = '<div class="card"><h2>Clinical settings</h2>';
    if (r === undefined) return h + '<p><span class="spin"></span> Loading clinical settings...</p></div>';
    if (r === null) return h + '<div class="msg err">The clinical settings could not be loaded. Do not read this as none configured.</div></div>';
    var s = r.settings || {}, t = r.templates || {};
    var lines = function (a) { return esc((a || []).join("\n")); };
    var val = function (v) { return v == null ? "" : esc(v); };
    return h + '<p class="quiet">What each ward screen uses. A blank setting is not configured, and the screen that needs it says so rather than guessing.</p>' +
      '<div class="row"><label class="f"><span>Template</span><select id="clinTpl"><option value="">Choose a template</option>' +
        Object.keys(t).map(function (k) { return '<option value="' + esc(k) + '">' + esc(t[k].label) + "</option>"; }).join("") + "</select></label>" +
        '<button class="btn ghost" id="clinApply" type="button">Fill the form from the template</button></div><div id="clinTplNote" class="quiet"></div>' +
      '<div class="row"><label class="f"><span>High-alert drugs, one per line</span><textarea id="clinHigh" rows="4">' + lines(s.highAlertDrugs) + "</textarea></label>" +
        '<label class="f"><span>Antibiotics counted for days of therapy, one per line</span><textarea id="clinAbx" rows="4">' + lines(s.antibiotics) + "</textarea></label></div>" +
      '<div class="row"><label class="f"><span>Pharmacy verifies an order within (hours)</span><input id="clinVerify" type="number" min="1" max="168" value="' + val(s.orderVerifyWithinHours) + '" placeholder="not configured"></label>' +
        '<label class="f"><span>Backup recovery point objective (minutes)</span><input id="clinRpo" type="number" min="5" max="10080" value="' + val(s.rpoMinutes) + '" placeholder="not configured"></label></div>' +
      '<p>ED reassessment interval by acuity (minutes)</p><div class="row">' + ACUITY.map(function (a) {
        return '<label class="f" style="flex:0 1 110px"><span>Acuity ' + a + '</span><input class="clinEd" data-acuity="' + a + '" type="number" min="1" max="1440" value="' + val((s.edReassessMinutes || {})[a]) + '" placeholder="none"></label>';
      }).join("") + "</div>" +
      '<label class="f"><span><input type="checkbox" id="clinPortal"' + (s.patientAccess && s.patientAccess.enabled ? " checked" : "") + "> Patients may read their own record (patient access)</span></label>" +
      '<button class="btn" id="clinSave" type="button">Save clinical settings</button><div id="clinMsg"></div>' +
      (saved ? '<div class="msg ok">Saved' + (saved.changed.length ? ": " + esc(saved.changed.join(", ")) : ": nothing had changed") + '. The server now holds:</div>' + clinicalReadBackHtml(esc, saved.settings) : "") + "</div>";
  }
  function clinicalReadBackHtml(esc, s) {
    var nc = '<span class="quiet">not configured</span>';
    var list = function (a) { return a && a.length ? esc(a.join(", ")) : nc; };
    var ed = ACUITY.filter(function (a) { return s.edReassessMinutes && s.edReassessMinutes[a] != null; }).map(function (a) { return "acuity " + a + ": " + s.edReassessMinutes[a] + " min"; });
    return '<div class="kv"><dt>High-alert drugs</dt><dd>' + list(s.highAlertDrugs) + "</dd><dt>Antibiotics</dt><dd>" + list(s.antibiotics) +
      "</dd><dt>Verify within</dt><dd>" + (s.orderVerifyWithinHours != null ? esc(s.orderVerifyWithinHours) + " hours" : nc) +
      "</dd><dt>ED reassessment</dt><dd>" + (ed.length ? esc(ed.join(", ")) : nc) +
      "</dd><dt>Patient access</dt><dd>" + (s.patientAccess && s.patientAccess.enabled ? "on" : "off") +
      "</dd><dt>Recovery point objective</dt><dd>" + (s.rpoMinutes != null ? esc(s.rpoMinutes) + " minutes" : nc) + "</dd></div>";
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
      box.innerHTML = clinicalSettingsHtml(c.esc, r, saved);
      if (!r) return;
      var tplUsed = "";
      document.getElementById("clinApply").onclick = function () {
        var id = document.getElementById("clinTpl").value, tpl = id && r.templates[id];
        if (!tpl) { document.getElementById("clinTplNote").textContent = "Choose a template first."; return; }
        draw({ settings: tpl.settings, templates: r.templates });
        tplUsed = id;
        document.getElementById("clinTpl").value = id;
        document.getElementById("clinTplNote").textContent = tpl.description + " Nothing is saved until you press Save.";
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
          if (!x || !x.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          draw({ settings: x.settings, templates: r.templates }, { changed: x.changed || [], settings: x.settings });
          c.toast("Clinical settings saved.");
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
  var ALERT_LEVELS = [["due", "When the result is released"], ["overdue", "Not acknowledged in time"], ["escalate", "Still not acknowledged"]];
  var ALERT_ROLES = ["doctor", "resident", "supervisor", "nurse", "intern", "pg_resident", "pg_faculty", "pg_hod"];
  var ALERT_REASON = {
    NO_RECIPIENT: "nobody could be found to tell (no ordering clinician, nobody with a listed role on duty, no named contact)",
    NO_DEVICE: "nobody it was addressed to has a phone registered for alerts",
    PUSH_NOT_CONFIGURED: "push is not configured on the server",
    SMS_NOT_CONFIGURED: "the SMS fallback is not configured",
    NO_MOBILE: "nobody it was addressed to has an alert mobile",
    SMS_FAILED: "the SMS could not be sent",
  };
  function alertCardHtml(esc, s) {
    var h = '<div class="card" id="admAlertCard"><h2>Critical result alerts to phones</h2>';
    if (s == null) return h + '<span class="spin"></span> Loading...</div>';
    if (s === false || !s.ok) return h + '<div class="msg err">The alert settings could not be loaded' + (s && s.error ? " (" + esc(s.error) + ")" : "") + ". Do not read this as alerts being off or as nothing having failed.</div></div>";
    var lv = s.levels || {}, d = s.defaults || {}, ap = d.approval || {};
    var rows = ALERT_LEVELS.map(function (L) {
      var x = lv[L[0]] || { roles: [], contacts: [] };
      var when = L[0] === "due" ? "at once" : L[0] === "overdue" ? "after " + esc(s.minutes && s.minutes.acknowledgeWithinMinutes) + " min" : "after " + esc(s.minutes && s.minutes.escalateAfterMinutes) + " min";
      return '<tr data-level="' + L[0] + '"><td><b>' + esc(L[1]) + "</b><br><small>" + when + "</small></td>" +
        '<td><label><input type="checkbox" class="alOrderer"' + (x.orderer ? " checked" : "") + "> ordering clinician</label></td>" +
        "<td>" + ALERT_ROLES.map(function (r) { return '<label style="white-space:nowrap"><input type="checkbox" class="alRole" value="' + r + '"' + ((x.roles || []).indexOf(r) >= 0 ? " checked" : "") + "> " + esc(r.replace(/_/g, " ")) + "</label> "; }).join("") + "</td>" +
        '<td><textarea class="alContacts" rows="2" placeholder="one staff ID or email per line">' + esc((x.contacts || []).join("\n")) + "</textarea></td></tr>";
    }).join("");
    var sms = s.sms || {};
    var fails = (s.failures || []).map(function (f) {
      return "<tr><td>" + esc(f.at || "") + "</td><td>" + esc(f.level || "") + (f.sms ? " (SMS)" : "") + '</td><td class="mono">' + esc(f.loopId) + "</td><td>" + esc(ALERT_REASON[f.reason] || f.reason) + "</td></tr>";
    }).join("");
    return h +
      '<label class="f"><span><input type="checkbox" id="alEnabled"' + (s.enabled ? " checked" : "") + "> Push critical results to phones through the StewardMD app</span></label>" +
      '<p class="quiet">The push names the ward and bed only, never the patient. The detail opens after the phone is unlocked, and only for the people it was sent to. Acknowledging is still done with a sentence saying what was done.</p>' +
      "<h3>Who each level tells</h3>" +
      (lv.approval ? '<p class="msg ok">Default ladder approved by ' + esc(ap.approvedBy) + " on " + esc(ap.approvedOn) + " (owner decision " + esc(ap.decision) + ").</p>"
        : '<p class="msg note">This hospital has set its own ladder. The approved default (' + esc(ap.approvedBy) + ", " + esc(ap.approvedOn) + ") is ordering clinician and on-duty doctors, then supervisors and nurses on duty, then named contacts.</p>") +
      '<p class="quiet">Each level tells the people of the levels before it again. On-duty roles come from the rota for the patient\'s ward.</p>' +
      wardRuleHtml(esc, s.wardRule) +
      '<div class="tbl"><table><thead><tr><th>Level</th><th></th><th>On duty with role</th><th>Named contacts</th></tr></thead><tbody>' + rows + "</tbody></table></div>" +
      "<h3>SMS when no phone confirms</h3>" +
      '<p class="quiet">If no phone confirms a push within its level\'s time, it is sent once by SMS to each person\'s alert mobile (set on Staff and roles), using your DLT-approved 2Factor template whose first variable is the ward and second the bed.</p>' +
      '<div class="row"><label class="f"><span>DLT sender ID</span><input id="alSender" value="' + esc(sms.senderId || "") + '"></label>' +
      '<label class="f"><span>DLT template name</span><input id="alTemplate" value="' + esc(sms.templateName || "") + '"></label></div>' +
      (sms.ready ? '<p class="msg ok">SMS fallback is ready.</p>' : '<div class="msg err"><b>SMS fallback is not configured.</b> Missing:<br>' + (sms.missing || []).map(esc).join("<br>") + "</div>") +
      '<button class="btn" id="alSave" type="button">Save alert settings</button><div id="alMsg"></div>' +
      "<h3>Open results that told nobody</h3>" +
      (fails ? '<div class="tbl"><table><thead><tr><th>When</th><th>Level</th><th>Loop</th><th>Why</th></tr></thead><tbody>' + fails + "</tbody></table></div>" : '<p class="quiet">None among the open critical results read' + (s.partial ? " (only the newest 500 were checked)" : "") + ".</p>") +
      "<h3>Phones registered for alerts now</h3>" + phonesHtml(esc, s.phones) +
      ((s.noDevice || []).length ? '<p class="msg note">Alerts already sent to people with no phone registered: ' + s.noDevice.map(function (x) { return esc(x.identity); }).join(", ") + "</p>" : "") +
      "</div>";
  }
  /* Owner decision 2026-09-15, read-only: the named rule that picks who a level 2 alert tells in the patient's ward. */
  function wardRuleHtml(esc, r) {
    if (!r) return '<div class="msg err">The level 2 ward rule could not be read.</div>';
    return '<div class="kv"><dt>Level 2 ward rule</dt><dd><span class="mono">' + esc(r.rule) + "</span>" +
      (r.source === "default" ? ' <span class="quiet">(default)</span>' : r.source === "unrecognised" ? ' <span class="msg err">the saved rule "' + esc(r.configured) + '" is not one this build has, so this rule is applied</span>' : "") + "</dd></div>" +
      '<p class="quiet">' + esc(r.note) + ' On level 2, "nurse" in the table below stands for this rule. Nurses, residents and consultants mark themselves on or off duty in the ward screen; off duty lasts until the end of their rostered shift, or 12 hours. The rule cannot be changed on this card.</p>';
  }
  /* Read from the phone registrations themselves (not from past alerts): everyone on duty with a role on the
   * ladder, and every named contact. A failed read is said, never shown as everyone having a phone. */
  function phonesHtml(esc, p) {
    if (!p || !p.ok) return '<div class="msg err">Which phones are registered could not be read' + (p && p.error ? " (" + esc(p.error) + ")" : "") + ". Do not read this as everyone having one.</div>";
    var note = p.partial ? " The rota was too large to read in full, so some people on duty may not be listed." : "";
    if (!p.checked) return '<p class="quiet">Nobody is on duty now with a role on the ladder, and no contact is named, so there is nobody to check.' + note + "</p>";
    if (!(p.noDevice || []).length) return '<p class="msg ok">All ' + esc(p.checked) + " people on duty with a role on the ladder, and the named contacts, have a phone registered." + note + "</p>";
    return '<div class="msg err"><b>No phone registered for alerts (' + esc(p.noDevice.length) + " of " + esc(p.checked) + "):</b><br>" +
      p.noDevice.map(function (x) { return esc(x.identity) + " (" + esc(x.why === "named contact" ? "named contact" : "on duty") + (x.role ? ", " + esc(x.role) : "") + ")"; }).join("<br>") +
      "<br>They get an alert only by SMS, if that is set up." + note + "</div>";
  }
  /* Reads the card back. v = { enabled, senderId, templateName, levels: {due: {orderer, roles, contactsText}}, escalation }. */
  function readAlertCard(v) {
    var levels = {}, bad = "";
    ALERT_LEVELS.forEach(function (L) {
      var x = (v.levels && v.levels[L[0]]) || {};
      var contacts = String(x.contactsText || "").split(/\n/).map(function (t) { return t.trim(); }).filter(Boolean);
      if (contacts.some(function (t) { return t.length > 120; })) bad = "A named contact is too long: use the staff ID or email.";
      levels[L[0]] = { orderer: !!x.orderer, roles: (x.roles || []).slice(), contacts: contacts };
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
    slot.innerHTML = alertCardHtml(c.esc, null);
    c.api("/ward/alert-status?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      slot.innerHTML = alertCardHtml(c.esc, r && r.ok ? r : false);
      var btn = document.getElementById("alSave");
      if (!btn) return;
      btn.onclick = function () {
        var m = document.getElementById("alMsg"), lv = {};
        document.querySelectorAll("#admAlertCard tr[data-level]").forEach(function (tr) {
          var roles = []; tr.querySelectorAll(".alRole").forEach(function (b) { if (b.checked) roles.push(b.value); });
          lv[tr.getAttribute("data-level")] = { orderer: tr.querySelector(".alOrderer").checked, roles: roles, contactsText: tr.querySelector(".alContacts").value };
        });
        var out = readAlertCard({ enabled: document.getElementById("alEnabled").checked, senderId: document.getElementById("alSender").value, templateName: document.getElementById("alTemplate").value, levels: lv, escalation: ((c.state.org || {}).wardsynq || {}).criticalEscalation });
        if (out.error) { m.innerHTML = '<div class="msg err">' + c.esc(out.error) + "</div>"; return; }
        btn.disabled = true;
        c.api("/org/update", { orgId: c.state.orgId, wardsynq: out.wardsynq }).then(function (u) {
          btn.disabled = false;
          if (!u || !u.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(u)) + "</div>"; return; }
          c.state.org = u.org; c.toast(out.wardsynq.alerts.push.enabled ? "Saved. Critical results are pushed to phones." : "Saved. Critical results are not pushed to phones."); loadAlertCard(c);
        });
      };
    });
  }
  function renderHospital(c, body) {
    var o = c.state.org || {};
    body.innerHTML = '<div class="card"><h2>' + c.ms("local_hospital") + " Hospital</h2>" +
      '<div class="kv"><dt>Name</dt><dd>' + c.esc(o.name || "") + "</dd>" +
      '<dt>Code</dt><dd class="mono">' + c.esc(o.code || "") + "</dd>" +
      "<dt>Mode</dt><dd>" + c.esc(o.mode || "") + "</dd>" +
      "<dt>Country</dt><dd>" + (o.region === "US" ? "United States" : "India") + "</dd>" +
      '<dt>Id</dt><dd class="mono">' + c.esc(o.id || "") + "</dd>" +
      '<dt>Connect tenant</dt><dd class="mono">' + c.esc(o.connectTenantId || "none") + "</dd></div>" +
      '<h3>Name and country</h3><div class="row"><label class="f"><span>Hospital name</span><input id="admHospName" value="' + c.esc(o.name || "") + '"></label>' +
      '<label class="f" style="flex:0 1 180px"><span>Country</span><select id="admHospRegion">' +
        '<option value="IN"' + (o.region === "US" ? "" : " selected") + ">India</option>" +
        '<option value="US"' + (o.region === "US" ? " selected" : "") + ">United States</option></select></label>" +
      /* India: the HFR facility ID the ABDM profile must match (Integrations > ABDM). Validated on the server. */
      (o.region === "US" ? "" : '<label class="f" style="flex:0 1 200px"><span>HFR facility ID (India)</span><input id="admHospHfr" class="mono" maxlength="20" placeholder="IN and 10 digits" value="' + c.esc((o.regionProfile && o.regionProfile.hfrId) || "") + '"></label>') +
      '<button class="btn" id="admHospSave" type="button">Save</button></div>' +
      /* Said plainly, because it changes how numbers already on the chart are READ, not what they
       * say: nothing is converted, and nothing already recorded is rewritten. */
      '<p class="quiet">The country decides what counts as a valid phone number and the unit a temperature is charted in from now on. Readings already recorded keep the unit they were recorded in.</p><div id="admHospMsg"></div>' +
      (c.isWardsynq() ? "" : '<div class="msg note">Inpatient features (ward, beds, theatre, Digital Twin) need a WardSynQ hospital. Create one from the hospital list.</div>') +
      '</div><div id="tokCard"></div>' +
      (c.isWardsynq() ? '<div id="admAlertSlot"></div><div id="clinCard"></div>' + noteWritersCard(c, o) + printLangCard(c, o) + approvalRulesHtml(c.esc, o.wardsynq) + labCheckHtml(c.esc, o.wardsynq) : "");
    document.getElementById("admHospSave").onclick = function () {
      var btn = document.getElementById("admHospSave");
      var name = (document.getElementById("admHospName").value || "").trim();
      if (!name) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">Give the hospital a name.</div>'; return; }
      btn.disabled = true;
      var upd = { orgId: c.state.orgId, name: name, region: document.getElementById("admHospRegion").value };
      var hfrEl = document.getElementById("admHospHfr");
      if (hfrEl && upd.region === "IN") upd.regionProfile = { hfrId: String(hfrEl.value || "").replace(/[\s-]+/g, "").toUpperCase() };
      c.api("/org/update", upd).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org; c.toast("Hospital updated."); WSQ.render("admin");
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
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">Could not load the forms. ' + c.esc(refusal(r)) + "</div>"; return; }
      var list = function (title, rows, draft) {
        return "<h3>" + title + "</h3>" + (rows.length ? "<ul>" + rows.map(function (x) {
          var d = draft ? x.def : x;
          return "<li><b>" + c.esc(d.title || d.key) + "</b> (" + c.esc(d.key) + (draft ? ", draft" : ", version " + c.esc(d.version)) + ")" +
            (draft ? (x.problems.length ? '<div class="msg err">' + x.problems.map(c.esc).join("<br>") + "</div>" : ' <button class="btn" type="button" data-form-pub="' + c.esc(d.key) + '">Publish</button>') : "") +
            ' <button class="btn quiet" type="button" data-form-edit="' + c.esc(d.key) + '" data-form-draft="' + (draft ? "1" : "") + '">Edit</button></li>';
        }).join("") + "</ul>" : "<p>None.</p>");
      };
      body.innerHTML = '<div class="card"><h2>Forms</h2>' + list("Drafts", r.drafts, true) + list("Published", r.published, false) +
        '<h3>Edit a form (JSON)</h3><textarea id="admFormJson" rows="14" style="width:100%;font-family:monospace" placeholder=\'{"key":"nursing_admission","title":"Nursing admission assessment","roles":["nurse"],"sections":[{"title":"Risks","fields":[{"key":"falls_risk","label":"Falls risk","type":"boolean","required":true}]}]}\'></textarea>' +
        '<button class="btn" type="button" id="admFormSave">Save draft</button><div id="admFormMsg"></div></div>';
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
            if (!x || !x.ok) { c.toast(refusal(x)); return; }
            c.toast("Published as version " + x.version + "."); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admFormSave").onclick = function () {
        var def; try { def = JSON.parse(document.getElementById("admFormJson").value); } catch (e) { document.getElementById("admFormMsg").innerHTML = '<div class="msg err">That is not valid JSON: ' + c.esc(e.message) + "</div>"; return; }
        delete def.status; delete def.version; delete def.publishedAt;
        c.api("/forms/draft", { orgId: c.state.orgId, definition: def }).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admFormMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast(x.problems.length ? "Draft saved with " + x.problems.length + " problem(s) to fix before publishing." : "Draft saved. It can be published."); WSQ.render("admin");
        });
      };
    });
  }

  /* CLINICAL PATHWAYS (P2.12): hospital pathway definitions, draft saving, publishing immutable versions,
   * and retiring outdated versions with a mandatory reason. */
  function renderPathways(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/pathways/definitions?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">Could not load the clinical pathways. ' + c.esc(refusal(r)) + "</div>"; return; }
      var list = function (title, rows, draft) {
        return "<h3>" + title + "</h3>" + (rows && rows.length ? "<ul>" + rows.map(function (x) {
          var d = draft ? x.def : x;
          var retired = d.status === "retired";
          return "<li><b>" + c.esc(d.title || d.key) + "</b> (" + c.esc(d.key) + (draft ? ", draft" : ", version " + c.esc(d.version)) + (retired ? " - RETIRED" : "") + ")" +
            (draft ? (x.problems && x.problems.length ? '<div class="msg err">' + x.problems.map(c.esc).join("<br>") + "</div>" : ' <button class="btn" type="button" data-pw-pub="' + c.esc(d.key) + '">Publish</button>') : "") +
            (!draft && !retired ? ' <button class="btn ghost" type="button" data-pw-retire="' + c.esc(d.key) + '" data-pw-v="' + c.esc(d.version) + '">Retire</button>' : "") +
            ' <button class="btn quiet" type="button" data-pw-edit="' + c.esc(d.key) + '" data-pw-draft="' + (draft ? "1" : "") + '">Edit</button></li>';
        }).join("") + "</ul>" : "<p>None.</p>");
      };
      body.innerHTML = '<div class="card"><h2>Clinical pathways</h2>' + list("Drafts", r.drafts || [], true) + list("Published", r.published || [], false) +
        '<h3>Edit a pathway (JSON)</h3><textarea id="admPwJson" rows="14" style="width:100%;font-family:monospace" placeholder=\'{"key":"sepsis_bundle","title":"Sepsis resuscitation bundle","owner":"Critical Care Committee","effectiveDate":"2026-01-01","reviewDate":"2027-01-01","evidence":[{"citation":"Surviving Sepsis Campaign 2021"}],"steps":[{"key":"blood_cultures","title":"Blood cultures before antibiotics","kind":"orders","orderSetId":"sepsis_labs"}]}\'></textarea>' +
        '<button class="btn" type="button" id="admPwSave">Save draft</button><div id="admPwMsg"></div></div>';
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
            if (!x || !x.ok) { c.toast(refusal(x)); return; }
            c.toast("Published as version " + x.version + "."); WSQ.render("admin");
          });
        };
      });
      body.querySelectorAll("[data-pw-retire]").forEach(function (b) {
        b.onclick = function () {
          var reason = window.prompt("Reason for retiring this pathway version (mandatory):");
          if (!reason || reason.trim().length < 5) { alert("A retirement reason of at least 5 characters is required."); return; }
          c.api("/pathways/retire", { orgId: c.state.orgId, key: b.getAttribute("data-pw-retire"), version: b.getAttribute("data-pw-v"), reason: reason.trim() }).then(function (x) {
            if (!x || !x.ok) { c.toast(refusal(x)); return; }
            c.toast("Pathway version retired."); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admPwSave").onclick = function () {
        var def; try { def = JSON.parse(document.getElementById("admPwJson").value); } catch (e) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">That is not valid JSON: ' + c.esc(e.message) + "</div>"; return; }
        delete def.status; delete def.version; delete def.publishedAt;
        c.api("/pathways/draft", { orgId: c.state.orgId, definition: def }).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast(x.problems && x.problems.length ? "Draft saved with " + x.problems.length + " problem(s) to fix before publishing." : "Draft saved. It can be published."); WSQ.render("admin");
        });
      };
    });
  }
  function renderAdvisories(c, body) {
    body.innerHTML = '<div class="card"><h2>Safety reminders - try a draft</h2>' +
      '<p class="quiet">Paste the draft reminder set (JSON). Nothing is published or changed by trying it.</p>' +
      '<textarea id="admAdvDraft" rows="10" style="width:100%"></textarea>' +
      '<button type="button" class="btn" id="admAdvRun">Try it</button><div id="admAdvOut"></div></div>';
    document.getElementById("admAdvRun").onclick = function () {
      var out = document.getElementById("admAdvOut"), draft;
      try { draft = JSON.parse(document.getElementById("admAdvDraft").value || "null"); }
      catch (e) { out.innerHTML = '<div class="msg err">That is not valid JSON, so it was not tried.</div>'; return; }
      out.innerHTML = '<span class="spin"></span>';
      c.api("/ward/advisory-check", { orgId: c.state.orgId, advisories: draft }).then(function (r) {
        if (!r || !r.ok) { out.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        out.innerHTML = '<div class="msg note">Tried, not published.</div><pre style="white-space:pre-wrap">' + c.esc(JSON.stringify(r, null, 2)) + "</pre>";
      });
    };
  }

  // ---- Price list -------------------------------------------------------------------------------
  /* WHAT THE HOSPITAL CHARGES. Prices are stored in paise, whole numbers, and shown in rupees - the
   * conversion happens only here, on the way in and out, so no amount is ever held as a fraction that
   * rounds differently in two places. Every change is audited on the server with the old price and the
   * new one. Withdrawing an item hides it from new bills but keeps it, because old bills still name it. */
  function rupees(paise) { var n = Number(paise); return isFinite(n) ? (n / 100).toFixed(2) : ""; }
  function renderTariff(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/bill/tariff?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">The price list could not be loaded. Do not read this as an empty price list.</div>'; return; }
      var items = r.items || [];
      body.innerHTML = '<div class="card"><h2>Price list</h2>' +
        (items.length ? '<div class="tbl"><table><thead><tr><th>Item</th><th>Code</th><th>Kind</th><th>Price (Rs)</th><th></th></tr></thead><tbody>' +
          items.map(function (t) {
            return "<tr><td>" + c.esc(t.name) + "</td><td>" + c.esc(t.code || "") + "</td><td>" + c.esc(t.kind) + "</td><td>" + c.esc(rupees(t.price)) + "</td>" +
              '<td><button type="button" class="btn ghost" data-trf-edit="' + c.esc(t.id) + '">Change price</button> ' +
              '<button type="button" class="btn ghost" data-trf-off="' + c.esc(t.id) + '">Withdraw</button></td></tr>';
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No prices set yet.</p>') +
        '<h3>Add an item</h3><div class="row">' +
        '<label class="f"><span>Name</span><input id="admTrfName"></label>' +
        '<label class="f"><span>Code</span><input id="admTrfCode"></label>' +
        '<label class="f"><span>Kind</span><select id="admTrfKind"><option value="investigation">Test</option><option value="medication">Medicine</option><option value="service">Service</option></select></label>' +
        '<label class="f"><span>Price (Rs)</span><input id="admTrfPrice" inputmode="decimal"></label>' +
        '</div><button type="button" class="btn" id="admTrfAdd">Add</button><div id="admTrfMsg"></div>' +
        '<p class="quiet">Every change is recorded with the old and new price.</p></div>';

      function save(item) {
        return c.api("/bill/tariff", Object.assign({ orgId: c.state.orgId }, item)).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast("Saved."); renderTariff(c, body);
        });
      }
      /* Rupees in, paise out. A price that is not plainly a number is refused here, never guessed at. */
      function toPaise(v) { var t = String(v || "").trim(); return /^\d+(\.\d{1,2})?$/.test(t) ? Math.round(Number(t) * 100) : null; }

      document.getElementById("admTrfAdd").onclick = function () {
        var name = document.getElementById("admTrfName").value.trim();
        var price = toPaise(document.getElementById("admTrfPrice").value);
        if (!name) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">Give the item a name.</div>'; return; }
        if (price === null) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">The price has to be a plain amount in rupees, like 450 or 450.50.</div>'; return; }
        save({ name: name, code: document.getElementById("admTrfCode").value.trim(), kind: document.getElementById("admTrfKind").value, price: price });
      };
      body.querySelectorAll("[data-trf-edit]").forEach(function (b) {
        b.onclick = function () {
          var t = items.filter(function (x) { return x.id === b.getAttribute("data-trf-edit"); })[0]; if (!t) return;
          var v = prompt("New price for " + t.name + " in rupees (now " + rupees(t.price) + ")"); if (v == null) return;
          var price = toPaise(v);
          if (price === null) { document.getElementById("admTrfMsg").innerHTML = '<div class="msg err">The price has to be a plain amount in rupees.</div>'; return; }
          save({ id: t.id, name: t.name, code: t.code, kind: t.kind, price: price });
        };
      });
      body.querySelectorAll("[data-trf-off]").forEach(function (b) {
        b.onclick = function () {
          var t = items.filter(function (x) { return x.id === b.getAttribute("data-trf-off"); })[0]; if (!t) return;
          if (!confirm("Withdraw " + t.name + " from the price list? Old bills keep it.")) return;
          save({ id: t.id, name: t.name, code: t.code, kind: t.kind, price: t.price, active: false });
        };
      });
    });
  }

  // ---- Departments ------------------------------------------------------------------------------
  function renderDepts(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      /* A failed load is not "no departments" - said plainly, and the list is not drawn. */
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">The departments could not be loaded. Do not read this as none set up.</div>'; return; }
      var depts = r.departments || [];
      if (c.state.org) c.state.org._departments = depts;
      body.innerHTML = '<div class="card"><h2>Departments</h2>' +
        (depts.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Active</th></tr></thead><tbody>' +
          depts.map(function (d) { return "<tr><td>" + c.esc(d.name) + "</td><td>" + c.esc(d.code) + "</td><td>" + c.esc(d.type) + "</td><td>" + (d.active ? "yes" : "no") + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">No departments yet.</p>') +
        '<h3>Add a department</h3><div class="row">' +
        '<label class="f"><span>Name</span><input id="admDeptName"></label>' +
        '<label class="f"><span>Code</span><input id="admDeptCode"></label>' +
        '<label class="f"><span>Type</span><input id="admDeptType" placeholder="general"></label>' +
        '<button class="btn" id="admDeptAdd" type="button">' + c.ms("add") + "Add</button></div><div id=\"admDeptMsg\"></div></div>";
      document.getElementById("admDeptAdd").onclick = function () {
        var name = (document.getElementById("admDeptName").value || "").trim();
        if (!name) { document.getElementById("admDeptMsg").innerHTML = '<div class="msg err">Give the department a name.</div>'; return; }
        c.api("/dept", { orgId: c.state.orgId, name: name, code: document.getElementById("admDeptCode").value, type: document.getElementById("admDeptType").value }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admDeptMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Department added."); WSQ.render("admin");
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
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><h2>Wards</h2><div class="msg err">Wards could not be loaded. Do not read this as no wards. ' + c.esc(refusal(r)) + "</div></div>"; return; }
      var wards = r.wards || [];
      var wardOpts = wards.map(function (w) { return '<option value="' + c.esc(w.id) + '">' + c.esc(w.name) + "</option>"; }).join("");
      body.innerHTML = '<div class="card"><h2>Wards</h2>' +
        (wards.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Active</th><th></th></tr></thead><tbody>' +
          wards.map(function (w) { return '<tr data-ward-id="' + c.esc(w.id) + '"><td>' + c.esc(w.name) + "</td><td>" + c.esc(w.code) + "</td><td>" + c.esc(w.type) + "</td><td>" + (w.active ? "yes" : "no") + "</td>" +
            '<td><button class="btn ghost sm" type="button" data-ward-rename="' + c.esc(w.id) + '" data-ward-name="' + c.esc(w.name) + '">Rename</button> ' +
            '<button class="btn ghost sm" type="button" data-ward-active="' + c.esc(w.id) + '" data-to="' + (w.active ? "0" : "1") + '">' + (w.active ? "Deactivate" : "Reactivate") + "</button></td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">No wards yet.</p>') +
        '<h3>Add a ward</h3><div class="row"><label class="f"><span>Name</span><input id="admWardName"></label>' +
        '<label class="f"><span>Code</span><input id="admWardCode"></label>' +
        '<label class="f"><span>Type</span><input id="admWardType" placeholder="general"></label>' +
        '<button class="btn" id="admWardAdd" type="button">' + c.ms("add") + "Add</button></div><div id=\"admWardMsg\"></div></div>" +
        '<div class="card" id="admBedsCard">' + (wards.length ?
          '<h2>Beds</h2><div class="row"><label class="f"><span>Ward</span><select id="admBedWard">' + wardOpts + "</select></label></div>" +
          '<div id="admBedsList"><span class="spin"></span></div>' +
          '<h3>Add a bed</h3><div class="row"><label class="f"><span>Name</span><input id="admBedLabel"></label>' +
          '<button class="btn" id="admBedAdd" type="button">' + c.ms("add") + "Add</button></div><div id=\"admBedMsg\"></div>"
          : '<p class="quiet">Add a ward, then its beds.</p>') + "</div>";
      var wardUpdate = function (patch, done) {
        c.api("/ward/update", Object.assign({ orgId: c.state.orgId }, patch)).then(function (x) {
          if (!x || !x.ok) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast(done); WSQ.render("admin");
        });
      };
      body.querySelectorAll("[data-ward-rename]").forEach(function (b) {
        b.onclick = function () {
          var name = (window.prompt("New name for this ward", b.getAttribute("data-ward-name")) || "").trim();
          if (name) wardUpdate({ wardId: b.getAttribute("data-ward-rename"), name: name }, "Ward renamed.");
        };
      });
      body.querySelectorAll("[data-ward-active]").forEach(function (b) {
        b.onclick = function () {
          var on = b.getAttribute("data-to") === "1";
          if (!on && !window.confirm("Deactivate this ward? Nothing already recorded changes, and it can be reactivated.")) return;
          wardUpdate({ wardId: b.getAttribute("data-ward-active"), active: on }, on ? "Ward reactivated." : "Ward deactivated.");
        };
      });
      document.getElementById("admWardAdd").onclick = function () {
        var name = (document.getElementById("admWardName").value || "").trim();
        if (!name) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">Give the ward a name.</div>'; return; }
        c.api("/ward", { orgId: c.state.orgId, name: name, code: document.getElementById("admWardCode").value, type: document.getElementById("admWardType").value }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admWardMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Ward added."); WSQ.render("admin");
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
          var beds = (br && br.ok && br.beds) || [];
          list.innerHTML = beds.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>State</th><th>Isolation</th><th></th></tr></thead><tbody>' +
            beds.map(function (bd) {
              var pillCls = bd.state === "available" ? " ok" : (bd.state === "blocked" || bd.state === "maintenance") ? " stop" : "";
              return '<tr data-bed-id="' + c.esc(bd.id) + '"><td>' + c.esc(bd.name) + '</td><td><span class="pill' + pillCls + '">' + c.esc(bd.state) + "</span></td><td>" + (bd.isolation ? "yes" : "no") + "</td><td>" +
                BED_STATES.filter(function (s) { return s !== bd.state; }).map(function (s) {
                  return '<button type="button" class="btn quiet" data-bed="' + c.esc(bd.id) + '" data-state="' + s + '">' + c.esc(s) + "</button>";
                }).join(" ") + "</td></tr>";
            }).join("") + "</tbody></table></div>" : '<p class="quiet">No beds in this ward yet.</p>';
          list.querySelectorAll("[data-bed]").forEach(function (b) {
            b.onclick = function () {
              c.api("/bed/update", { orgId: c.state.orgId, bedId: b.getAttribute("data-bed"), state: b.getAttribute("data-state") }).then(function (r) {
                if (!r || !r.ok) { list.innerHTML += '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; if (r && r.error === "bed_changed") loadBeds(); return; }
                c.toast("Bed updated."); loadBeds();
              });
            };
          });
        });
      }
      document.getElementById("admBedAdd").onclick = function () {
        var name = (document.getElementById("admBedLabel").value || "").trim();
        if (!name) { document.getElementById("admBedMsg").innerHTML = '<div class="msg err">Give the bed a name.</div>'; return; }
        // The server's bed() factory field is "name" (see functions/_opd_org.js / _opd_org_store.js
        // createBed) even though the on-screen input is #admBedLabel per the journey's id contract.
        c.api("/bed", { orgId: c.state.orgId, wardId: sel.value, name: name }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admBedMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Bed added."); document.getElementById("admBedLabel").value = ""; loadBeds();
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
      if (!r || !r.ok) { body.innerHTML = '<div class="card"><h2>Rooms</h2><div class="msg err">Rooms could not be loaded. Do not read this as no rooms. ' + c.esc(refusal(r)) + "</div></div>"; return; }
      var rooms = r.rooms || [], depts = (r.departments || []).filter(function (d) { return d.active !== false; });
      var deptSel = function (cls, cur, attr) {
        return '<select class="' + cls + '"' + (attr || "") + '><option value="">No department</option>' + depts.map(function (d) {
          return '<option value="' + c.esc(d.id) + '"' + (d.id === cur ? " selected" : "") + ">" + c.esc(d.name) + "</option>";
        }).join("") + "</select>";
      };
      body.innerHTML = '<div class="card"><h2>Rooms</h2>' +
        (rooms.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>Number</th><th>Department</th><th>Assignment</th><th>Active</th></tr></thead><tbody>' +
          rooms.map(function (rm) { return "<tr><td>" + c.esc(rm.name) + "</td><td>" + c.esc(rm.number) + "</td><td>" + deptSel("admRoomDept", rm.departmentId || "", ' data-room="' + c.esc(rm.id) + '"') + "</td><td>" + c.esc((rm.assignment && rm.assignment.mode) || "") + "</td><td>" + (rm.active ? "yes" : "no") + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">No consulting rooms yet.</p>') +
        '<h3>Add a room</h3><div class="row"><label class="f"><span>Name</span><input id="admRoomName"></label>' +
        '<label class="f"><span>Department</span>' + deptSel("", "", ' id="admRoomNewDept"') + "</label>" +
        '<button class="btn" id="admRoomAdd" type="button">' + c.ms("add") + "Add</button></div><div id=\"admRoomMsg\"></div></div>";
      body.querySelectorAll(".admRoomDept").forEach(function (sel) {
        sel.onchange = function () {
          sel.disabled = true;
          c.api("/room/update", { orgId: c.state.orgId, roomId: sel.getAttribute("data-room"), departmentId: sel.value || null }).then(function (x) {
            sel.disabled = false;
            if (!x || !x.ok) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">The department was not saved: ' + c.esc(refusal(x)) + "</div>"; WSQ.render("admin"); return; }
            c.toast("Room department saved" + (x.room && x.room.department ? ": " + x.room.department : ": none") + ".");
          });
        };
      });
      document.getElementById("admRoomAdd").onclick = function () {
        var name = (document.getElementById("admRoomName").value || "").trim();
        if (!name) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">Give the room a name.</div>'; return; }
        c.api("/room", { orgId: c.state.orgId, name: name, departmentId: document.getElementById("admRoomNewDept").value || null }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Room added."); WSQ.render("admin");
        });
      };
    });
  }

  // ---- Staff and roles ----------------------------------------------------------------------------
  /* REQUIRE TWO-STEP SIGN-IN, per role. The server enforces it on every request; this card only sets it.
   * Staff of a ticked role who have not set it up can still sign in, but can do nothing except set it up. */
  function twoStepPolicyCard(c) {
    var on = ((c.state.org && c.state.org.security && c.state.org.security.requireTwoStepRoles) || []);
    return '<div class="card"><h2>Require two-step sign-in</h2>' +
      '<p class="quiet">Staff in a ticked role must use a code from an authenticator app when they sign in. Anyone in that role who has not set it up yet can sign in, but can only reach the set-up page until they do. A lost phone is fixed with Reset access.</p>' +
      '<div class="row">' + ROLES.map(function (r) {
        return '<label class="f" style="flex:0 1 170px"><span><input type="checkbox" class="admTwoStepRole" value="' + c.esc(r) + '"' + (on.indexOf(r) >= 0 ? " checked" : "") + "> " + c.esc(r.replace(/_/g, " ")) + "</span></label>";
      }).join("") + "</div>" +
      '<button class="btn" id="admTwoStepSave" type="button">Save</button><div id="admTwoStepMsg"></div></div>';
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
        if (!r || !r.ok) { m.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org;
        var saved = (r.org && r.org.security && r.org.security.requireTwoStepRoles) || [];
        m.innerHTML = '<div class="msg ok">' + (saved.length ? "Saved. Required for: " + c.esc(saved.join(", ")) + "." : "Saved. Two-step sign-in is optional for everyone.") + "</div>";
      });
    };
  }
  function renderStaff(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/members?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var members = (r && r.ok && r.members) || [];
      var roleOpts = ROLES.map(function (rn) { return '<option value="' + rn + '">' + rn + "</option>"; }).join("");
      body.innerHTML =
        '<div class="card"><h2>What each credential lets a person do</h2>' +
        ROLE_NOTES.map(function (l) { return '<p class="quiet"><b>' + c.esc(l[0]) + ":</b> " + c.esc(l[1]) + "</p>"; }).join("") + "</div>" +
        twoStepPolicyCard(c) +
        '<div class="card"><h2>Staff</h2>' +
        (members.length ? '<div class="tbl"><table><thead><tr><th>Identity</th><th>Role</th><th>Active</th><th>Email</th><th>PIN set</th><th>Alert mobile</th><th></th></tr></thead><tbody>' +
          members.map(function (m) {
            return '<tr data-identity="' + c.esc(m.identity) + '"><td>' + c.esc(m.identity) + "</td><td>" + c.esc(m.role) + "</td><td>" + (m.active ? "yes" : "no") + "</td><td>" + c.esc(m.email || "none") + "</td><td>" + (m.hasPin ? "yes" : "no") + "</td><td>" + (m.alertMobile ? "set" : "none") + "</td><td>" +
              '<button type="button" class="btn quiet" data-mact="' + (m.active ? "disable" : "restore") + '" data-id="' + c.esc(m.identity) + '">' + (m.active ? "Disable" : "Restore") + "</button> " +
              '<button type="button" class="btn quiet" data-mact="reset" data-id="' + c.esc(m.identity) + '">Reset access</button></td></tr>';
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No staff added yet.</p>') +
        "</div>" +
        '<div class="card"><h2>Add or update a staff member</h2><p class="quiet">Hospital code for sign-in: <span class="mono">' + c.esc((c.state.org && c.state.org.code) || "") + "</span></p>" +
        '<div class="row"><label class="f"><span>Identity (staff ID or email)</span><input id="admMemberIdentity"></label>' +
        '<label class="f"><span>Role</span><select id="admMemberRole">' + roleOpts + "</select></label>" +
        /* The hospital vouching that this person is a registered practitioner. Without it a doctor
         * who signs in as hospital staff can write the chart and cannot SIGN anything - no
         * prescription, no note, no discharge summary - because the only other source of a signing
         * credential is a StewardMD account's verified claim. Every signed record records which of
         * the two vouched, so this is an assertion the hospital makes and is accountable for. */
        '<label class="f"><span>Registration number (prescribers)</span><input id="admMemberRegNo" placeholder="leave blank if not a prescriber"></label>' +
        // S3 P0: where a critical-result SMS goes when no phone confirmed the push. Blank keeps what is saved.
        '<label class="f"><span>Alert mobile (critical-result SMS)</span><input id="admMemberMobile" inputmode="tel" placeholder="blank keeps the saved number"></label>' +
        '<button class="btn" id="admMemberAdd" type="button">Save membership</button></div><div id="admMemMsg"></div>' +
        '<p class="quiet">A member with no registration number can use WardSynQ but cannot sign a prescription, a note or a discharge summary. The hospital is asserting this number; a StewardMD account that is already verified uses its own instead.</p>' +
        '<h3>Set PIN</h3><div class="row"><label class="f"><span>Identity</span><input id="admPinId"></label>' +
        '<label class="f"><span>PIN</span><input id="admPinVal" type="password"></label>' +
        '<button class="btn quiet" id="admPinSave" type="button">Set PIN</button></div><div id="admPinMsg"></div>' +
        '<h3>Set email + password</h3><div class="row"><label class="f"><span>Identity</span><input id="admPwId"></label>' +
        '<label class="f"><span>Email</span><input id="admPwEmail" type="email"></label>' +
        '<label class="f"><span>Password</span><input id="admPwVal" type="password"></label>' +
        '<button class="btn quiet" id="admPwSave" type="button">Set password</button></div><div id="admPwMsg"></div>' +
        "</div>";
      wireTwoStepPolicy(c);
      body.querySelectorAll("[data-mact]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-mact"), id = b.getAttribute("data-id");
          if (!MEMBER_ACTION_ROUTE[act]) return;
          c.api("/member/" + MEMBER_ACTION_ROUTE[act], { orgId: c.state.orgId, identity: id }).then(function (r) {
            if (!r || !r.ok) { c.toast(refusal(r)); return; }
            c.toast("Updated."); WSQ.render("admin");
          });
        };
      });
      document.getElementById("admMemberAdd").onclick = function () {
        var id = (document.getElementById("admMemberIdentity").value || "").trim();
        if (!id) { document.getElementById("admMemMsg").innerHTML = '<div class="msg err">Enter the staff ID or email.</div>'; return; }
        var memberBody = { orgId: c.state.orgId, identity: id, role: document.getElementById("admMemberRole").value, regNo: (document.getElementById("admMemberRegNo").value || "").trim() };
        var mobile = (document.getElementById("admMemberMobile").value || "").trim();
        if (mobile) memberBody.alertMobile = mobile;
        c.api("/member", memberBody).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admMemMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Staff saved."); WSQ.render("admin");
        });
      };
      document.getElementById("admPinSave").onclick = function () {
        var id = (document.getElementById("admPinId").value || "").trim(), pin = document.getElementById("admPinVal").value;
        if (!id || !pin) { document.getElementById("admPinMsg").innerHTML = '<div class="msg err">Enter the identity and a PIN.</div>'; return; }
        c.api("/member/pin", { orgId: c.state.orgId, identity: id, pin: pin }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admPinMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("PIN set."); document.getElementById("admPinVal").value = "";
        });
      };
      document.getElementById("admPwSave").onclick = function () {
        var id = (document.getElementById("admPwId").value || "").trim(), email = document.getElementById("admPwEmail").value, pw = document.getElementById("admPwVal").value;
        if (!id || !email || !pw) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">Enter identity, email and password.</div>'; return; }
        c.api("/member/password", { orgId: c.state.orgId, identity: id, email: email, password: pw }).then(function (r) {
          if (!r || !r.ok) { document.getElementById("admPwMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
          c.toast("Password set."); document.getElementById("admPwVal").value = "";
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
    var h = '<div class="card"><h2>This hospital\'s groups</h2>';
    if (r == null) return h + '<span class="spin"></span> Loading...</div>';
    if (r.failed) return h + '<div class="msg err">Could not be loaded: ' + esc(r.message || "failed") + ". Do not read this as no groups or invitations.</div></div>";
    if (!r.groups.length) return h + '<p class="quiet">This hospital is not in a hospital group and has no invitations.</p></div>';
    /* D4 B: groups read what this hospital PUBLISHES, not its live record. Say what was last published, by whom
     * and when, and offer to publish now. A snapshot that could not be read is said, never shown as none. */
    var s = r.snapshot, when = function (ms) { return new Date(ms).toLocaleString(); };
    var member = r.groups.some(function (g) { return g.state === "member"; });
    var pub = !member ? "" : '<h3>Counts published to groups</h3>' +
      (s === false ? '<div class="msg err">What this hospital last published could not be read.</div>'
        : s ? "<p>Last published " + esc(when(s.publishedAt)) + " by " + esc(s.publishedBy || "unknown") + ".</p>"
        : '<p class="quiet">Not published yet: groups see this hospital as "not published".</p>') +
      '<p><button type="button" class="btn" data-grp-publish="1">Publish counts now</button> <span class="quiet">Groups see the counts as they are at this moment, with this time on them.</span></p>';
    return h + '<p class="quiet">A group sees the counts this hospital publishes (census, free beds, ED waiting, open critical results, staff short). It never sees a patient. Leaving takes effect at once.</p>' + pub +
      '<div class="tbl"><table><thead><tr><th>Group</th><th>Status</th><th>Recommended settings</th><th></th></tr></thead><tbody>' +
      r.groups.map(function (g) {
        var id = esc(g.groupId);
        var pol = g.policy ? Object.keys(g.policy) : [];
        return "<tr><td>" + esc(g.name || g.groupId) + "</td><td>" + (g.state === "member" ? '<span class="pill ok">member</span>' : '<span class="pill warn">invited, not a member yet</span>') + "</td><td>" +
          (g.state !== "member" ? "" : pol.length ? esc(pol.join(", ")) + " (version " + esc(g.policyVersion) + ")" : '<span class="quiet">none published</span>') + "</td><td>" +
          (g.state === "invited"
            ? '<button type="button" class="btn" data-grp-side="accept" data-grp="' + id + '">Accept</button> <button type="button" class="btn ghost" data-grp-side="decline" data-grp="' + id + '">Decline</button>'
            : (pol.length ? '<button type="button" class="btn" data-grp-side="adopt" data-grp="' + id + '">Adopt recommended settings</button> ' : "") +
              '<button type="button" class="btn ghost" data-grp-side="remove" data-grp="' + id + '">Leave group</button>') + "</td></tr>";
      }).join("") + '</tbody></table></div><div id="grpSideMsg"></div></div>';
  }
  function groupRunHtml(c, r) {
    var esc = c.esc;
    var h = '<div class="card"><h2>Hospital groups you run</h2>';
    if (r == null) return h + '<span class="spin"></span> Loading...</div>';
    if (r.failed) return h + '<div class="msg err">Could not be loaded: ' + esc(r.message || "failed") + ".</div></div>";
    h += r.groups.length ? r.groups.map(function (g) {
      var id = esc(g.id);
      /* Who runs this group beside you. The server names opaque account ids, not emails, so they
       * read as-is; removing is per admin, and the last one has no button because the server
       * refuses to leave a group with nobody able to run it. */
      var admins = Array.isArray(g.adminUids) ? g.adminUids : [];
      var adminHtml = "<p>Administrators:</p><ul>" + admins.map(function (u) {
        return '<li><span class="mono">' + esc(u) + "</span>" + (admins.length > 1 ?
          ' <button type="button" class="btn quiet" data-grp-run="adminRemove" data-grp="' + id + '" data-uid="' + esc(u) + '">Remove</button>' : "") + "</li>";
      }).join("") + "</ul>" +
        '<div class="row"><label class="f"><span>Add administrator (their StewardMD account email)</span><input type="email" data-grp-adminadd-input="' + id + '"></label>' +
        '<button type="button" class="btn" data-grp-run="adminAdd" data-grp="' + id + '">Add administrator</button></div>';
      return "<h3>" + esc(g.name) + "</h3>" +
        '<p><button type="button" class="btn ghost" data-go="group/' + id + '">Open group overview</button></p>' +
        adminHtml +
        (g.members.length ? "<p>Members:</p><ul>" + g.members.map(function (m) {
          return "<li>" + esc(m.name || m.orgId) + ' <span class="mono">' + esc(m.orgId) + '</span> <button type="button" class="btn quiet" data-grp-run="remove" data-grp="' + id + '" data-org="' + esc(m.orgId) + '">Remove</button></li>';
        }).join("") + "</ul>" : '<p class="quiet">No member hospitals yet.</p>') +
        (g.invited.length ? "<p>Invited, waiting for the hospital's owner to accept:</p><ul>" + g.invited.map(function (m) {
          return '<li><span class="mono">' + esc(m.orgId) + '</span> <button type="button" class="btn quiet" data-grp-run="remove" data-grp="' + id + '" data-org="' + esc(m.orgId) + '">Withdraw invitation</button></li>';
        }).join("") + "</ul>" : "") +
        '<div class="row"><label class="f"><span>Invite a hospital (id or SMD code)</span><input data-grp-invite-input="' + id + '"></label>' +
        '<button type="button" class="btn" data-grp-run="invite" data-grp="' + id + '">Invite</button></div>' +
        '<label class="f"><span>Recommended settings (JSON, version ' + esc(g.policyVersion) + ')</span><textarea rows="5" style="width:100%;font-family:monospace" data-grp-policy-input="' + id + '">' + esc(g.policy ? JSON.stringify(g.policy, null, 2) : "") + "</textarea></label>" +
        '<button type="button" class="btn ghost" data-grp-run="policy" data-grp="' + id + '">Publish recommended settings</button>' +
        '<div class="row"><label class="f" style="flex:0 1 260px"><span>Mark a hospital\'s counts stale after (minutes)</span><input type="number" min="5" max="10080" data-grp-stale-input="' + id + '" value="' + esc(g.staleAfterMinutes || 60) + '"></label>' +
        '<button type="button" class="btn ghost" data-grp-run="staleAfter" data-grp="' + id + '">Save</button></div>' +
        '<p class="quiet">A member hospital\'s admin decides whether to adopt them. Nothing changes in any hospital until they do.</p>';
    }).join("") : '<p class="quiet">You do not run a hospital group.</p>';
    return h + '<h3>Create a group</h3><div class="row"><label class="f"><span>Group name</span><input id="grpNewName"></label>' +
      '<button type="button" class="btn" id="grpCreate">Create group</button></div><div id="grpRunMsg"></div></div>';
  }
  WSQ._groupAdmin = { side: groupSideHtml, run: groupRunHtml };

  function renderGroup(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = '<div id="grpSide">' + groupSideHtml(c, null) + '</div><div id="grpRun">' + groupRunHtml(c, null) + "</div>";
    var say = function (id, x) { var m = document.getElementById(id); if (m) m.innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; };
    var side = c.api("/group/memberships" + q).then(function (r) {
      var box = document.getElementById("grpSide");
      box.innerHTML = groupSideHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) });
      var pb = box.querySelector("[data-grp-publish]");
      if (pb) pb.onclick = function () {
        pb.disabled = true;
        c.api("/group/publish-counts", { orgId: c.state.orgId }).then(function (x) {
          if (!x || !x.ok) { pb.disabled = false; say("grpSideMsg", x); return; }
          c.toast("Counts published."); WSQ.render("admin");
        });
      };
      box.querySelectorAll("[data-grp-side]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-grp-side"), gid = b.getAttribute("data-grp");
          if (!GROUP_SIDE_ROUTE[act]) return;
          if (act === "remove" && !window.confirm("Leave this group? It stops seeing this hospital's counts at once.")) return;
          if (act === "adopt" && !window.confirm("Copy the group's recommended settings into this hospital's own configuration? Settings of the same name are replaced; this is recorded in the audit trail.")) return;
          b.disabled = true;
          c.api("/group/" + GROUP_SIDE_ROUTE[act], { orgId: c.state.orgId, groupId: gid }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; say("grpSideMsg", x); return; }
            if (act === "adopt" && x.org) c.state.org = x.org;
            c.toast({ accept: "Joined the group.", decline: "Invitation declined.", remove: "Left the group.", adopt: "Recommended settings copied into this hospital." }[act]);
            WSQ.render("admin");
          });
        };
      });
    });
    var run = c.api("/group/my-groups").then(function (r) {
      var box = document.getElementById("grpRun");
      box.innerHTML = groupRunHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) });
      var create = document.getElementById("grpCreate");
      if (create) create.onclick = function () {
        var name = (document.getElementById("grpNewName").value || "").trim();
        if (!name) { say("grpRunMsg", { message: "Give the group a name." }); return; }
        create.disabled = true;
        c.api("/group/create", { name: name }).then(function (x) {
          if (!x || !x.ok) { create.disabled = false; say("grpRunMsg", x); return; }
          c.toast("Group created."); WSQ.render("admin");
        });
      };
      box.querySelectorAll("[data-grp-run]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-grp-run"), gid = b.getAttribute("data-grp"), payload = { groupId: gid };
          if (!GROUP_RUN_ROUTE[act]) return;
          if (act === "invite") {
            payload.orgId = (box.querySelector('[data-grp-invite-input="' + gid + '"]').value || "").trim();
            if (!payload.orgId) { say("grpRunMsg", { message: "Enter the hospital's id or SMD code." }); return; }
          } else if (act === "remove") {
            payload.orgId = b.getAttribute("data-org");
            if (!window.confirm("Remove this hospital from the group?")) return;
          } else if (act === "policy") {
            var raw = (box.querySelector('[data-grp-policy-input="' + gid + '"]').value || "").trim();
            try { payload.policy = raw ? JSON.parse(raw) : null; } catch (e) { say("grpRunMsg", { message: "That is not valid JSON, so nothing was published." }); return; }
          } else if (act === "adminAdd") {
            payload.email = (box.querySelector('[data-grp-adminadd-input="' + gid + '"]').value || "").trim();
            if (!payload.email) { say("grpRunMsg", { message: "Enter the administrator's StewardMD account email." }); return; }
          } else if (act === "adminRemove") {
            payload.uid = b.getAttribute("data-uid");
            if (!window.confirm("Remove this administrator from the group? They stop seeing it at once.")) return;
          } else if (act === "staleAfter") {
            payload.minutes = Number(box.querySelector('[data-grp-stale-input="' + gid + '"]').value);
          }
          b.disabled = true;
          c.api("/group/" + GROUP_RUN_ROUTE[act], payload).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; say("grpRunMsg", x); return; }
            c.toast({ invite: "Invitation sent. The hospital's owner must accept it.", remove: "Removed.", policy: "Recommended settings published.", adminAdd: "Administrator added.", adminRemove: "Administrator removed.", staleAfter: "Saved." }[act]);
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
      if (!r || !r.ok) { body.innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
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
      body.innerHTML = '<div class="card"><h2>MaiK clinical AI</h2>' +
        '<div class="kv"><dt>Enabled</dt><dd>' + (r.enabled ? "yes" : "no") + "</dd>" +
        "<dt>Patient data approved for Vertex AI</dt><dd>" + (cloudApproved ? (vx.phiCapable ? "yes" : "approved, but this server cannot send patient data to Vertex yet") : "no") + "</dd>" +
        "<dt>Model allowlist</dt><dd>" + (Array.isArray(r.allow) && r.allow.length ? c.esc(r.allow.join(", ")) : "none (registry default)") + "</dd>" +
        "<dt>Timeout</dt><dd>" + c.esc(String(r.timeoutMs || "")) + " ms</dd></div>" +
        '<h3>Providers</h3><div class="tbl"><table><thead><tr><th>Provider</th><th>Configured</th><th>Detail</th><th>Credential</th></tr></thead><tbody>' +
        (r.providers || []).map(function (p) {
          return "<tr><td>" + c.esc(p.provider) + '</td><td><span class="pill' + (p.configured ? " ok" : " stop") + '">' + (p.configured ? "yes" : "no") + "</span></td><td>" + c.esc(p.detail || "") + "</td><td>" + c.esc(p.credentialSource || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        '<h3>Settings</h3><div class="row">' +
        '<label class="f"><input type="checkbox" id="admMaikEnabled"' + (r.enabled ? " checked" : "") + "> MaiK enabled</label></div>" +
        /* The on-premises model. The gateway ranks a model on the hospital's own hardware ABOVE any
         * cloud one, so a hospital that runs its own never sends a chart off-site. It was reachable
         * only by editing the org document by hand until this existed. */
        '<h3>On-premises model</h3><div class="row">' +
        '<label class="f"><span>Base URL (OpenAI-compatible)</span><input id="admMaikLocalUrl" placeholder="http://10.0.0.5:8000/v1" value="' + c.esc(localUrl) + '"></label>' +
        '<label class="f"><span>Model name</span><input id="admMaikLocalModel" placeholder="the name the server answers to" value="' + c.esc(localModel) + '"></label></div>' +
        '<div class="row"><label class="f"><input type="checkbox" id="admMaikPhiLocal"' + (localApproved ? " checked" : "") + "> Patient data may be sent to the on-premises model</label></div>" +
        '<h3>Cloud model</h3><div class="row">' +
        '<label class="f"><input type="checkbox" id="admMaikPhi"' + (cloudApproved ? " checked" : "") + "> Patient data may be sent to Vertex AI (the cloud provider with a patient-data agreement)</label>" +
        (vx.phiCapable === false ? '<div class="msg err">' + c.esc(vx.detail || "Vertex AI cannot receive patient data on this server.") + "</div>" : "") +
        '<button class="btn" id="admMaikSave" type="button">Save</button></div><div id="admMaikMsg"></div>' +
        '<div class="msg note">Enabling MaiK uses the providers listed above. A cloud provider only answers when the environment holds its key (named under Credential). Patient data leaves the hospital only when the second switch is on. Clinical content from MaiK is not signed off.</div>' +
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
          if (!ur || !ur.ok) { btn.disabled = false; document.getElementById("admMaikMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(ur)) + "</div>"; return; }
          return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (or2) {
            btn.disabled = false;
            if (or2 && or2.ok) c.state.org = or2.org;
            c.toast("MaiK settings saved."); WSQ.render("admin");
          });
        }, function () { btn.disabled = false; document.getElementById("admMaikMsg").innerHTML = '<div class="msg err">No response from the server. The settings may not have been saved; reload to check.</div>'; });
      };
    });
  }
  // ---- Security review (P2.17) ----------------------------------------------------------------
  /* Advisory findings over the audit trail, a review queue for break-glass and admin acts, and data
   * protection. Loading, failed, unavailable and empty are four different sentences: a section that
   * could not be checked must never read as "nothing found", and nothing here is green without a
   * recorded backup AND a recorded restore test. */
  var SEC_TYPE_LABEL = {
    "chart-access-volume": "Unusually many patients read", "chart-access-off-hours": "Reads outside usual hours",
    "repeated-denied": "Repeated denied actions", "unusual-export": "Unusual export volume",
    "out-of-assignment": "Read outside an assignment", "failed-sign-ins": "Many failed sign-ins", "new-device": "Sign-in from a new device", "many-devices": "Many devices in a short time"
  };
  var SEC_STATUS_LABEL = { green: "Protected: recent backup and a successful restore test on record", amber: "Needs attention", red: "Not protected", unavailable: "Unknown: could not be checked" };

  function secSection(c, title, s, days) {
    var esc = c.esc;
    var h = "<h3>" + esc(title) + "</h3>";
    if (!s || s.status !== "ok") return h + '<div class="msg err">Could not be checked' + (s && s.detail ? ": " + esc(s.detail) : "") + ". This is not the same as nothing being found.</div>";
    if (s.truncated || s.partial) h += '<div class="msg note">Only part of the log could be read, so some activity may not have been checked.</div>';
    if (!s.findings.length) return h + '<p class="quiet">No findings in the last ' + esc(days) + " days.</p>";
    return h + s.findings.map(function (f) {
      /* G11: an out-of-assignment finding shows the ward history behind each read. */
      var wards = f.type === "out-of-assignment";
      return "<details><summary><b>" + esc(SEC_TYPE_LABEL[f.type] || f.type) + "</b>: " + esc(f.actor) + ". " + esc(f.summary) + "</summary>" +
        '<p class="quiet">' + esc(f.method) + "</p>" +
        ((f.signIns || []).length ? '<p class="quiet">Counted as one reader across these sign-ins: <span class="mono">' + f.signIns.map(esc).join(", ") + "</span></p>" : "") +
        '<div class="tbl"><table><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Patient ref</th>' + (wards ? "<th>Patient's ward then</th><th>Reader rostered on then</th>" : "") + "<th>Outcome</th><th>Detail</th><th>Audit row</th></tr></thead><tbody>" +
        f.evidence.map(function (e) {
          return "<tr><td>" + esc(e.ts) + "</td><td>" + esc(e.action) + "</td><td>" + esc(e.resourceType || "") + '</td><td class="mono">' + esc(e.patientRef || "") + "</td>" +
            (wards ? "<td>" + esc(e.wardAtRead || "") + "</td><td>" + esc((e.readerWardsAtRead || []).length ? e.readerWardsAtRead.join(", ") : "No ward shift") + "</td>" : "") +
            "<td>" + esc(e.outcome || "") + "</td><td>" + esc(e.detail || "") + '</td><td class="mono">' + esc(e.id || "") + (e.recordId ? "<br>" + esc(e.recordId) : "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (f.evidenceTotal > f.evidence.length ? '<p class="quiet">Showing ' + f.evidence.length + " of " + esc(f.evidenceTotal) + " rows.</p>" : "") + openRowsHtml(c, f.evidence) + "</details>";
    }).join("");
  }

  /* G11 CLICKABLE EVIDENCE. A button that reads the audit rows behind a finding back from the audit trail
   * (GET /ward/audit-rows): null while loading, a failure says so, ids not found are named. */
  function openRowsHtml(c, evidence) {
    var ids = (evidence || []).map(function (e) { return e.id; }).filter(Boolean);
    if (!ids.length) return "";
    return '<button type="button" class="btn ghost sm" data-sec-rows="' + c.esc(ids.join(",")) + '">Open these audit rows</button><div class="sec-rows-out"></div>';
  }
  function auditRowsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<p class="quiet"><span class="spin"></span> Reading the audit rows...</p>';
    if (r.failed) return '<div class="msg err">The audit rows could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as there being none.</div>";
    var h = (r.missing || []).length ? '<div class="msg err">' + esc(r.missing.length) + " of the audit rows named were not found in this hospital's audit trail: <span class=\"mono\">" + r.missing.map(esc).join(", ") + "</span></div>" : "";
    if (!(r.rows || []).length) return h + '<p class="quiet">No audit row was returned.</p>';
    return h + '<div class="tbl"><table><thead><tr><th>When</th><th>By</th><th>Action</th><th>Type</th><th>Record</th><th>Patient ref</th><th>Outcome</th><th>Chained row</th><th>Audit row</th></tr></thead><tbody>' +
      r.rows.map(function (e) {
        return "<tr><td>" + esc(e.ts) + '</td><td class="mono">' + esc(e.actor || "") + "</td><td>" + esc(e.action || "") + "</td><td>" + esc(e.resourceType || "") + '</td><td class="mono">' + esc(e.recordId || "") +
          '</td><td class="mono">' + esc(e.patientRef || "") + "</td><td>" + esc(e.outcome || "") + "</td><td>" + (e.chainSeq == null ? "Not linked" : esc(e.chainSeq)) + '</td><td class="mono">' + esc(e.id || "") + "</td></tr>";
      }).join("") + "</tbody></table></div>";
  }
  WSQ._auditRowsHtml = auditRowsHtml;

  /* Reads outside an assignment. "Not evaluated" is its own state and never renders as no findings. */
  function secAssignment(c, s, days) {
    var esc = c.esc;
    var h = "<h3>Reads outside an assignment</h3>";
    if (!s || (s.status !== "ok" && s.status !== "not_evaluated")) return h + '<div class="msg err">Could not be checked' + (s && s.detail ? ": " + esc(s.detail) : "") + ". This is not the same as nothing being found.</div>";
    var ex = (s.exemptions || []).length ? "<details><summary>Exempt from this check</summary><ul>" + s.exemptions.map(function (x) { return "<li>" + esc(x.rule) + " " + esc(x.reason) + "</li>"; }).join("") + "</ul></details>" : "";
    if (s.status === "not_evaluated") return h + '<div class="msg note">Not evaluated: ' + esc(s.reason) + " This is not the same as no findings.</div>" + ex;
    if (s.truncated) h += '<div class="msg note">Only part of the log could be read, so some reads may not have been checked.</div>';
    if ((s.incomplete || []).length) h += '<div class="msg note">Incomplete: ' + esc(s.incomplete.join("; ")) + ".</div>";
    if ((s.matching || []).length) h += '<div class="msg note">' + esc(s.matching.join(" ")) + "</div>";
    h += '<p class="quiet">' + esc(s.readsInPeriod) + " reads in the period: " + esc(s.assignedReads) + " within an assignment.</p>";
    h += s.findings.length ? secSection(c, "", { status: "ok", findings: s.findings }, days).replace("<h3></h3>", "") : '<p class="quiet">No reads outside an assignment among the reads that could be compared.</p>';
    var list = function (title, rows, field) {
      return rows.length ? "<details><summary>" + esc(title) + " (" + rows.reduce(function (n, x) { return n + x.reads; }, 0) + " reads)</summary><ul>" +
        rows.map(function (x) {
          return "<li>" + esc(x.actor) + ": " + esc(x.reads) + " reads. " + esc(x[field]) + ' <span class="quiet mono">' + x.evidence.map(function (e) { return esc(e.id); }).join(", ") + "</span> " + openRowsHtml(c, x.evidence) + "</li>";
        }).join("") + "</ul></details>" : "";
    };
    return h + list("Not evaluated", s.notEvaluated || [], "reason") + list("Exempt", s.exempt || [], "exemption") + ex;
  }

  function securityReviewHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><span class="spin"></span> Loading the security review...</div>';
    if (r.failed) return '<div class="card"><div class="msg err">The security review could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as there being nothing to review.</div></div>";
    var h = '<div class="card"><h2>Security review, last ' + esc(r.days) + " days</h2>" +
      '<div class="msg note">' + esc(r.note) + "</div>";
    var types = Object.keys(r.counts || {});
    h += types.length ? '<div class="tbl"><table><thead><tr><th>Finding</th><th>Count</th></tr></thead><tbody>' +
      types.map(function (t) { return "<tr><td>" + esc(SEC_TYPE_LABEL[t] || t) + "</td><td>" + esc(r.counts[t]) + "</td></tr>"; }).join("") + "</tbody></table></div>"
      : '<p class="quiet">No findings in the sections that could be checked. Check each section below for any that could not.</p>';
    h += secSection(c, "Chart access", r.chartAccess, r.days) + secAssignment(c, r.assignmentAccess, r.days) + secSection(c, "Exports", r.exports, r.days) + secSection(c, "Sign-ins", r.logins, r.days);
    h += "<h3>Not checked, and why</h3><ul>" + (r.notDetected || []).map(function (n) { return "<li>" + esc(n.rule) + ": " + esc(n.reason) + "</li>"; }).join("") + "</ul></div>";

    var q = r.reviewQueue || {};
    h += '<div class="card"><h2>Review queue</h2>';
    if (q.status === "ok" || q.status === "partial") {
      if (q.missing && q.missing.length) h += '<div class="msg note">Incomplete: ' + esc(q.missing.join("; ")) + ".</div>";
      h += q.items.length ? '<p class="quiet">' + esc(q.awaiting) + " awaiting review.</p>" +
        '<div class="tbl"><table><thead><tr><th>What</th><th>By</th><th>When</th><th>Detail</th><th>Status</th><th></th></tr></thead><tbody>' +
        q.items.map(function (i) {
          var key = esc(i.kind + "|" + i.subjectId);
          var hist = i.reviews.map(function (v) { return esc(v.decision) + " by " + esc(v.reviewedBy) + " (" + esc(v.at) + ")" + (v.note ? ": " + esc(v.note) : ""); }).join("<br>");
          return "<tr><td>" + esc(i.kind === "break-glass" ? "Break-glass" : i.action) + "</td><td>" + esc(i.actor) + "</td><td>" + esc(i.at || "") + "</td><td>" + esc(i.detail) + "</td><td>" +
            esc(i.status === "awaiting" ? "Awaiting review" : i.status === "appropriate" ? "Reviewed, appropriate" : "Needs follow-up") + (hist ? '<br><span class="quiet">' + hist + "</span>" : "") + "</td><td>" +
            (i.ownAction ? '<span class="quiet">Your own action: another administrator must review it.</span>'
              : '<button type="button" class="btn ghost" data-sec-review="' + key + '|appropriate">Reviewed, appropriate</button> ' +
                '<button type="button" class="btn ghost" data-sec-review="' + key + '|follow-up">Needs follow-up</button>') + "</td></tr>";
        }).join("") + "</tbody></table></div>" : '<p class="quiet">No break-glass grants or admin actions to review.</p>';
    } else h += '<div class="msg err">The review queue could not be loaded' + (q.detail ? ": " + esc(q.detail) : "") + ". This is not the same as nothing awaiting review.</div>";
    h += '<div id="secRevMsg"></div></div>';

    var d = r.dataProtection || {};
    h += '<div class="card"><h2>Data protection</h2><p><b>' + esc(SEC_STATUS_LABEL[d.status] || "Unknown") + "</b></p>" +
      ((d.reasons || []).length ? "<ul>" + d.reasons.map(function (x) { return "<li>" + esc(x) + "</li>"; }).join("") + "</ul>" : "");
    if (d.status !== "unavailable") {
      h += "<p>Last backup: " + (d.lastBackup ? esc(d.lastBackup.at) + ", " + esc(d.lastBackup.rows) + " rows, stored at " + esc(d.lastBackup.location) : "never recorded") + "</p>" +
        "<p>Last restore test: " + (d.lastRestoreTest ? esc(d.lastRestoreTest.at) + ", " + esc(d.lastRestoreTest.outcome) + ", restored " + esc(d.lastRestoreTest.restoredWhat) + ", by " + esc(d.lastRestoreTest.performedBy) : "never recorded") + "</p>";
    }
    h += "<h3>Record a restore test</h3><div class=\"row\">" +
      '<label class="f"><span>What was restored</span><input id="secRtWhat" placeholder="Backup of 12 Sep into a test database"></label>' +
      '<label class="f"><span>Outcome</span><select id="secRtOutcome"><option value="">Choose</option><option value="success">Success</option><option value="partial">Partial</option><option value="failed">Failed</option></select></label>' +
      '<label class="f"><span>Done by</span><input id="secRtBy"></label>' +
      '<label class="f"><span>Note</span><input id="secRtNote"></label>' +
      '</div><button type="button" class="btn" id="secRtSave">Record restore test</button><div id="secRtMsg"></div></div>';

    var a = r.auditRetention || {};
    h += '<div class="card"><h2>Audit retention</h2>';
    h += a.status === "ok"
      ? "<p>" + esc(a.configuredNote) + "</p><p>Oldest audit row: " + esc(a.oldestAuditAt || "none found") + "</p><p>Oldest record: " + esc(a.oldestRecordAt || "none") + "</p>" +
        (a.gap ? '<div class="msg err">' + esc(a.gap) + "</div>" : "")
      : '<div class="msg err">Audit retention could not be checked.</div>';
    h += "<h3>Tamper evidence</h3>" + auditIntegrityHtml(c, a.integrity, a.anchors);
    /* G3: the hospital event log is chained on its own and reported on its own. */
    h += "<h3>Tamper evidence: hospital event log</h3><p class=\"quiet\">Sign-ins, staff changes, hospital setting changes, and queue and billing actions.</p>" +
      auditIntegrityHtml(c, a.orgIntegrity, a.orgAnchors, "event-log") + orgUnlinkedHtml(c, a.orgUnlinked);
    return h + "</div>";
  }
  WSQ._securityReviewHtml = securityReviewHtml;

  /* G3. Event-log rows with no link are never verified. Rows added after linking began are listed;
   * a count that could not be made says so, never "every row linked". */
  function orgUnlinkedHtml(c, u) {
    var esc = c.esc;
    if (!u || u.status !== "ok") return '<div class="msg err">Unlinked rows not counted: ' + esc((u && u.message) || "no result was returned") + " This is not the same as every row being linked.</div>";
    var cls = u.after ? "err" : (u.unlinked || u.partial ? "note" : "ok");
    var h = '<div class="msg ' + cls + '"><b>' + (u.after ? "Rows without a link" : u.unlinked ? "Unlinked rows" : "Every row read is linked") + "</b>: " + esc(u.message) + "</div>";
    if ((u.evidence || []).length) {
      h += '<div class="tbl"><table><thead><tr><th>When</th><th>By</th><th>Action</th><th>Row</th></tr></thead><tbody>' +
        u.evidence.map(function (e) { return "<tr><td>" + esc(e.ts) + "</td><td>" + esc(e.actor || "") + "</td><td>" + esc(e.action || "") + '</td><td class="mono">' + esc(e.id || "") + "</td></tr>"; }).join("") +
        "</tbody></table></div>" + (u.after > u.evidence.length ? '<p class="quiet">Showing ' + esc(u.evidence.length) + " of " + esc(u.after) + " rows.</p>" : "");
    }
    return h;
  }
  WSQ._orgUnlinkedHtml = orgUnlinkedHtml;

  /* P2.17. Only "ok" and "empty" read as fine. Broken and gap name the row; not verified and a missing
   * result both say the integrity is unknown, never that it is intact. */
  var INTEGRITY_LABEL = { ok: "Intact", empty: "Nothing to verify yet", broken: "Altered", gap: "Rows missing", not_verified: "Not verified" };
  /* P2.17 anchors. One line for the outside copy whatever state it is in: matches, differs, nothing
   * recorded yet, or not verified. A missing anchor result is unknown, never intact. A differing
   * copy names the governance lead because restoring over it would destroy the evidence. */
  var ANCHOR_LABEL = { ok: "Outside copy matches", rewritten: "Outside copy differs", truncated: "Newest rows removed", "no-anchors": "No outside copy yet", "not-verified": "Outside copy not verified", disagree: "Outside copies disagree" };
  /* G12: `chain` is "" for the clinical audit trail and "event-log" for the hospital event log; the
   * acknowledgement form of each carries its own ids so both can be on the page at once. */
  var ACK_SUFFIX = { "": "", "event-log": "Org" };
  function anchorHtml(c, a, chain) {
    var esc = c.esc;
    if (a == null) return "";
    /* A restarted log names its acknowledgement instead of reading silently green. */
    if (a.status === "ok" && a.acknowledgement) return anchorAckLineHtml(c, a.acknowledgement);
    var cls = a.status === "ok" ? "ok" : (a.status === "no-anchors" ? "note" : "err");
    var h = '<div class="msg ' + cls + '"><b>' + esc(ANCHOR_LABEL[a.status] || "Outside copy not verified") + "</b>: " + esc(a.message || "");
    if (a.status === "disagree") return h + " Tell the information governance lead. Do not restore or re-import.</div>";
    if (a.status === "rewritten" || a.status === "truncated") {
      h += " Tell the information governance lead. Do not restore or re-import.</div>";
      h += '<div class="msg note">If the database was restored on purpose (for example a point in time restore), this report is expected and stays until it is acknowledged. Only the owner of this hospital can acknowledge a legitimate restore, with a reason and an incident reference. Do not acknowledge a difference nobody can explain: ask the information governance lead first.</div>';
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
  var ACK_PREVIOUS_LABEL = { rewritten: "differed from the database", truncated: "showed rows removed below the application" };
  function anchorAckLineHtml(c, k) {
    var esc = c.esc;
    k = k || {};
    var h = '<div class="msg ok"><b>Acknowledged restore</b>: ' + esc(k.by || "") + " acknowledged a legitimate restore on " + esc(k.at || "") +
      " (incident " + esc(k.incidentRef || "") + "). Before the acknowledgement the outside copy " +
      esc(ACK_PREVIOUS_LABEL[k.previousStatus] || ("reported " + (k.previousStatus || "a break"))) +
      (k.previousAtSeq != null ? " at chained row " + esc(k.previousAtSeq) : "") + ".";
    if (k.reason) h += "<br>Reason given: " + esc(k.reason);
    h += "</div>" + '<p class="quiet">The anchor log from before this acknowledgement is kept as an archive and is never deleted. A new difference after this point is reported again.</p>';
    return h;
  }
  WSQ._anchorAckLineHtml = anchorAckLineHtml;
  /* P2.17 acknowledgement form (owner only, see anchorHtml). The reason needs at least 20
   * characters and an incident reference; the server checks both again. Nothing here decides
   * authority: a non-owner who forges this form gets a 403 from the route. */
  function anchorAckFormHtml(c, chain) {
    var x = ACK_SUFFIX[chain || ""] || "";
    return '<div class="card"><h3>Acknowledge a legitimate restore' + (x ? " of the hospital event log" : "") + "</h3>" +
      '<p class="quiet">This archives the current outside copy and restarts it from the newest row, and records the acknowledgement in the audit trail under your name. Only do this when the restore was planned and is written up under the incident reference below. Never put patient details in the reason.</p>' +
      '<div class="row"><label class="f"><span>Why was the database restored (at least 20 characters)</span><input id="secAckReason' + x + '" placeholder="Planned point in time restore after..."></label>' +
      '<label class="f"><span>Incident reference</span><input id="secAckIncident' + x + '" placeholder="INC-123"></label></div>' +
      '<button type="button" class="btn" id="secAckReview' + x + '">Review acknowledgement</button><div id="secAckConfirm' + x + '"></div><div id="secAckMsg' + x + '"></div></div>';
  }
  WSQ._anchorAckFormHtml = anchorAckFormHtml;
  /* The confirm step: the entered values read back before anything is sent. Pure so it renders
   * the same in the page and in tests. */
  function anchorAckConfirmHtml(c, reason, incident, chain) {
    var esc = c.esc, x = ACK_SUFFIX[chain || ""] || "";
    return '<div class="msg note"><b>Check before confirming.</b> You are acknowledging a legitimate restore of ' + (x ? "the hospital event log" : "the audit trail") + ".<br>" +
      "Reason: " + esc(reason) + "<br>Incident: " + esc(incident) + "</div>" +
      '<button type="button" class="btn" id="secAckGo' + x + '">Confirm acknowledgement</button> <button type="button" class="btn ghost" id="secAckBack' + x + '">Back</button>';
  }
  WSQ._anchorAckConfirmHtml = anchorAckConfirmHtml;
  function auditIntegrityHtml(c, ig, anchors, chain) {
    var esc = c.esc;
    if (!ig) return '<div class="msg err">Not verified: no integrity result was returned. This is not the same as the audit trail being intact.</div>' + anchorHtml(c, anchors === undefined ? null : anchors, chain);
    var fine = ig.status === "ok" || ig.status === "empty";
    var h = '<div class="msg ' + (fine ? "ok" : "err") + '"><b>' + esc(INTEGRITY_LABEL[ig.status] || "Not verified") + "</b>: " + esc(ig.message || "") + "</div>";
    if (ig.atSeq != null) {
      h += '<div class="tbl"><table><tbody><tr><th>Chained row</th><td>' + esc(ig.atSeq) + "</td></tr>" +
        (ig.auditId ? '<tr><th>Audit row</th><td class="mono">' + esc(ig.auditId) + "</td></tr>" : "") +
        (ig.expected ? '<tr><th>Expected</th><td class="mono">' + esc(ig.expected) + '</td></tr><tr><th>Found</th><td class="mono">' + esc(ig.found || "") + "</td></tr>" : "") +
        "</tbody></table></div>";
    }
    if (anchors !== undefined && anchors !== null) h += anchorHtml(c, anchors, chain);
    return h + '<p class="quiet">Each audit row is linked to the one before it by a hash, so a change or removal made in the database itself shows here. The newest rows are checked each time. Once an hour the newest row number is also copied to two stores outside the database (KV and Firestore) and compared here, and the two copies are compared with each other. Rows written before this was switched on are not linked and cannot be checked.</p>';
  }
  WSQ._auditIntegrityHtml = auditIntegrityHtml;

  /* DATA EXPORT (FHIR). The hospital's record as FHIR Bulk Data NDJSON (functions/_wardsynq/fhir-bulk.js).
   * The list is null while loading and false when it failed, and a failed load never renders as "no
   * exports". Each status reads differently: running, done (with its files and counts, even when a
   * type had nothing), failed (with the reason), cancelled, expired. Anything the export could not
   * include is listed under the job, never hidden. */
  var EXPORT_STATUS = { "in-progress": "Running", complete: "Done", failed: "Failed", cancelled: "Cancelled", expired: "Expired, files deleted" };
  /* G9. `groups` is the ward census as a FHIR Bundle of Group (fhir-group.js): null while loading, false when
   * it failed. A failed ward list leaves the whole-hospital export available and says the wards could not be
   * listed, rather than offering none. */
  function exportHtml(c, r, groups) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("cloud_download") + " Data export (FHIR)</h2>" +
      '<p class="quiet">Exports this hospital\'s record as FHIR R4 NDJSON, one file per resource type, in the background. One export runs at a time. Files are downloaded here, or through the FHIR Bulk Data API ($export-status), with this hospital\'s authorization; every download is recorded in the audit trail, and files are deleted after 24 hours.</p>';
    if (r === null) return h + '<span class="spin"></span></div>';
    if (r === false || r.failed) return h + '<div class="msg err">Exports could not be loaded' + (r && r.message ? ": " + esc(r.message) : "") + ". This is not the same as there being none.</div></div>";
    var wardOpts = groups && groups.entry ? groups.entry.filter(function (e) { return e.resource && e.resource.resourceType === "Group"; }).map(function (e) {
      return '<option value="' + esc(e.resource.id) + '">' + esc(e.resource.name) + " (" + esc(e.resource.quantity) + " patients now)</option>";
    }).join("") : "";
    h += "<h3>Start an export</h3>" +
      '<div class="row"><label class="f"><span>Which patients</span><select id="admExpGroup"><option value="">The whole hospital</option>' + wardOpts + "</select></label></div>" +
      (groups === null || groups === undefined ? '<p class="quiet">Loading the wards...</p>'
        : groups === false || !groups.entry ? '<div class="msg err">The wards could not be listed, so a single-ward export cannot be chosen right now. The whole-hospital export still works.</div>'
        : !wardOpts ? '<p class="quiet">No ward has an admitted patient right now, so there is no ward to export on its own.</p>' : "") +
      '<div class="row">' + (r.exportable || []).map(function (t) {
      return '<label class="f" style="flex:0 1 190px"><span><input type="checkbox" class="admExpType" value="' + esc(t) + '" checked> ' + esc(t) + "</span></label>";
    }).join("") + "</div>" +
      '<div class="row"><label class="f"><span>Only changed since (optional)</span><input type="datetime-local" id="admExpSince"></label></div>' +
      '<button type="button" class="btn" id="admExpStart">Start export</button> <button type="button" class="btn ghost" id="admExpRefresh">Refresh</button><div id="admExpMsg"></div>';
    h += "<h3>Exports</h3>";
    if (!r.exports.length) return h + '<p class="quiet">No export has been started for this hospital.</p></div>';
    h += '<div class="tbl"><table><thead><tr><th>Started</th><th>Types</th><th>Since</th><th>Status</th><th>Files</th><th></th></tr></thead><tbody>' +
      r.exports.map(function (x) {
        var status = esc(EXPORT_STATUS[x.status] || x.status);
        if (x.status === "in-progress") status += '<br><span class="quiet">' + esc(x.exported) + " resources so far</span>";
        if (x.status === "failed") status = '<span class="msg err">Failed: ' + esc(x.error || "no reason recorded") + "</span>";
        var files = x.status === "complete"
          ? (x.files.length ? x.files.map(function (f) { return esc(f.name) + ": " + esc(f.count) + ' <button type="button" class="btn ghost sm" data-exp-file="' + esc(x.id) + '" data-exp-name="' + esc(f.name) + '">Download</button>'; }).join("<br>") : "Done. No resources matched this export.")
          : '<span class="quiet">' + (x.files.length ? x.files.length + " file(s) written" : "none") + "</span>";
        if (x.issues && x.issues.length) files += '<div class="msg err">Not included: ' + x.issues.map(function (i) { return esc(i.detail); }).join("<br>") + "</div>";
        var act = (x.status === "in-progress" || x.status === "complete") ? '<button type="button" class="btn ghost" data-exp-cancel="' + esc(x.id) + '">' + (x.status === "complete" ? "Delete files" : "Cancel") + "</button>" : "";
        return "<tr><td>" + esc(x.requestedAt) + "<br><span class=\"quiet\">" + esc(x.requestedBy) + "</span></td><td>" + esc((x.types || []).join(", ")) + (x.groupName ? '<br><span class="quiet">ward: ' + esc(x.groupName) + "</span>" : "") + "</td><td>" + esc(x.since || "all") + "</td><td>" + status + "</td><td>" + files + "</td><td>" + act + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h + "</div>";
  }
  WSQ._exportHtml = exportHtml;

  function renderExport(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = exportHtml(c, null);
    return Promise.all([c.api("/ward/fhir-exports" + q), c.api("/ward/fhir/Group" + q)]).then(function (rs) {
      var r = rs[0], groups = rs[1] && rs[1].resourceType === "Bundle" ? rs[1] : false;
      body.innerHTML = exportHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) }, groups);
      if (!r || !r.ok) return;
      var msg = function (t) { document.getElementById("admExpMsg").innerHTML = '<div class="msg err">' + c.esc(t) + "</div>"; };
      document.getElementById("admExpRefresh").onclick = function () { WSQ.render("admin"); };
      document.getElementById("admExpStart").onclick = function () {
        var btn = this, types = [];
        document.querySelectorAll(".admExpType").forEach(function (b) { if (b.checked) types.push(b.value); });
        if (!types.length) { msg("Choose at least one resource type."); return; }
        var sinceRaw = document.getElementById("admExpSince").value, since = "";
        if (sinceRaw) { var d = new Date(sinceRaw); if (isNaN(d.getTime())) { msg("That date is not valid."); return; } since = d.toISOString(); }
        btn.disabled = true;
        var groupSel = document.getElementById("admExpGroup");
        c.api("/ward/fhir-export", { orgId: c.state.orgId, types: types, since: since, groupId: groupSel ? groupSel.value : "" }).then(function (x) {
          if (!x || !x.ok) { btn.disabled = false; msg(refusal(x)); return; }
          c.toast("Export started."); WSQ.render("admin");
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
            if (!x || !x.ok) { msg("Download refused: " + ((x && x.message) || "no answer from the server")); return; }
            c.toast("Downloaded " + name + ". The download is in the audit trail.");
          });
        };
      });
      body.querySelectorAll("[data-exp-cancel]").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          c.api("/ward/fhir-export-cancel", { orgId: c.state.orgId, id: b.getAttribute("data-exp-cancel") }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; msg(refusal(x)); return; }
            c.toast("Export cancelled and its files deleted."); WSQ.render("admin");
          });
        };
      });
    });
  }

  /* FHIR (functions/_wardsynq/fhir-terminology.js, fhir.js capabilityStatement). What this hospital's FHIR
   * server declares, and the value sets it serves, each expandable in place. Each load is null while
   * loading and a failure when it failed: a list that failed never reads as "no value sets", and a
   * fragment's warning is shown above its codes, never dropped. */
  function fhirFailed(r, type) {
    if (r && r.resourceType === type) return null;
    if (r && r.resourceType === "OperationOutcome") return (r.issue || []).map(function (i) { return i.diagnostics || i.code; }).join("; ");
    return refusal(r);
  }
  function fhirHtml(c, meta, sets) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("hub") + " FHIR server</h2>" +
      '<p class="quiet">What this hospital\'s FHIR R4 API declares to other systems. A patient\'s International Patient Summary opens from their chart on the ward.</p>';
    if (meta === null) h += '<span class="spin"></span>';
    else if (fhirFailed(meta, "CapabilityStatement")) h += '<div class="msg err">The capability statement could not be loaded: ' + esc(fhirFailed(meta, "CapabilityStatement")) + ".</div>";
    else {
      var rest = (meta.rest && meta.rest[0]) || {};
      h += '<div class="kv"><dt>FHIR version</dt><dd>' + esc(meta.fhirVersion) + "</dd><dt>Software</dt><dd>" + esc((meta.software && meta.software.name) || "") + " " + esc((meta.software && meta.software.version) || "") + "</dd>" +
        "<dt>SMART on FHIR</dt><dd>" + (rest.security && rest.security.service ? "enabled" : "not enabled") + "</dd>" +
        "<dt>Writes</dt><dd>" + ((rest.interaction || []).length ? "accepted (inbound FHIR is enabled)" : "none, read only") + "</dd>" +
        "<dt>Operations</dt><dd>" + esc((rest.operation || []).map(function (o) { return "$" + o.name; }).join(", ")) + "</dd></div>" +
        '<div class="tbl"><table><thead><tr><th>Resource</th><th>Interactions</th></tr></thead><tbody>' +
        (rest.resource || []).map(function (r) {
          return "<tr><td>" + esc(r.type) + "</td><td>" + esc((r.interaction || []).map(function (i) { return i.code; }).join(", ")) + "</td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    h += '</div><div class="card"><h2>' + c.ms("menu_book") + " Terminology</h2>" +
      '<p class="quiet">The code lists this server answers $expand and $validate-code for. This hospital\'s own lists are complete. LOINC and other published systems are only the codes this server carries: it is not an authoritative source for them.</p>';
    if (sets === null) return h + '<span class="spin"></span></div>';
    if (fhirFailed(sets, "Bundle")) return h + '<div class="msg err">Value sets could not be loaded: ' + esc(fhirFailed(sets, "Bundle")) + ". This is not the same as there being none.</div></div>";
    var entries = sets.entry || [];
    entries.forEach(function (e) { if (e.resource && e.resource.resourceType === "OperationOutcome") h += '<div class="msg note">' + esc(fhirFailed(e.resource, "Bundle")) + "</div>"; });
    var vs = entries.filter(function (e) { return e.resource && e.resource.resourceType === "ValueSet"; }).map(function (e) { return e.resource; });
    if (!vs.length) return h + '<p class="quiet">This server serves no value sets.</p></div>';
    return h + '<div class="row"><label class="f"><span>Filter codes when expanding (optional)</span><input id="admVsFilter" placeholder="code or name"></label></div>' +
      vs.map(function (v) {
        return "<h3>" + esc(v.title || v.id) + (v.experimental ? ' <span class="pill warn">draft</span>' : "") + "</h3>" +
          '<p class="quiet">' + esc(v.description || "") + ' <span class="mono">' + esc(v.url) + "</span></p>" +
          '<button type="button" class="btn ghost" data-vs-expand="' + esc(v.id) + '">Expand</button><div id="admVs-' + esc(v.id) + '"></div>';
      }).join("") + "</div>";
  }
  WSQ._fhirHtml = fhirHtml;
  function expansionHtml(c, r) {
    var esc = c.esc;
    if (r === null) return '<span class="spin"></span>';
    if (fhirFailed(r, "ValueSet") || !r.expansion) return '<div class="msg err">Could not expand: ' + esc(fhirFailed(r, "ValueSet") || "no expansion returned") + ".</div>";
    var x = r.expansion, rows = x.contains || [];
    return (x.parameter || []).filter(function (p) { return p.name === "warning"; }).map(function (w) { return '<div class="msg note">' + esc(w.valueString) + "</div>"; }).join("") +
      '<p class="quiet">' + esc(x.total) + " code(s)" + (rows.length < x.total ? ", showing the first " + rows.length : "") + ".</p>" +
      (rows.length ? '<div class="tbl"><table><thead><tr><th>Code</th><th>Display</th><th>System</th></tr></thead><tbody>' +
        rows.map(function (k) { return '<tr><td class="mono">' + esc(k.code) + "</td><td>" + esc(k.display || "") + '</td><td class="mono">' + esc(k.system) + "</td></tr>"; }).join("") +
        "</tbody></table></div>" : '<p class="quiet">No codes match.</p>');
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
    return c.api("/ward/security-report" + q + "&days=7").then(function (r) {
      body.innerHTML = securityReviewHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) });
      if (!r || !r.ok) return;
      body.querySelectorAll("[data-sec-review]").forEach(function (b) {
        b.onclick = function () {
          var parts = b.getAttribute("data-sec-review").split("|");
          var note = "";
          if (parts[2] === "follow-up") { note = window.prompt("What needs following up?") || ""; if (!note) return; }
          b.disabled = true;
          c.api("/ward/security-review", { orgId: c.state.orgId, subjectKind: parts[0], subjectId: parts.slice(1, -1).join("|"), decision: parts[parts.length - 1], note: note }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; document.getElementById("secRevMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
            c.toast("Review recorded."); WSQ.render("admin");
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
            out.innerHTML = auditRowsHtml(c, x && x.ok ? x : { failed: true, message: refusal(x) });
          }, function () { b.disabled = false; out.innerHTML = auditRowsHtml(c, { failed: true, message: "No response from the server." }); });
        };
      });
      var save = document.getElementById("secRtSave");
      if (save) save.onclick = function () {
        var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
        save.disabled = true;
        c.api("/ward/restore-test", { orgId: c.state.orgId, restoredWhat: val("secRtWhat"), outcome: val("secRtOutcome"), performedBy: val("secRtBy"), note: val("secRtNote") }).then(function (x) {
          if (!x || !x.ok) { save.disabled = false; document.getElementById("secRtMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast("Restore test recorded."); WSQ.render("admin");
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
          if (reason.length < 20 || !incident) { msg.innerHTML = '<div class="msg err">Give a reason of at least 20 characters and the incident reference. The server checks both again.</div>'; return; }
          msg.innerHTML = "";
          document.getElementById("secAckConfirm" + sx).innerHTML = anchorAckConfirmHtml(c, reason, incident, chain);
          document.getElementById("secAckBack" + sx).onclick = function () { document.getElementById("secAckConfirm" + sx).innerHTML = ""; };
          document.getElementById("secAckGo" + sx).onclick = function () {
            var go = document.getElementById("secAckGo" + sx);
            go.disabled = true;
            c.api("/ward/audit-anchor-acknowledge", { orgId: c.state.orgId, reason: reason, incidentRef: incident, chain: chain }).then(function (x) {
              if (!x || !x.ok) { go.disabled = false; msg.innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
              c.toast("Restore acknowledged. The outside copies restart from the newest row.");
              WSQ.render("admin");
            });
          };
        };
      });
    });
  }

  // ---- System health (P2.15) ------------------------------------------------------------------
  /* null = loading, {failed} = the report itself did not load. Neither may look like all healthy. */
  var HEALTH_LABEL = { up: "Up", degraded: "Degraded", down: "Down" };
  function systemHealthHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><h2>System health</h2><span class="spin"></span> Checking each dependency...</div>';
    if (r.failed) return '<div class="card"><h2>System health</h2><div class="msg err">System health could not be loaded: ' + esc(r.message || "failed") +
      ". The status of every dependency is unknown. This is not the same as everything being up.</div></div>";
    var head = r.overall === "up" ? '<div class="msg ok">Every dependency answered its check.</div>'
      : '<div class="msg err">' + esc(r.dependencies.filter(function (d) { return d.status !== "up"; }).length) + " of " + esc(r.dependencies.length) + " dependencies are not fully up.</div>";
    return '<div class="card"><h2>System health</h2><p class="quiet">Checked ' + esc(r.generatedAt) + ". Each check gives up after " + esc(r.timeoutMs) + " ms and counts as down.</p>" + head +
      '<div class="tbl"><table><thead><tr><th>Dependency</th><th>Status</th><th>Checked</th><th>What it means</th></tr></thead><tbody>' +
      r.dependencies.map(function (d) {
        return '<tr class="' + (d.status === "up" ? "" : "warn") + '"><td>' + esc(d.name) + "</td><td><b>" + esc(HEALTH_LABEL[d.status] || "Unknown") + "</b></td><td>" + esc(d.checkedAt) + "</td><td>" +
          (d.consequence ? esc(d.consequence) + "<br>" : "") + (d.reason ? '<span class="quiet">' + esc(d.reason) + "</span>" : "") + "</td></tr>";
      }).join("") + '</tbody></table></div><button type="button" class="btn ghost" id="healthRecheck">Check again</button></div>';
  }
  WSQ._systemHealthHtml = systemHealthHtml;

  function renderHealth(c, body) {
    body.innerHTML = systemHealthHtml(c, null);
    return c.api("/ward/system-health?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      body.innerHTML = systemHealthHtml(c, r && r.ok && r.dependencies ? r : { failed: true, message: refusal(r) });
      var again = document.getElementById("healthRecheck");
      if (again) again.onclick = function () { WSQ.render("admin"); };
    }, function () { body.innerHTML = systemHealthHtml(c, { failed: true, message: "No response from the server." }); });
  }

  // ---- Integrations > Webhooks (P2.13) --------------------------------------------------------
  /* null = loading, {failed} = the list did not load. Neither may look like "no webhooks". `shown` is the
   * secret from the registration or rotation that just happened: it is in that one answer only. */
  var WH_STATUS = { active: "Active", disabled: "Disabled", "auto-disabled": "Turned off after repeated failures" };
  function webhooksHtml(c, r, shown) {
    var esc = c.esc;
    var h = '<div class="card"><h2>Webhooks</h2>' +
      '<p class="quiet">A webhook tells another system that something happened here. It carries the event type and an opaque id only: never a name, a number, a test or a value. ' +
      "The receiving system reads the details through the WardSynQ FHIR API with its own SMART access, where this hospital's permissions and audit trail apply. " +
      "Each call is signed: X-WardSynQ-Signature is HMAC-SHA256 of the X-WardSynQ-Timestamp, a dot, and the body, with the endpoint's secret.</p>";
    if (r == null) return h + '<span class="spin"></span> Loading webhooks...</div>';
    if (r.failed) return h + '<div class="msg err">Webhooks could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as there being none.</div></div>";
    if (shown && shown.secret) {
      h += '<div class="msg ok">Signing secret for ' + esc(shown.url) + ': <code style="user-select:all;word-break:break-all">' + esc(shown.secret) + "</code><br>Copy it now. It is not shown again. The previous secret keeps working for 24 hours so the receiving system can be updated.</div>";
    }
    var label = {};
    (r.eventTypes || []).forEach(function (t) { label[t.id] = t.label; });
    h += "<h3>Registered webhooks</h3>";
    if (!r.webhooks.length) h += '<p class="quiet">No webhooks are registered for this hospital.</p>';
    else {
      h += '<div class="tbl"><table><thead><tr><th>Address</th><th>Events</th><th>Status</th><th>Last attempt</th><th></th></tr></thead><tbody>' +
        r.webhooks.map(function (w) {
          var status = "<b>" + esc(WH_STATUS[w.status] || w.status) + "</b>" + (w.disabledReason ? '<br><span class="quiet">' + esc(w.disabledReason) + "</span>" : "") +
            (w.consecutiveFailures ? '<br><span class="msg err">' + esc(w.consecutiveFailures) + " failed in a row</span>" : "");
          var last = w.lastAttemptAt ? esc(w.lastAttemptAt) + "<br>" + (w.lastOk ? "Delivered" : "Failed") + (w.lastResponseCode ? " (" + esc(w.lastResponseCode) + ")" : "") : '<span class="quiet">None yet</span>';
          return '<tr class="' + (w.active ? "" : "warn") + '"><td>' + esc(w.url) + (w.description ? '<br><span class="quiet">' + esc(w.description) + "</span>" : "") +
            (w.payload === "fhir-id-only" ? '<br><span class="pill">FHIR Subscription, id only</span>' : "") + "</td><td>" +
            w.eventTypes.map(function (t) { return esc(label[t] || t); }).join("<br>") + "</td><td>" + status + "</td><td>" + last + "</td><td>" +
            '<button type="button" class="btn ghost" data-wh-test="' + esc(w.id) + '"' + (w.active ? "" : " disabled") + ">Send test</button> " +
            '<button type="button" class="btn ghost" data-wh-log="' + esc(w.id) + '">Delivery log</button> ' +
            '<button type="button" class="btn ghost" data-wh-edit="' + esc(w.id) + '">Change address</button> ' +
            '<button type="button" class="btn ghost" data-wh-rotate="' + esc(w.id) + '">Rotate secret</button> ' +
            '<button type="button" class="btn ghost" data-wh-active="' + esc(w.id) + '" data-on="' + (w.active ? "0" : "1") + '">' + (w.active ? "Disable" : "Enable") + "</button></td></tr>";
        }).join("") + "</tbody></table></div>";
    }
    h += '<div id="whLog"></div><div id="whMsg"></div><h3>Add a webhook</h3>';
    if (!r.keyConfigured) return h + '<div class="msg err">Webhook secrets cannot be stored encrypted on this server, so a webhook cannot be added.</div></div>';
    return h + '<div class="row"><label class="f"><span>Address (https only)</span><input type="url" id="whUrl" placeholder="https://"></label>' +
      '<label class="f"><span>Label (optional)</span><input type="text" id="whDesc" maxlength="120"></label>' +
      '<label class="f"><span>Payload</span><select id="whPayload"><option value="wardsynq">WardSynQ JSON (event type and id)</option>' +
      '<option value="fhir-id-only">FHIR Subscription notification (R4 backport, id only)</option></select></label></div><div class="row">' +
      (r.eventTypes || []).map(function (t) {
        return '<label class="f" style="flex:0 1 240px"><span><input type="checkbox" class="whType" value="' + esc(t.id) + '"> ' + esc(t.label) + "</span></label>";
      }).join("") + '</div><button type="button" class="btn" id="whAdd">Add webhook</button></div>';
  }
  WSQ._webhooksHtml = webhooksHtml;

  var DELIVERY_STATUS = { delivered: "Delivered", failed: "Failed, will retry", dead: "Failed for good", skipped: "Not sent" };
  /* One endpoint's attempts, newest first, a page at a time. `older` says whether this is past the first page. */
  function webhookDeliveriesHtml(c, d, url, older) {
    var esc = c.esc;
    var h = "<h3>Delivery log" + (url ? " for " + esc(url) : "") + "</h3>";
    if (d == null) return h + '<span class="spin"></span> Loading deliveries...';
    if (d.failed) return h + '<div class="msg err">The delivery log could not be loaded: ' + esc(d.message || "failed") + ". This is not the same as nothing having been sent.</div>";
    var nav = (older ? '<button type="button" class="btn ghost" data-wh-page="">Newest</button> ' : "") +
      (d.next ? '<button type="button" class="btn ghost" data-wh-page="' + esc(d.next) + '">Older</button>' : "");
    if (!d.deliveries.length) return h + '<p class="quiet">' + (older ? "No older delivery attempts." : "No delivery attempts are recorded for this webhook yet.") + "</p>" + nav;
    return h + '<div class="tbl"><table><thead><tr><th>When</th><th>Event</th><th>Attempts</th><th>Result</th><th>Response code</th></tr></thead><tbody>' +
      d.deliveries.map(function (x) {
        return '<tr class="' + (x.status === "delivered" ? "" : "warn") + '"><td>' + esc(x.at) + "</td><td>" + esc(x.eventType) + (x.test ? " (test)" : "") + '<br><span class="quiet">' + esc(x.eventId) + "</span></td><td>" + esc(x.attempt) +
          "</td><td>" + esc(DELIVERY_STATUS[x.status] || x.status) + (x.reason ? '<br><span class="quiet">' + esc(x.reason) + "</span>" : "") + "</td><td>" + (x.responseCode ? esc(x.responseCode) : "none") + "</td></tr>";
      }).join("") + "</tbody></table></div>" + nav;
  }
  /* Changing where an endpoint points. The server re-runs the https and public-address checks; the secret stays. */
  function webhookEditHtml(c, w) {
    var esc = c.esc;
    return "<h3>Change address</h3><p class=\"quiet\">The new address is checked like a new webhook (https, a public address). The signing secret does not change.</p>" +
      '<div class="row"><label class="f"><span>Address (https only)</span><input type="url" id="whEditUrl" value="' + esc(w.url) + '"></label></div>' +
      '<button type="button" class="btn" id="whEditSave" data-id="' + esc(w.id) + '">Save address</button> <button type="button" class="btn ghost" id="whEditCancel">Cancel</button>';
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
  function scScopeChecks(esc, catalog, kind, selected) {
    var groups = kind === "backend" ? [["system", "System (a backend system reads across patients)"], ["special", "Special"]]
      : [["user", "User (reads as the clinician)"], ["patient", "Patient (confined to one patient)"], ["special", "Special"]];
    var sel = {};
    (selected || []).forEach(function (s) { sel[s] = true; });
    return groups.map(function (g) {
      return '<div style="flex:1 1 220px"><b>' + esc(g[1]) + "</b><br>" + (((catalog && catalog[g[0]]) || []).map(function (s) {
        return '<label class="f" style="font-weight:normal"><span><input type="checkbox" class="scScope" value="' + esc(s) + '"' + (sel[s] ? " checked" : "") + "> <code>" + esc(s) + "</code></span></label>";
      }).join("") || '<span class="quiet">none</span>') + "</div>";
    }).join("");
  }
  function smartClientsHtml(c, r, editingId) {
    var esc = c.esc;
    var h = '<div class="card"><h2>Connected apps (SMART)</h2>' +
      '<p class="quiet">Outside applications this hospital allows to read its record over SMART on FHIR: an app a clinician uses (public), or a registered system with a key (backend). ' +
      "Registration is the allowlist: an app not named here gets nothing, and removing one stops its tokens at once. Turning the switch off closes the SMART door for every app.</p>";
    if (r == null) return h + '<span class="spin"></span> Loading connected apps...</div>';
    if (r.failed) return h + '<div class="msg err">Connected apps could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as there being none.</div></div>";
    h += '<label class="f"><span><input type="checkbox" id="scEnabled"' + (r.enabled ? " checked" : "") + "> SMART access is on for this hospital</span></label>";
    var list = r.clients || [];
    h += "<h3>Registered apps</h3>";
    if (!list.length) h += '<p class="quiet">No connected apps are registered for this hospital. Until one is, no outside application can connect.</p>';
    else {
      h += '<div class="tbl"><table><thead><tr><th>Name</th><th>Client ID</th><th>Kind</th><th>Redirects</th><th>Scopes</th><th>Keys</th><th></th></tr></thead><tbody>' +
        list.map(function (a) {
          var kids = (a.keys || []).map(function (k) { return k.kid || "(no kid)"; }).join(", ");
          var keys = esc(a.keyCount || 0) + " inline" + (kids ? '<br><span class="quiet">' + esc(kids) + "</span>" : "") +
            (a.jwksUri ? '<br><span class="quiet">JWKS address set</span>' : "");
          return "<tr><td>" + esc(a.name) + "</td><td><code>" + esc(a.clientId) + "</code></td><td>" + esc(a.kind) + "</td><td>" +
            ((a.redirectUris || []).length ? a.redirectUris.map(function (u) { return esc(u); }).join("<br>") : '<span class="quiet">none</span>') + "</td><td>" +
            (a.scopes || []).map(function (s) { return "<code>" + esc(s) + "</code>"; }).join("<br>") + "</td><td>" + keys + "</td><td>" +
            '<button type="button" class="btn ghost" data-sc-edit="' + esc(a.clientId) + '">Edit</button> ' +
            '<button type="button" class="btn ghost" data-sc-remove="' + esc(a.clientId) + '">Remove</button></td></tr>';
        }).join("") + "</tbody></table></div>";
    }
    var ed = null;
    if (editingId) ed = list.filter(function (a) { return a.clientId === editingId; })[0] || null;
    var kind = ed ? ed.kind : "public";
    h += '<div id="scMsg"></div><h3 id="scFormHead">' + (ed ? "Edit " + esc(ed.clientId) : "Add a connected app") + "</h3>" +
      '<div class="row"><label class="f"><span>Client ID (letters, digits, dot, underscore, hyphen)</span><input type="text" id="scId" maxlength="64" value="' + esc(ed ? ed.clientId : "") + '"' + (ed ? " disabled" : "") + "></label>" +
      '<label class="f"><span>Name (shown on the consent screen)</span><input type="text" id="scName" maxlength="120" value="' + esc(ed ? ed.name : "") + '"></label>' +
      '<label class="f"><span>Kind</span><select id="scKind"><option value="public"' + (kind === "public" ? " selected" : "") + ">Public (an app a clinician uses)</option>" +
      '<option value="backend"' + (kind === "backend" ? " selected" : "") + ">Backend (a system with a key)</option></select></label></div>" +
      '<div class="row" id="scRedirectWrap" style="' + (kind === "public" ? "" : "display:none") + '"><label class="f"><span>Redirect URIs, one per line (https, no fragment)</span><textarea id="scRedirects" rows="2">' +
      esc(ed ? (ed.redirectUris || []).join("\n") : "") + "</textarea></label></div>" +
      '<div id="scBackendWrap" style="' + (kind === "backend" ? "" : "display:none") + '"><div class="row"><label class="f"><span>Public keys (JWKS JSON with a keys list)</span><textarea id="scJwks" rows="3" placeholder=\'{"keys": [...]}\'></textarea></label>' +
      '<label class="f"><span>Or a JWKS address (https)</span><input type="url" id="scJwksUri" placeholder="https://"></label></div>' +
      '<p class="quiet">Send only the public half. A private key is refused, never stored.' + (ed ? " Keys are never shown again: paste them only to replace what is registered." : "") + "</p></div>" +
      "<h3>Scopes</h3>" + '<div class="row" id="scScopes">' + scScopeChecks(esc, r.scopeCatalog || {}, kind, ed ? ed.scopes : []) + "</div>" +
      '<button type="button" class="btn" id="scSave"' + (ed ? ' data-sc-editing="' + esc(ed.clientId) + '"' : "") + ">" + (ed ? "Save changes" : "Add connected app") + "</button>";
    if (ed) h += ' <button type="button" class="btn ghost" id="scCancel">Cancel</button>';
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
        if (!x || !x.ok) { en.disabled = false; en.checked = !want; msg(refusal(x)); return; }
        c.toast(want ? "SMART access is on for this hospital." : "SMART access is off. No outside app can connect until it is back on.");
        renderIntegrations(c, body);
      }, function () { en.disabled = false; en.checked = !want; msg("No response from the server. The switch may not have moved; reload to check."); });
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
      box.innerHTML = scScopeChecks(c.esc, scCache.scopeCatalog, isB ? "backend" : "public", Object.keys(keep));
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
          catch (e) { msg("The keys are not valid JSON: " + e.message); return; }
        } else if (!editing) {
          /* A new backend client with neither keys nor address is the server's refusal, with the
           * field named; an edit may keep what is registered, so it is allowed through. */
        }
        client.jwksUri = val("scJwksUri");
      }
      save.disabled = true;
      c.api("/ward/smart-client-save", { orgId: c.state.orgId, client: client }).then(function (x) {
        if (!x || !x.ok) { save.disabled = false; msg(refusal(x)); return; }
        c.toast(editing ? "Connected app updated." : "Connected app registered.");
        renderIntegrations(c, body);
      }, function () { save.disabled = false; msg("No response from the server. The app may not have been saved; reload to check."); });
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
        if (!window.confirm("Remove " + id + "? Its tokens stop working at once, and it cannot connect again until it is re-registered.")) return;
        b.disabled = true;
        c.api("/ward/smart-client-remove", { orgId: c.state.orgId, clientId: id }).then(function (x) {
          if (!x || !x.ok) { b.disabled = false; msg(refusal(x)); return; }
          c.toast("Connected app removed. Its tokens no longer work.");
          renderIntegrations(c, body);
        }, function () { b.disabled = false; msg("No response from the server. The app may not have been removed; reload to check."); });
      };
    });
  }

  // ---- Integrations > Connectors (owner S2, S4, S5) -------------------------------------------
  /* The hospital's own imaging archive, payers and payment gateway. Every form is drawn from the
   * server's catalogue, so a field the server does not take is never offered. Credentials are typed in
   * and never shown again: the list says which are set and when. null = loading, {failed} = not loaded. */
  var CN_STATE = { editing: null, result: {} };
  function connectorFormHtml(esc, kind, cur) {
    var provs = kind.providers;
    var pid = (cur && cur.provider) || CN_STATE.provider && CN_STATE.provider[kind.kind] || provs[0].id;
    var p = provs.filter(function (x) { return x.id === pid; })[0] || provs[0];
    var settings = (cur && cur.settings) || {}, set = (cur && cur.secretsSet) || [];
    var h = '<div class="cnForm" data-cn-kind="' + esc(kind.kind) + '"><h3>' + (cur ? "Change " + esc(cur.name || cur.id) : "Add") + "</h3>";
    h += '<div class="row"><label class="f"><span>Provider</span><select class="cnProvider">' + provs.map(function (x) {
      return '<option value="' + esc(x.id) + '"' + (x.id === p.id ? " selected" : "") + ">" + esc(x.label) + "</option>";
    }).join("") + "</select></label>" +
      '<label class="f"><span>Label (optional)</span><input class="cnName" maxlength="120" value="' + esc((cur && cur.name) || "") + '"></label></div>';
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
      return '<label class="f"><span>' + esc(f.label) + (isSet ? " (set; leave blank to keep, type a new one to rotate)" : "") + '</span><input type="password" autocomplete="new-password" class="cnSecret" data-key="' + esc(f.key) + '"></label>';
    }).join("") + "</div>";
    return h + '<button type="button" class="btn" data-cn-save="' + esc(kind.kind) + '"' + (cur ? ' data-cn-id="' + esc(cur.id) + '"' : "") + ">Save</button>" +
      (cur ? ' <button type="button" class="btn ghost" data-cn-cancel="1">Cancel</button>' : "") + "</div>";
  }
  function connectorsHtml(c, r) {
    var esc = c.esc;
    if (r == null) return '<div class="card"><h2>Connectors</h2><span class="spin"></span> Loading connectors...</div>';
    if (r.failed) return '<div class="card"><h2>Connectors</h2><div class="msg err">Connectors could not be loaded: ' + esc(r.message || "failed") + ". This is not the same as there being none.</div></div>";
    return r.catalogue.filter(function (kind) { return kind.kind !== "abdm"; }).map(function (kind) {   // ABDM: pages/abdm.js
      var mine = r.connectors.filter(function (x) { return x.kind === kind.kind; });
      var h = '<div class="card"><h2>' + esc(kind.label) + "</h2>" + (kind.help ? '<p class="quiet">' + esc(kind.help) + "</p>" : "");
      if (!mine.length) h += '<p class="quiet">None configured for this hospital.</p>';
      else h += '<div class="tbl"><table><thead><tr><th>Connector</th><th>Provider</th><th>Status</th><th>Credentials</th><th></th></tr></thead><tbody>' + mine.map(function (x) {
        var prov = kind.providers.filter(function (p) { return p.id === x.provider; })[0] || {};
        var res = CN_STATE.result[x.id];
        /* The gateway's webhook goes to this address. It names the hospital only; the gateway's signature is what is trusted. */
        var callback = x.kind === "payment" && x.provider !== "manual"
          ? '<br><span class="quiet">Gateway webhook address: <code style="user-select:all;word-break:break-all">' + esc(location.origin + "/api/queue/payment-callback/" + encodeURIComponent(c.state.orgId)) + "</code></span>" : "";
        return '<tr class="' + (x.active ? "" : "warn") + '"><td>' + esc(x.name || x.id) + callback + (res ? '<br><span class="msg ' + (res.passed ? "ok" : "err") + '">' + esc(res.detail) + "</span>" : "") + "</td><td>" + esc(prov.label || x.provider) + "</td><td><b>" + (x.active ? "On" : "Off") + "</b></td><td>" +
          (x.secretsSet.length ? esc(x.secretsSet.join(", ")) + '<br><span class="quiet">set ' + esc(x.secretsSetAt || "") + "</span>" : '<span class="quiet">none</span>') + "</td><td>" +
          '<button type="button" class="btn ghost" data-cn-edit="' + esc(x.id) + '">Change</button> ' +
          (prov.testable ? '<button type="button" class="btn ghost" data-cn-test="' + esc(x.id) + '">Test connection</button> ' : "") +
          '<button type="button" class="btn ghost" data-cn-active="' + esc(x.id) + '" data-on="' + (x.active ? "0" : "1") + '">' + (x.active ? "Turn off" : "Turn on") + "</button></td></tr>";
      }).join("") + "</tbody></table></div>";
      var editing = mine.filter(function (x) { return x.id === CN_STATE.editing; })[0];
      if (!r.keyConfigured) h += '<div class="msg err">Credentials cannot be stored encrypted on this server, so a connector with credentials cannot be saved.</div>';
      if (editing) h += connectorFormHtml(esc, kind, editing);
      else if (!(kind.singleton && mine.length)) h += connectorFormHtml(esc, kind, null);
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
      card.innerHTML = connectorsHtml(c, ok ? r : { failed: true, message: r ? refusal(r) : "No response from the server." });
      if (ok) bindConnectors(c, body, r);
    }, function () { card.innerHTML = connectorsHtml(c, { failed: true, message: "No response from the server." }); });
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
        shadow.innerHTML = connectorFormHtml(c.esc, k, cur ? Object.assign({}, cur, { provider: sel.value, settings: same ? cur.settings : { ref: cur.settings.ref }, secretsSet: same ? cur.secretsSet : [] }) : null);
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
          if (!x || !x.ok) { b.disabled = false; say(kind, refusal(x)); return; }
          form.querySelectorAll(".cnSecret").forEach(function (i) { i.value = ""; });
          CN_STATE.editing = null;
          c.toast(x.unchanged ? "Nothing changed." : "Connector saved." + (x.secretsNote ? " " + x.secretsNote : ""));
          loadConnectors(c, body);
        }, function () { b.disabled = false; say(kind, "No response from the server. The connector may not have been saved; reload to check."); });
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
          if (!t || !t.ok || !t.test) { say(x.kind, refusal(t)); return; }
          CN_STATE.result[x.id] = t.test;
          card.innerHTML = connectorsHtml(c, r); bindConnectors(c, body, r);
        }, function () { b.disabled = false; say(x.kind, "No response from the server. The test result is not known."); });
      };
    });
    card.querySelectorAll("[data-cn-active]").forEach(function (b) {
      b.onclick = function () {
        var x = byId(b.getAttribute("data-cn-active")), on = b.getAttribute("data-on") === "1";
        b.disabled = true;
        c.api("/ward/connector-save", { orgId: c.state.orgId, kind: x.kind, provider: x.provider, name: x.name, settings: x.settings, active: on }).then(function (y) {
          if (!y || !y.ok) { b.disabled = false; say(x.kind, refusal(y)); return; }
          c.toast(on ? "Connector turned on." : "Connector turned off."); loadConnectors(c, body);
        }, function () { b.disabled = false; say(x.kind, "No response from the server. The switch may not have moved; reload to check."); });
      };
    });
  }

  function renderIntegrations(c, body, shown) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = '<div id="cnCard">' + connectorsHtml(c, null) + '</div><div id="abdmCard"></div><div id="whCard">' + webhooksHtml(c, null) + '</div><div id="scCard">' + smartClientsHtml(c, null) + "</div>";
    loadConnectors(c, body);
    if (WSQ._abdmLoad) WSQ._abdmLoad(c);   // pages/abdm.js: the ABDM connector has its own card
    var fail = function (r) { return { failed: true, message: r ? refusal(r) : "No response from the server." }; };
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
        if (!/^https:\/\//i.test(url)) { msg("The address must start with https://."); return; }
        if (!types.length) { msg("Choose at least one event."); return; }
        add.disabled = true;
        c.api("/ward/webhook", { orgId: c.state.orgId, url: url, eventTypes: types, description: document.getElementById("whDesc").value, payload: document.getElementById("whPayload").value }).then(function (x) {
          if (!x || !x.ok || !x.secret) { add.disabled = false; msg(refusal(x)); return; }
          renderIntegrations(c, body, { url: x.webhook.url, secret: x.secret });
        }, function () { add.disabled = false; msg("No response from the server. The webhook may not have been added; reload to check."); });
      };
      body.querySelectorAll("[data-wh-rotate]").forEach(function (b) {
        b.onclick = function () {
          var id = b.getAttribute("data-wh-rotate");
          if (!window.confirm("Make a new signing secret? The current one keeps working for 24 hours.")) return;
          b.disabled = true;
          c.api("/ward/webhook-rotate", { orgId: c.state.orgId, id: id }).then(function (x) {
            if (!x || !x.ok || !x.secret) { b.disabled = false; msg(refusal(x)); return; }
            renderIntegrations(c, body, { url: urlOf(id), secret: x.secret });
          });
        };
      });
      body.querySelectorAll("[data-wh-active]").forEach(function (b) {
        b.onclick = function () {
          var on = b.getAttribute("data-on") === "1";
          b.disabled = true;
          c.api("/ward/webhook-update", { orgId: c.state.orgId, id: b.getAttribute("data-wh-active"), active: on }).then(function (x) {
            if (!x || !x.ok) { b.disabled = false; msg(refusal(x)); return; }
            c.toast(on ? "Webhook enabled." : "Webhook disabled. Nothing more is sent to it."); renderIntegrations(c, body);
          });
        };
      });
      body.querySelectorAll("[data-wh-test]").forEach(function (b) {
        b.onclick = function () {
          b.disabled = true;
          c.api("/ward/webhook-test", { orgId: c.state.orgId, id: b.getAttribute("data-wh-test") }).then(function (x) {
            b.disabled = false;
            if (!x || !x.ok) { msg(refusal(x)); return; }
            c.toast("Test event delivered (response " + x.responseCode + ").");
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
            if (!/^https:\/\//i.test(url)) { msg("The address must start with https://."); return; }
            save.disabled = true;
            c.api("/ward/webhook-update", { orgId: c.state.orgId, id: id, url: url }).then(function (x) {
              if (!x || !x.ok) { save.disabled = false; msg(refusal(x)); return; }
              c.toast(x.unchanged ? "That is already the address." : "Address changed. The signing secret is the same."); renderIntegrations(c, body);
            }, function () { save.disabled = false; msg("No response from the server. The address may not have changed; reload to check."); });
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
