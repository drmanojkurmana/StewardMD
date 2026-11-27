/* StewardMD - ResearchMD Institution Workspace screen (window.SMD_RESEARCH.screens.institution).
 * ES5 only, buildless, mobile-first. Phase 6: institution workspaces,
 * members, roles, seat allocations, institution-owned projects, and pilot
 * onboarding checklist.
 * Contracts per docs/research/contracts/phase-6/institutions.md.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }

  var st = {
    loaded: false,
    loading: false,
    error: null,
    busy: false,
    actionError: null,
    announce: "",
    phoneView: "members",
    institutions: [],
    selectedInstId: null,
    institution: null,
    seats: 10,
    usedSeats: 0,
    members: [],
    projects: [],
    onboarding: [],
    newMemberUid: "",
    newMemberRole: "member"
  };
  var seq = 0;

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;

    SMD.api.request("GET", "/v1/institutions").then(function (res) {
      if (mySeq !== seq) return;
      var insts = (res && res.institutions) || [];
      st.institutions = insts;
      st.institution = null;
      if (!st.selectedInstId && insts.length) {
        st.selectedInstId = insts[0].id;
      }
      if (st.selectedInstId) {
        for (var i = 0; i < insts.length; i++) {
          if (insts[i].id === st.selectedInstId) st.institution = insts[i];
        }
      }
      if (!st.institution && insts.length) {
        st.selectedInstId = insts[0].id;
        st.institution = insts[0];
      }

      /* Live BUG-12: no institution on this account is a normal state. The
       * old fallback invented an "inst_default" workspace, then fired three
       * 404s for it and rendered mock members and projects. Show the empty
       * state instead and request nothing. */
      if (!st.institution) {
        st.selectedInstId = null;
        st.members = [];
        st.projects = [];
        st.onboarding = [];
        st.seats = 0;
        st.usedSeats = 0;
        st.loading = false;
        st.loaded = true;
        render(container);
        return null;
      }

      var id = st.selectedInstId;
      return Promise.all([
        SMD.api.request("GET", "/v1/institutions/" + encodeURIComponent(id) + "/seats").catch(function () { return null; }),
        SMD.api.request("GET", "/v1/institutions/" + encodeURIComponent(id) + "/projects").catch(function () { return null; }),
        SMD.api.request("GET", "/v1/institutions/" + encodeURIComponent(id) + "/onboarding").catch(function () { return null; })
      ]);
    }).then(function (data) {
      if (mySeq !== seq) return;
      if (data) {
        var seatsData = data[0];
        if (seatsData) {
          st.seats = seatsData.seats || 10;
          st.usedSeats = seatsData.used || (seatsData.members ? seatsData.members.length : 0);
          st.members = seatsData.members || [];
        } else {
          st.seats = st.seats || 10;
          st.usedSeats = st.members.length;
        }

        var projData = data[1];
        st.projects = (projData && projData.projects) || [];

        var obData = data[2];
        st.onboarding = (obData && obData.items) || [];
      }
      st.loading = false;
      st.loaded = true;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function addMember(container) {
    var uid = (st.newMemberUid || "").trim();
    if (!uid || st.busy) return;
    if (st.usedSeats >= st.seats) {
      st.actionError = { code: "seats_full", message: "Seat limit reached (" + st.seats + " seats). Contact administrator to expand seats." };
      render(container);
      return;
    }
    st.busy = true;
    st.actionError = null;
    st.announce = "";
    render(container);

    var mySeq = ++seq;
    var id = st.selectedInstId;
    SMD.api.request("POST", "/v1/institutions/" + encodeURIComponent(id) + "/members", {
      uid: uid,
      role: st.newMemberRole || "member"
    }).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var newM = (res && res.member) || { uid: uid, role: st.newMemberRole || "member", createdTs: Date.now() };
      st.members.push(newM);
      st.usedSeats = st.members.length;
      st.newMemberUid = "";
      st.announce = "Member " + uid + " added with role " + newM.role + ".";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function updateMemberRole(container, uid, newRole) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var id = st.selectedInstId;
    SMD.api.request("PUT", "/v1/institutions/" + encodeURIComponent(id) + "/members/" + encodeURIComponent(uid), {
      role: newRole
    }).then(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      for (var i = 0; i < st.members.length; i++) {
        if (st.members[i].uid === uid) st.members[i].role = newRole;
      }
      st.announce = "Role updated to " + newRole + " for " + uid + ".";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function removeMember(container, uid) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var id = st.selectedInstId;
    SMD.api.request("DELETE", "/v1/institutions/" + encodeURIComponent(id) + "/members/" + encodeURIComponent(uid)).then(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      st.members = st.members.filter(function (m) { return m.uid !== uid; });
      st.usedSeats = st.members.length;
      st.announce = "Member " + uid + " removed from institution workspace.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function toggleOnboarding(container, key, nextVal) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var id = st.selectedInstId;
    var payload = { items: {} };
    payload.items[key] = nextVal;

    SMD.api.request("PUT", "/v1/institutions/" + encodeURIComponent(id) + "/onboarding", payload).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      if (res && res.items) {
        st.onboarding = res.items;
      } else {
        for (var i = 0; i < st.onboarding.length; i++) {
          if (st.onboarding[i].key === key) st.onboarding[i].done = nextVal;
        }
      }
      st.announce = "Onboarding checklist updated.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  /* ---------- HTML Builders ---------- */

  function leftPaneHtml() {
    var h = [];
    var hideMembers = st.phoneView !== "members";
    h.push('<div class="rmd-pane-left rmd-inst-left' + (hideMembers ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Institution Overview Card */
    var inst = st.institution || { name: "Institution Workspace" };
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">' + esc(inst.name) + '</h3>');
    h.push('<span class="rmd-badge rmd-badge-pill" id="rmdInstSeatsBadge">' + st.usedSeats + ' of ' + st.seats + ' seats used</span></div>');
    h.push('<p class="rmd-muted">Enterprise workspace for collaborative research, shared institution credits, and seat management.</p>');
    h.push('</div>');

    /* Add Member Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Add Team Member</h3>');
    h.push('<div class="rmd-field"><label for="rmdNewMemberUid">User identifier / email</label>');
    h.push('<input type="text" id="rmdNewMemberUid" placeholder="e.g. dr_patel or user@hospital.org" value="' + esc(st.newMemberUid) + '"></div>');
    h.push('<div class="rmd-field"><label for="rmdNewMemberRole">Workspace role</label>');
    h.push('<select id="rmdNewMemberRole">');
    h.push('<option value="member"' + (st.newMemberRole === "member" ? " selected" : "") + '>Member (Researcher)</option>');
    h.push('<option value="admin"' + (st.newMemberRole === "admin" ? " selected" : "") + '>Admin (Manage seats and credits)</option>');
    h.push('</select></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="add-member"' + (st.busy || !st.newMemberUid.trim() ? " disabled" : "") + '>Add Member</button>');
    h.push('</div>');

    /* Members List Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Members (' + st.members.length + ')</h3>');
    if (!st.members.length) {
      h.push('<p class="rmd-muted">No members added to this institution workspace yet.</p>');
    } else {
      h.push('<div class="rmd-data-versions" id="rmdMembersList">');
      for (var m = 0; m < st.members.length; m++) {
        var member = st.members[m];
        var isAdmin = member.role === "admin";
        h.push('<div class="rmd-row-btn" style="cursor:default" data-rmd-member-row="' + esc(member.uid) + '">');
        h.push('<div style="display:flex;justify-content:space-between;align-items:center;width:100%">');
        h.push('<span class="rmd-row-title">' + esc(member.uid) + '</span>');
        h.push('<span class="rmd-badge ' + (isAdmin ? "rmd-badge-pill" : "rmd-badge-soft") + '">' + esc(member.role) + '</span>');
        h.push('</div>');
        h.push('<span class="rmd-row-meta">Joined ' + (member.createdTs ? p2().fmtTs(member.createdTs) : "recently") + '</span>');
        h.push('<div style="display:flex;gap:6px;margin-top:6px">');
        if (isAdmin) {
          h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-change-role="' + esc(member.uid) + '" data-rmd-to-role="member"' + (st.busy ? " disabled" : "") + '>Make Member</button>');
        } else {
          h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-change-role="' + esc(member.uid) + '" data-rmd-to-role="admin"' + (st.busy ? " disabled" : "") + '>Make Admin</button>');
        }
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-remove-member="' + esc(member.uid) + '"' + (st.busy ? " disabled" : "") + '>Remove</button>');
        h.push('</div>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function rightPaneHtml() {
    var h = [];
    var hideRight = st.phoneView !== "projects" && st.phoneView !== "onboarding";
    h.push('<div class="rmd-pane-right rmd-inst-right' + (hideRight ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Institution Projects Card */
    h.push('<div class="rmd-card' + (st.phoneView === "onboarding" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Institution Projects (' + st.projects.length + ')</h3>');
    h.push('<span class="rmd-badge rmd-badge-soft">Tenant Isolated</span></div>');
    h.push('<p class="rmd-muted">Projects created under this institution draw from the shared credit pool. Project access and patient data remain isolated per ethics protocols.</p>');

    if (!st.projects.length) {
      h.push('<p class="rmd-muted">No projects created under this institution workspace yet.</p>');
    } else {
      h.push('<div class="rmd-data-versions">');
      for (var p = 0; p < st.projects.length; p++) {
        var proj = st.projects[p];
        h.push('<div class="rmd-row-btn" style="cursor:default">');
        h.push('<span class="rmd-row-title">' + esc(proj.title) + '</span>');
        h.push('<span class="rmd-row-meta">' + esc(proj.specialty || proj.discipline || "General") + (proj.studyType ? " · " + esc(proj.studyType) : "") + '</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    /* Onboarding Checklist Card */
    h.push('<div class="rmd-card' + (st.phoneView === "projects" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Pilot Onboarding Checklist</h3>');
    var doneCount = 0;
    for (var c = 0; c < st.onboarding.length; c++) if (st.onboarding[c].done) doneCount++;
    h.push('<span class="rmd-badge ' + (doneCount === st.onboarding.length ? "rmd-badge-pill" : "rmd-badge-soft") + '">' + doneCount + ' of ' + st.onboarding.length + ' complete</span></div>');
    h.push('<p class="rmd-muted">Milestones required for enterprise pilot activation and governance verification.</p>');

    h.push('<div class="rmd-data-checks" role="table" aria-label="Onboarding checklist">');
    for (var i = 0; i < st.onboarding.length; i++) {
      var item = st.onboarding[i];
      var isManual = item.source === "manual";
      h.push('<div class="rmd-data-check" role="row" style="padding:10px 12px">');
      h.push('<span class="rmd-badge ' + (item.done ? "rmd-badge-pill" : "rmd-badge-neutral") + '">' + (item.done ? "Done" : "Pending") + '</span>');
      h.push('<div style="flex:1">');
      h.push('<div class="rmd-row-title" style="font-size:13.5px">' + esc(item.label) + '</div>');
      h.push('<span class="rmd-muted" style="font-size:11.5px">' + (isManual ? "Manual attestation" : "System verified") + '</span>');
      h.push('</div>');
      if (isManual) {
        h.push('<label class="rmd-check-label" style="margin:0"><input type="checkbox" data-rmd-onboarding="' + esc(item.key) + '"' + (item.done ? " checked" : "") + (st.busy ? " disabled" : "") + '></label>');
      }
      h.push('</div>');
    }
    h.push('</div>');
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading institution workspace") + '</div>';
      load(container);
      return;
    }

    /* A failed load shows its error; it must not look like "no institution". */
    if (st.error) {
      var oh = [];
      oh.push('<div class="rmd-studies-screen">');
      oh.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
      oh.push('<h2 class="rmd-topbar-proj-title">Institution Workspace</h2>');
      oh.push('</div></div></div>');
      oh.push('<div class="rmd-p2-screen">' + p2().errHtml(st.error, null) + '</div>');
      oh.push('</div>');
      container.innerHTML = oh.join("\n");
      return;
    }

    /* No institution on this account: a clear empty state, no mock data. */
    if (!st.institution) {
      var eh = [];
      eh.push('<div class="rmd-studies-screen">');
      eh.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
      eh.push('<h2 class="rmd-topbar-proj-title">Institution Workspace</h2>');
      eh.push('</div></div></div>');
      eh.push('<div class="rmd-empty-state">');
      eh.push('  <div class="rmd-empty-icon"><svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"><path d="M3 21h18"></path><path d="M5 21V7l7-4 7 4v14"></path><path d="M9 21v-6h6v6"></path></svg></div>');
      eh.push('  <h3>No institution workspace yet</h3>');
      eh.push('  <p>Your account is not part of an institution workspace. When your institution joins StewardMD, its members, shared projects and pilot onboarding checklist appear here.</p>');
      eh.push('</div>');
      eh.push('</div>');
      container.innerHTML = eh.join("\n");
      return;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Institution Workspace</h2>');
    if (st.institution) {
      h.push('<span class="rmd-badge rmd-badge-soft">' + esc(st.institution.name) + '</span>');
    }
    h.push('</div></div></div>');

    if (st.actionError) h.push('<div style="padding:10px 16px">' + p2().errHtml(st.actionError, null) + '</div>');
    if (st.announce) h.push('<div style="padding:10px 16px"><div class="rmd-banner rmd-banner-info" role="status" aria-live="polite">' + esc(st.announce) + '</div></div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "members" ? " rmd-seg-active" : "") + '" data-rmd-inst-view="members">Members</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "projects" ? " rmd-seg-active" : "") + '" data-rmd-inst-view="projects">Projects</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "onboarding" ? " rmd-seg-active" : "") + '" data-rmd-inst-view="onboarding">Onboarding</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    h.push(leftPaneHtml());
    h.push(rightPaneHtml());
    h.push('</div></div>');

    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }

    var viewBtns = container.querySelectorAll("[data-rmd-inst-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-inst-view");
        render(container);
      };
    }

    var uidInput = container.querySelector("#rmdNewMemberUid");
    if (uidInput) {
      uidInput.oninput = function () {
        st.newMemberUid = this.value;
        var btn = container.querySelector('[data-rmd="add-member"]');
        if (btn) btn.disabled = !this.value.trim() || st.busy;
      };
    }

    var roleSel = container.querySelector("#rmdNewMemberRole");
    if (roleSel) {
      roleSel.onchange = function () { st.newMemberRole = this.value; };
    }

    on('[data-rmd="add-member"]', function () { addMember(container); });

    var roleBtns = container.querySelectorAll("[data-rmd-change-role]");
    for (var r = 0; r < roleBtns.length; r++) {
      roleBtns[r].onclick = function () {
        var uid = this.getAttribute("data-rmd-change-role");
        var toRole = this.getAttribute("data-rmd-to-role");
        if (uid && toRole) updateMemberRole(container, uid, toRole);
      };
    }

    var remBtns = container.querySelectorAll("[data-rmd-remove-member]");
    for (var rm = 0; rm < remBtns.length; rm++) {
      remBtns[rm].onclick = function () {
        var uid = this.getAttribute("data-rmd-remove-member");
        if (uid) removeMember(container, uid);
      };
    }

    var obChecks = container.querySelectorAll("[data-rmd-onboarding]");
    for (var o = 0; o < obChecks.length; o++) {
      obChecks[o].onchange = function () {
        var key = this.getAttribute("data-rmd-onboarding");
        if (key) toggleOnboarding(container, key, this.checked);
      };
    }
  }

  SMD.screens.institution = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
