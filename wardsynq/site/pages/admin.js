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

  var TABS = [["hospital", "Hospital"], ["departments", "Departments"], ["wards", "Wards and beds"], ["rooms", "Rooms"], ["staff", "Staff and roles"], ["tariff", "Price list"], ["advisories", "Safety reminders"], ["forms", "Forms"], ["pathways", "Clinical pathways"]];

  WSQ.page("admin", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("staff.admin")) {
      el.innerHTML = '<div class="title"><h1>Admin Center</h1></div>' +
        '<div class="msg note">Your role does not include staff.admin, so the Admin Center is not available to you.</div>';
      return;
    }
    var tabs = TABS.slice();
    if (c.isWardsynq()) tabs.push(["maik", "MaiK clinical AI"], ["security", "Security review"], ["export", "Data export"]);
    var tab = st._adminTab || "hospital";
    if ((tab === "maik" || tab === "security" || tab === "export") && !c.isWardsynq()) tab = "hospital";
    el.innerHTML = '<div class="title"><h1>Admin Center</h1><span class="sub">' + c.esc((st.org && st.org.name) || "") + '</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + c.esc(t[1]) + "</button>";
      }).join("") + '</div><div id="adminBody"><span class="spin"></span></div>';
    el.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { st._adminTab = b.getAttribute("data-tab"); WSQ.render("admin"); };
    });
    var body = document.getElementById("adminBody");
    var renderers = { hospital: renderHospital, departments: renderDepts, wards: renderWards, rooms: renderRooms, staff: renderStaff, maik: renderMaik, security: renderSecurity, export: renderExport, tariff: renderTariff, advisories: renderAdvisories, forms: renderForms, pathways: renderPathways };
    return renderers[tab](c, body);
  } });

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
      '<button class="btn" id="admHospSave" type="button">Save</button></div>' +
      /* Said plainly, because it changes how numbers already on the chart are READ, not what they
       * say: nothing is converted, and nothing already recorded is rewritten. */
      '<p class="quiet">The country decides what counts as a valid phone number and the unit a temperature is charted in from now on. Readings already recorded keep the unit they were recorded in.</p><div id="admHospMsg"></div>' +
      (c.isWardsynq() ? "" : '<div class="msg note">Inpatient features (ward, beds, theatre, Digital Twin) need a WardSynQ hospital. Create one from the hospital list.</div>') +
      "</div>" +
      (c.isWardsynq() ? noteWritersCard(c, o) + approvalRulesHtml(c.esc, o.wardsynq) + labCheckHtml(c.esc, o.wardsynq) : "");
    document.getElementById("admHospSave").onclick = function () {
      var btn = document.getElementById("admHospSave");
      var name = (document.getElementById("admHospName").value || "").trim();
      if (!name) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">Give the hospital a name.</div>'; return; }
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, name: name, region: document.getElementById("admHospRegion").value }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org; c.toast("Hospital updated."); WSQ.render("admin");
      });
    };
    wireNoteWriters(c);
    wireApprovalRules(c);
    wireLabCheck(c);
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
    return c.api("/rooms?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var rooms = (r && r.ok && r.rooms) || [];
      body.innerHTML = '<div class="card"><h2>Rooms</h2>' +
        (rooms.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>Number</th><th>Assignment</th><th>Active</th></tr></thead><tbody>' +
          rooms.map(function (rm) { return "<tr><td>" + c.esc(rm.name) + "</td><td>" + c.esc(rm.number) + "</td><td>" + c.esc((rm.assignment && rm.assignment.mode) || "") + "</td><td>" + (rm.active ? "yes" : "no") + "</td></tr>"; }).join("") +
          "</tbody></table></div>" : '<p class="quiet">No consulting rooms yet.</p>') +
        '<h3>Add a room</h3><div class="row"><label class="f"><span>Name</span><input id="admRoomName"></label>' +
        '<button class="btn" id="admRoomAdd" type="button">' + c.ms("add") + "Add</button></div><div id=\"admRoomMsg\"></div></div>";
      document.getElementById("admRoomAdd").onclick = function () {
        var name = (document.getElementById("admRoomName").value || "").trim();
        if (!name) { document.getElementById("admRoomMsg").innerHTML = '<div class="msg err">Give the room a name.</div>'; return; }
        c.api("/room", { orgId: c.state.orgId, name: name }).then(function (r) {
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
        (members.length ? '<div class="tbl"><table><thead><tr><th>Identity</th><th>Role</th><th>Active</th><th>Email</th><th>PIN set</th><th></th></tr></thead><tbody>' +
          members.map(function (m) {
            return '<tr data-identity="' + c.esc(m.identity) + '"><td>' + c.esc(m.identity) + "</td><td>" + c.esc(m.role) + "</td><td>" + (m.active ? "yes" : "no") + "</td><td>" + c.esc(m.email || "none") + "</td><td>" + (m.hasPin ? "yes" : "no") + "</td><td>" +
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
        c.api("/member", { orgId: c.state.orgId, identity: id, role: document.getElementById("admMemberRole").value, regNo: (document.getElementById("admMemberRegNo").value || "").trim() }).then(function (r) {
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
      // plain flag. The switch below is a yes/no simplification over "gemini" + "vertex", the two
      // providers that leave the hospital; it never touches the local/on-prem entries.
      var approved = Array.isArray(r.phiApproved) ? r.phiApproved : [];
      var cloudApproved = approved.indexOf("gemini") >= 0 || approved.indexOf("vertex") >= 0;
      var localApproved = approved.indexOf("local-openai") >= 0;
      // The on-premises endpoint is configuration, not status, so it comes from the org document.
      var curMaik = ((c.state.org && c.state.org.wardsynq) || {}).maik || {};
      var localUrl = curMaik.localBaseUrl || "", localModel = curMaik.localModel || "";
      body.innerHTML = '<div class="card"><h2>MaiK clinical AI</h2>' +
        '<div class="kv"><dt>Enabled</dt><dd>' + (r.enabled ? "yes" : "no") + "</dd>" +
        "<dt>Patient data approved for a cloud model</dt><dd>" + (cloudApproved ? "yes (" + c.esc(r.phiApproved.join(", ")) + ")" : "no") + "</dd>" +
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
        '<label class="f"><input type="checkbox" id="admMaikPhi"' + (cloudApproved ? " checked" : "") + "> Patient data may be sent to an approved cloud model</label>" +
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
        if (phi) { approve.push("gemini"); approve.push("vertex"); }
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
        });
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
    "failed-sign-ins": "Many failed sign-ins", "new-device": "Sign-in from a new device", "many-devices": "Many devices in a short time"
  };
  var SEC_STATUS_LABEL = { green: "Protected: recent backup and a successful restore test on record", amber: "Needs attention", red: "Not protected", unavailable: "Unknown: could not be checked" };

  function secSection(c, title, s, days) {
    var esc = c.esc;
    var h = "<h3>" + esc(title) + "</h3>";
    if (!s || s.status !== "ok") return h + '<div class="msg err">Could not be checked' + (s && s.detail ? ": " + esc(s.detail) : "") + ". This is not the same as nothing being found.</div>";
    if (s.truncated || s.partial) h += '<div class="msg note">Only part of the log could be read, so some activity may not have been checked.</div>';
    if (!s.findings.length) return h + '<p class="quiet">No findings in the last ' + esc(days) + " days.</p>";
    return h + s.findings.map(function (f) {
      return "<details><summary><b>" + esc(SEC_TYPE_LABEL[f.type] || f.type) + "</b>: " + esc(f.actor) + ". " + esc(f.summary) + "</summary>" +
        '<p class="quiet">' + esc(f.method) + "</p>" +
        '<div class="tbl"><table><thead><tr><th>When</th><th>Action</th><th>Type</th><th>Patient ref</th><th>Outcome</th><th>Detail</th></tr></thead><tbody>' +
        f.evidence.map(function (e) {
          return "<tr><td>" + esc(e.ts) + "</td><td>" + esc(e.action) + "</td><td>" + esc(e.resourceType || "") + '</td><td class="mono">' + esc(e.patientRef || "") + "</td><td>" + esc(e.outcome || "") + "</td><td>" + esc(e.detail || "") + "</td></tr>";
        }).join("") + "</tbody></table></div>" +
        (f.evidenceTotal > f.evidence.length ? '<p class="quiet">Showing ' + f.evidence.length + " of " + esc(f.evidenceTotal) + " rows.</p>" : "") + "</details>";
    }).join("");
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
    h += secSection(c, "Chart access", r.chartAccess, r.days) + secSection(c, "Exports", r.exports, r.days) + secSection(c, "Sign-ins", r.logins, r.days);
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
    return h + "</div>";
  }
  WSQ._securityReviewHtml = securityReviewHtml;

  /* DATA EXPORT (FHIR). The hospital's record as FHIR Bulk Data NDJSON (functions/_wardsynq/fhir-bulk.js).
   * The list is null while loading and false when it failed, and a failed load never renders as "no
   * exports". Each status reads differently: running, done (with its files and counts, even when a
   * type had nothing), failed (with the reason), cancelled, expired. Anything the export could not
   * include is listed under the job, never hidden. */
  var EXPORT_STATUS = { "in-progress": "Running", complete: "Done", failed: "Failed", cancelled: "Cancelled", expired: "Expired, files deleted" };
  function exportHtml(c, r) {
    var esc = c.esc;
    var h = '<div class="card"><h2>' + c.ms("cloud_download") + " Data export (FHIR)</h2>" +
      '<p class="quiet">Exports this hospital\'s record as FHIR R4 NDJSON, one file per resource type, in the background. One export runs at a time. Files are fetched through the FHIR Bulk Data API ($export-status) with this hospital\'s authorization, are recorded in the audit trail when downloaded, and are deleted after 24 hours.</p>';
    if (r === null) return h + '<span class="spin"></span></div>';
    if (r === false || r.failed) return h + '<div class="msg err">Exports could not be loaded' + (r && r.message ? ": " + esc(r.message) : "") + ". This is not the same as there being none.</div></div>";
    h += "<h3>Start an export</h3><div class=\"row\">" + (r.exportable || []).map(function (t) {
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
          ? (x.files.length ? x.files.map(function (f) { return esc(f.name) + ": " + esc(f.count); }).join("<br>") : "Done. No resources matched this export.")
          : '<span class="quiet">' + (x.files.length ? x.files.length + " file(s) written" : "none") + "</span>";
        if (x.issues && x.issues.length) files += '<div class="msg err">Not included: ' + x.issues.map(function (i) { return esc(i.detail); }).join("<br>") + "</div>";
        var act = (x.status === "in-progress" || x.status === "complete") ? '<button type="button" class="btn ghost" data-exp-cancel="' + esc(x.id) + '">' + (x.status === "complete" ? "Delete files" : "Cancel") + "</button>" : "";
        return "<tr><td>" + esc(x.requestedAt) + "<br><span class=\"quiet\">" + esc(x.requestedBy) + "</span></td><td>" + esc((x.types || []).join(", ")) + "</td><td>" + esc(x.since || "all") + "</td><td>" + status + "</td><td>" + files + "</td><td>" + act + "</td></tr>";
      }).join("") + "</tbody></table></div>";
    return h + "</div>";
  }
  WSQ._exportHtml = exportHtml;

  function renderExport(c, body) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    body.innerHTML = exportHtml(c, null);
    return c.api("/ward/fhir-exports" + q).then(function (r) {
      body.innerHTML = exportHtml(c, r && r.ok ? r : { failed: true, message: refusal(r) });
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
        c.api("/ward/fhir-export", { orgId: c.state.orgId, types: types, since: since }).then(function (x) {
          if (!x || !x.ok) { btn.disabled = false; msg(refusal(x)); return; }
          c.toast("Export started."); WSQ.render("admin");
        });
      };
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
      var save = document.getElementById("secRtSave");
      if (save) save.onclick = function () {
        var val = function (id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; };
        save.disabled = true;
        c.api("/ward/restore-test", { orgId: c.state.orgId, restoredWhat: val("secRtWhat"), outcome: val("secRtOutcome"), performedBy: val("secRtBy"), note: val("secRtNote") }).then(function (x) {
          if (!x || !x.ok) { save.disabled = false; document.getElementById("secRtMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(x)) + "</div>"; return; }
          c.toast("Restore test recorded."); WSQ.render("admin");
        });
      };
    });
  }
})();
