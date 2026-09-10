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

  // Every role functions/_queue_roles.js ROLE_CAPS knows about (ROLES = Object.keys(ROLE_CAPS)).
  var ROLES = ["admin", "doctor", "supervisor", "nurse", "intern", "resident", "reception", "cashier",
    "pharmacy", "lab", "hr", "billing", "him", "blood_bank", "oncqis_protocol_author",
    "oncqis_clinical_reviewer", "oncqis_institutional_approver", "pg_resident", "pg_faculty", "pg_hod",
    "academic_cell", "safety_officer", "viewer"];

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
  ];

  function refusal(r) {
    if (!r) return "No response from the server.";
    if (r.message) return r.message;
    if (r.reasons) return (r.error || "refused") + ": " + (Array.isArray(r.reasons) ? r.reasons.join(", ") : String(r.reasons));
    return r.error || "failed";
  }

  var TABS = [["hospital", "Hospital"], ["departments", "Departments"], ["wards", "Wards and beds"], ["rooms", "Rooms"], ["staff", "Staff and roles"]];

  WSQ.page("admin", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("staff.admin")) {
      el.innerHTML = '<div class="title"><h1>Admin Center</h1></div>' +
        '<div class="msg note">Your role does not include staff.admin, so the Admin Center is not available to you.</div>';
      return;
    }
    var tabs = TABS.slice();
    if (c.isWardsynq()) tabs.push(["maik", "MaiK clinical AI"]);
    var tab = st._adminTab || "hospital";
    if (tab === "maik" && !c.isWardsynq()) tab = "hospital";
    el.innerHTML = '<div class="title"><h1>Admin Center</h1><span class="sub">' + c.esc((st.org && st.org.name) || "") + '</span></div>' +
      '<div class="tabs" role="tablist">' + tabs.map(function (t) {
        return '<button type="button" role="tab" data-tab="' + t[0] + '" aria-selected="' + (t[0] === tab) + '">' + c.esc(t[1]) + "</button>";
      }).join("") + '</div><div id="adminBody"><span class="spin"></span></div>';
    el.querySelectorAll("[data-tab]").forEach(function (b) {
      b.onclick = function () { st._adminTab = b.getAttribute("data-tab"); WSQ.render("admin"); };
    });
    var body = document.getElementById("adminBody");
    var renderers = { hospital: renderHospital, departments: renderDepts, wards: renderWards, rooms: renderRooms, staff: renderStaff, maik: renderMaik };
    return renderers[tab](c, body);
  } });

  // ---- Hospital -------------------------------------------------------------------------------
  function renderHospital(c, body) {
    var o = c.state.org || {};
    body.innerHTML = '<div class="card"><h2>' + c.ms("local_hospital") + " Hospital</h2>" +
      '<div class="kv"><dt>Name</dt><dd>' + c.esc(o.name || "") + "</dd>" +
      '<dt>Code</dt><dd class="mono">' + c.esc(o.code || "") + "</dd>" +
      "<dt>Mode</dt><dd>" + c.esc(o.mode || "") + "</dd>" +
      '<dt>Id</dt><dd class="mono">' + c.esc(o.id || "") + "</dd>" +
      '<dt>Connect tenant</dt><dd class="mono">' + c.esc(o.connectTenantId || "none") + "</dd></div>" +
      '<h3>Rename</h3><div class="row"><label class="f"><span>Hospital name</span><input id="admHospName" value="' + c.esc(o.name || "") + '"></label>' +
      '<button class="btn" id="admHospSave" type="button">Save</button></div><div id="admHospMsg"></div>' +
      (c.isWardsynq() ? "" : '<div class="msg note">Inpatient features (ward, beds, theatre, Digital Twin) need a WardSynQ hospital. Create one from the hospital list.</div>') +
      "</div>";
    document.getElementById("admHospSave").onclick = function () {
      var btn = document.getElementById("admHospSave");
      var name = (document.getElementById("admHospName").value || "").trim();
      if (!name) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">Give the hospital a name.</div>'; return; }
      btn.disabled = true;
      c.api("/org/update", { orgId: c.state.orgId, name: name }).then(function (r) {
        btn.disabled = false;
        if (!r || !r.ok) { document.getElementById("admHospMsg").innerHTML = '<div class="msg err">' + c.esc(refusal(r)) + "</div>"; return; }
        c.state.org = r.org; c.toast("Hospital updated."); WSQ.render("admin");
      });
    };
  }

  // ---- Departments ------------------------------------------------------------------------------
  function renderDepts(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/org?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var depts = (r && r.ok && r.departments) || [];
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
      var wards = (r && r.ok && r.wards) || [];
      var wardOpts = wards.map(function (w) { return '<option value="' + c.esc(w.id) + '">' + c.esc(w.name) + "</option>"; }).join("");
      body.innerHTML = '<div class="card"><h2>Wards</h2>' +
        (wards.length ? '<div class="tbl"><table><thead><tr><th>Name</th><th>Code</th><th>Type</th><th>Active</th></tr></thead><tbody>' +
          wards.map(function (w) { return '<tr data-ward-id="' + c.esc(w.id) + '"><td>' + c.esc(w.name) + "</td><td>" + c.esc(w.code) + "</td><td>" + c.esc(w.type) + "</td><td>" + (w.active ? "yes" : "no") + "</td></tr>"; }).join("") +
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
  function renderStaff(c, body) {
    body.innerHTML = '<span class="spin"></span>';
    return c.api("/members?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      var members = (r && r.ok && r.members) || [];
      var roleOpts = ROLES.map(function (rn) { return '<option value="' + rn + '">' + rn + "</option>"; }).join("");
      body.innerHTML =
        '<div class="card"><h2>What each credential lets a person do</h2>' +
        ROLE_NOTES.map(function (l) { return '<p class="quiet"><b>' + c.esc(l[0]) + ":</b> " + c.esc(l[1]) + "</p>"; }).join("") + "</div>" +
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
      body.querySelectorAll("[data-mact]").forEach(function (b) {
        b.onclick = function () {
          var act = b.getAttribute("data-mact"), id = b.getAttribute("data-id");
          c.api("/member/" + act, { orgId: c.state.orgId, identity: id }).then(function (r) {
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
})();
