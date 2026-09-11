/* wardsynq/site/pages/audit.js - wardsynq.com Audit and security: record changes, emergency access,
 * source grants, service health. Buildless ES5, registers onto the global WSQ (set by shell.js).
 * Each section is its own card, loads independently and shows its own error - one route being down
 * must never blank the rest of the page. Never renders record CONTENT, only audit-envelope fields.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  function refusal(r) {
    if (!r) return "No response from the server.";
    if (r.message) return r.message;
    if (r.reasons) return (r.error || "refused") + ": " + (Array.isArray(r.reasons) ? r.reasons.join(", ") : String(r.reasons));
    return r.error || "failed";
  }
  // rate objects are { count, rate } with rate 0..1 or null for "no sample" (digital-twin.js's own rate()).
  function pct(r) {
    if (!r || r.rate === null || r.rate === undefined) return "n/a";
    return (Math.round(r.rate * 1000) / 10) + "%";
  }

  WSQ.page("audit", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("emr.view")) {
      el.innerHTML = '<div class="title"><h1>Audit and security</h1></div>' +
        '<div class="msg note">Your role does not include emr.view, so audit and security is not available to you.</div>';
      return;
    }
    el.innerHTML = '<div class="title"><h1>Audit and security</h1><span class="sub">' + c.esc((st.org && st.org.name) || "") + '</span></div>' +
      '<div class="card" id="audChanges"><span class="spin"></span></div>' +
      '<div class="card" id="audEmerg"><span class="spin"></span></div>' +
      '<div class="card" id="audSource"><span class="spin"></span></div>' +
      '<div class="card" id="audHealth"><span class="spin"></span></div>' +
      '<div class="card"><h2>Downtime pack</h2><p class="quiet">Printable ward state for a network outage.</p>' +
      '<button type="button" class="btn ghost" data-go="ward:downtime">' + c.ms("cloud_off") + "Open downtime pack</button></div>";
    return Promise.all([
      loadChanges(c, document.getElementById("audChanges"), 0),
      loadEmergency(c, document.getElementById("audEmerg")),
      loadSourceGrants(c, document.getElementById("audSource")),
      loadHealth(c, document.getElementById("audHealth")),
    ]);
  } });

  // ---- Record changes (WardSynQ-native hospitals with a linked record only) ----------------------
  function loadChanges(c, card, since) {
    var st = c.state;
    if (!c.isWardsynq() || !(st.org && st.org.connectTenantId)) {
      card.innerHTML = "<h2>Record changes</h2><p class=\"quiet\">This hospital has no linked WardSynQ record, so there is no change feed to show.</p>";
      return Promise.resolve();
    }
    card.innerHTML = '<h2>Record changes</h2><span class="spin"></span>';
    var tenantId = st.org.connectTenantId;
    return c.api("/" + tenantId + "/changes?since=" + (since || 0) + "&limit=100", undefined, "/api/wardsynq").then(function (r) {
      if (!r || !r.ok) { card.innerHTML = "<h2>Record changes</h2><div class=\"msg err\">" + c.esc(refusal(r)) + "</div>"; return; }
      var records = r.records || [];
      card.innerHTML = "<h2>Record changes</h2>" +
        (records.length ? '<div class="tbl"><table><thead><tr><th>Seq</th><th>When</th><th>Type</th><th>Id</th><th>Version</th><th>Actor</th></tr></thead><tbody>' +
          records.map(function (rec) {
            var actor = (rec.writtenBy && rec.writtenBy.id) || "";
            var at = (rec.writtenBy && rec.writtenBy.at) || "";
            return "<tr><td>" + c.esc(rec.seq) + "</td><td>" + c.esc(at) + "</td><td>" + c.esc(rec.resourceType) + '</td><td class="mono">' + c.esc(rec.id) + "</td><td>" + c.esc(rec.version) + "</td><td>" + c.esc(actor) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No changes recorded yet.</p>') +
        (records.length ? '<button type="button" class="btn quiet" id="audChangesMore">Load more</button>' : "");
      var more = document.getElementById("audChangesMore");
      if (more) more.onclick = function () { loadChanges(c, card, r.cursor); };
    });
  }

  // ---- Emergency access: declarations + live status + break-glass grants -------------------------
  function loadEmergency(c, card) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    card.innerHTML = '<h2>Emergency access</h2><span class="spin"></span>';
    return Promise.all([
      c.api("/ward/emergency-log" + q),
      c.api("/ward/emergency-status" + q),
      c.api("/ward/break-glass-log" + q),
    ]).then(function (res) {
      var log = res[0], status = res[1], grants = res[2];
      var html = "<h2>Emergency access</h2>";
      if (!log || !log.ok) {
        html += '<div class="msg err">Declarations: ' + c.esc(refusal(log)) + "</div>";
      } else {
        var acts = log.activations || [];
        html += "<h3>Declarations</h3>" + (acts.length ? '<div class="tbl"><table><thead><tr><th>State</th><th>Declared by</th><th>At</th><th>Reason</th></tr></thead><tbody>' +
          acts.map(function (a) {
            var state = a.active ? "active" : (a.revokedAt ? "deactivated" : "expired");
            return "<tr><td><span class=\"pill" + (a.active ? " warn" : "") + "\">" + c.esc(state) + "</span></td><td>" + c.esc(a.declaredBy) + "</td><td>" + c.esc(a.declaredAt) + "</td><td>" + c.esc(a.reason) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No emergency has ever been declared.</p>');
      }
      if (status && status.ok) {
        html += status.any ? '<div class="msg note">' + (status.active || []).length + " emergency active right now.</div>" : '<p class="quiet">No emergency is active right now.</p>';
      }
      if (!grants || !grants.ok) {
        html += '<div class="msg err">Break-glass grants: ' + c.esc(refusal(grants)) + "</div>";
      } else {
        var gl = grants.grants || [];
        html += "<h3>Break-glass grants</h3>" + (gl.length ? '<div class="tbl"><table><thead><tr><th>Patient</th><th>By</th><th>At</th><th>Reason</th><th>Notified</th></tr></thead><tbody>' +
          gl.map(function (g) {
            var notified = g.notification && g.notification.delivered ? "delivered" : g.notification ? "not delivered" : "no attempt";
            return '<tr><td class="mono">' + c.esc(g.patientId) + "</td><td>" + c.esc(g.actorId) + "</td><td>" + c.esc(g.grantedAt) + "</td><td>" + c.esc(g.reason) + "</td><td>" + c.esc(notified) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No break-glass access has been used.</p>');
      }
      card.innerHTML = html;
    });
  }

  // ---- Source grants (integration sources allowed to write) ---------------------------------------
  function loadSourceGrants(c, card) {
    card.innerHTML = '<h2>Source grants</h2><span class="spin"></span>';
    return c.api("/ward/source-grants?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { card.innerHTML = "<h2>Source grants</h2><div class=\"msg err\">" + c.esc(refusal(r)) + "</div>"; return; }
      var grants = r.grants || [];
      var canRevoke = c.can("staff.admin");
      card.innerHTML = "<h2>Source grants</h2>" +
        (grants.length ? '<div class="tbl"><table><thead><tr><th>System</th><th>State</th><th>Note</th><th>Granted by</th><th>Granted at</th>' + (canRevoke ? "<th></th>" : "") + "</tr></thead><tbody>" +
          grants.map(function (g) {
            var pillCls = g.state === "active" ? " ok" : g.state === "revoked" ? " stop" : " warn";
            return "<tr><td>" + c.esc(g.sourceSystem) + '</td><td><span class="pill' + pillCls + '">' + c.esc(g.state) + "</span></td><td>" + c.esc(g.note || "") + "</td><td>" + c.esc(g.grantedBy || "") + "</td><td>" + c.esc(g.grantedAt || "") + "</td>" +
              (canRevoke ? ("<td>" + (g.state === "active" ? '<button type="button" class="btn quiet" data-revoke="' + c.esc(g.sourceSystem) + '">Revoke</button>' : "") + "</td>") : "") + "</tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">No integration source has been granted write access.</p>') +
        (canRevoke ? "" : '<p class="quiet">Revoking a source needs staff.admin.</p>');
      card.querySelectorAll("[data-revoke]").forEach(function (b) {
        b.onclick = function () {
          var sys = b.getAttribute("data-revoke");
          var reason = (window.prompt && window.prompt("Reason for revoking " + sys + "?")) || "";
          if (!reason) return;
          c.api("/ward/source-revoke", { orgId: c.state.orgId, sourceSystem: sys, reason: reason }).then(function (r2) {
            if (!r2 || !r2.ok) { c.toast(refusal(r2)); return; }
            c.toast("Source revoked."); loadSourceGrants(c, card);
          });
        };
      });
    });
  }

  // ---- Service health (staff.admin only) -----------------------------------------------------------
  function loadHealth(c, card) {
    if (!c.can("staff.admin")) { card.innerHTML = '<h2>Service health</h2><p class="quiet">Needs staff.admin.</p>'; return Promise.resolve(); }
    card.innerHTML = '<h2>Service health</h2><span class="spin"></span>';
    return c.api("/ward/operational-health?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok || !r.health) { card.innerHTML = "<h2>Service health</h2><div class=\"msg err\">" + c.esc(refusal(r) || "unavailable") + "</div>"; return; }
      var h = r.health, ai = h.ai || {}, notif = h.notifications || {}, twin = h.twin || {};
      card.innerHTML = "<h2>Service health</h2><p class=\"quiet\">As of " + c.esc(h.generatedAt) + "</p>" +
        '<h3>AI</h3><div class="kv"><dt>Status</dt><dd>' + c.esc(ai.status) + "</dd>" +
        (ai.status === "ok" ? "<dt>Interactions sampled</dt><dd>" + c.esc(ai.interactionsSampled) + "</dd><dt>Withheld rate</dt><dd>" + pct(ai.withheldRate) + "</dd><dt>Injection signals</dt><dd>" + c.esc(ai.injectionSignalsObserved) + "</dd>"
          : "<dt>Detail</dt><dd>" + c.esc(ai.error || "") + "</dd>") + "</div>" +
        '<h3>Notifications</h3><div class="kv"><dt>Status</dt><dd>' + c.esc(notif.status) + "</dd>" +
        (notif.status === "ok" ? "<dt>Delivered</dt><dd>" + pct(notif) + "</dd><dt>Attempts</dt><dd>" + c.esc(notif.count) + "</dd>"
          : "<dt>Detail</dt><dd>" + c.esc(notif.error || "") + "</dd>") + "</div>" +
        '<h3>Digital Twin</h3><div class="kv"><dt>Status</dt><dd>' + c.esc(twin.status) + "</dd>" +
        (twin.status === "ok" ? "<dt>Sections ok</dt><dd>" + c.esc(twin.sectionsOk) + " / " + c.esc(twin.sectionsTotal) + "</dd>"
          : "<dt>Detail</dt><dd>" + c.esc(twin.error || "") + "</dd>") + "</div>" +
        '<p class="quiet">Not covered by this report: ' + c.esc((h.excludedFromThisReport || []).join(", ")) + "</p>";
    });
  }
})();
