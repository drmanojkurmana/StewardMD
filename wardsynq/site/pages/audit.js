/* wardsynq/site/pages/audit.js - wardsynq.com Audit and security: record changes, emergency access,
 * source grants, service health. Buildless ES5, registers onto the global WSQ (set by shell.js).
 * Each section is its own card, loads independently and shows its own error - one route being down
 * must never blank the rest of the page. Never renders record CONTENT, only audit-envelope fields.
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  function refusal(c, r) {
    if (!r) return T(c, "site.audit.noResponse", "No response from the server.");
    if (r.message) return r.message;
    if (r.reasons) return (r.error || T(c, "site.audit.refused", "refused")) + ": " + (Array.isArray(r.reasons) ? r.reasons.join(", ") : String(r.reasons));
    return r.error || T(c, "site.audit.failed", "failed");
  }
  // rate objects are { count, rate } with rate 0..1 or null for "no sample" (digital-twin.js's own rate()).
  function pct(c, r) {
    if (!r || r.rate === null || r.rate === undefined) return T(c, "site.audit.notAvailable", "n/a");
    return (Math.round(r.rate * 1000) / 10) + "%";
  }
  function declState(c, active, revokedAt) {
    if (active) return T(c, "site.audit.stateActive", "active");
    if (revokedAt) return T(c, "site.audit.stateDeactivated", "deactivated");
    return T(c, "site.audit.stateExpired", "expired");
  }
  function notifiedWord(c, g) {
    if (g.notification && g.notification.delivered) return T(c, "site.audit.notifiedDelivered", "delivered");
    if (g.notification) return T(c, "site.audit.notifiedNotDelivered", "not delivered");
    return T(c, "site.audit.notifiedNoAttempt", "no attempt");
  }
  function grantStateWord(c, state) {
    if (state === "active") return T(c, "site.audit.grantActive", "active");
    if (state === "revoked") return T(c, "site.audit.grantRevoked", "revoked");
    return state;
  }

  WSQ.page("audit", { render: function (c) {
    var el = c.el, st = c.state;
    if (!c.can("emr.view")) {
      el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.audit.title", "Audit and security")) + '</h1></div>' +
        '<div class="msg note">' + TS(c, "site.audit.gateNote", "Your role does not include emr.view, so audit and security is not available to you.") + '</div>';
      return;
    }
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.audit.title", "Audit and security")) + '</h1><span class="sub">' + EN(c, c.esc((st.org && st.org.name) || "")) + '</span></div>' +
      '<div class="card" id="audChanges"><span class="spin"></span></div>' +
      '<div class="card" id="audEmerg"><span class="spin"></span></div>' +
      '<div class="card" id="audSource"><span class="spin"></span></div>' +
      '<div class="card" id="audHealth"><span class="spin"></span></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.audit.downtimeTitle", "Downtime pack")) + '</h2><p class="quiet">' + c.esc(T(c, "site.audit.downtimeHelp", "Printable ward state for a network outage.")) + '</p>' +
      '<button type="button" class="btn ghost" data-go="ward:downtime">' + c.ms("cloud_off") + c.esc(T(c, "site.audit.downtimeOpen", "Open downtime pack")) + '</button></div>';
    return Promise.all([
      loadChanges(c, document.getElementById("audChanges"), 0),
      loadEmergency(c, document.getElementById("audEmerg")),
      loadSourceGrants(c, document.getElementById("audSource")),
      loadHealth(c, document.getElementById("audHealth")),
    ]);
  } });

  /* LT-37: a time in this browser's clock, digits only ("15-09-2026 22:15"), never raw UTC ISO. */
  function localAt(iso) {
    var d = new Date(iso), p = function (n) { return (n < 10 ? "0" : "") + n; };
    if (!iso || isNaN(d.getTime())) return iso == null ? "" : String(iso);
    return p(d.getDate()) + "-" + p(d.getMonth() + 1) + "-" + d.getFullYear() + " " + p(d.getHours()) + ":" + p(d.getMinutes());
  }
  /* LT-37: who wrote a row, as a person reads it. `names` is GET /ward/actor-names (staff.admin); without it an
   * account shows as a staff account and a mobile-number sign-in ID as "Name not set", never the raw id. */
  function actorHtml(c, id, names) {
    id = String(id || "");
    if (!id || id.indexOf("system:") === 0) return c.esc(T(c, "site.audit.actorSystem", "System"));
    var n = names && names[id];
    if (n && n.name) return EN(c, c.esc(n.name)) + (n.role ? ", " + EN(c, c.esc(n.role)) : "");
    if (/^(fb|cfa|ghis):/.test(id) || /^\+?[\d\s().-]{7,}$/.test(id)) return c.esc(T(c, "site.audit.actorUnnamed", "Staff account, name not set")) + (n && n.role ? ", " + EN(c, c.esc(n.role)) : "");
    return EN(c, c.esc(id));
  }
  /** "_wardsynq_bed_claim" -> "bed claim": the application's own bookkeeping types, in words. Record types stay as they are. */
  function typeText(t) { t = String(t || ""); return t.indexOf("_wardsynq_") === 0 ? t.slice(10).replace(/_/g, " ") : t; }

  // ---- Record changes (WardSynQ-native hospitals with a linked record only) ----------------------
  /* NEWEST FIRST (LT-37). The feed used to start at the hospital's first row, so today's changes were hundreds of
   * rows and several "Load more" presses away. `before` is the previous page's cursor; "Load more" appends older rows. */
  function loadChanges(c, card, before, shown) {
    var st = c.state;
    var title = c.esc(T(c, "site.audit.changesTitle", "Record changes"));
    if (!c.isWardsynq() || !(st.org && st.org.connectTenantId)) {
      card.innerHTML = "<h2>" + title + "</h2><p class=\"quiet\">" + c.esc(T(c, "site.audit.changesNoRecord", "This hospital has no linked WardSynQ record, so there is no change feed to show.")) + "</p>";
      return Promise.resolve();
    }
    if (!shown) card.innerHTML = '<h2>' + title + '</h2><span class="spin"></span>';
    var tenantId = st.org.connectTenantId;
    return c.api("/" + tenantId + "/changes?newest=1&limit=100" + (before ? "&before=" + encodeURIComponent(before) : ""), undefined, "/api/wardsynq").then(function (r) {
      if (!r || !r.ok) { card.innerHTML = "<h2>" + title + "</h2><div class=\"msg err\">" + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
      var records = (shown || []).concat(r.records || []);
      var ids = [];
      records.forEach(function (rec) { var a = rec.writtenBy && rec.writtenBy.id; if (a && ids.indexOf(a) < 0 && a.indexOf("system:") !== 0) ids.push(a); });
      var named = c.can("staff.admin") && ids.length ? c.api("/ward/actor-names?orgId=" + encodeURIComponent(st.orgId) + "&ids=" + encodeURIComponent(ids.slice(0, 100).join(","))) : Promise.resolve(null);
      return named.then(function (nr) { return nr && nr.ok ? nr.names : null; }, function () { return null; }).then(function (names) {
        card.innerHTML = "<h2>" + title + "</h2>" +
          (records.length ? '<p class="quiet">' + c.esc(T(c, "site.audit.changesNewestFirst", "Newest first.")) + '</p><div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.audit.colSeq", "Seq")) + '</th><th>' + c.esc(T(c, "site.audit.colWhen", "When")) + '</th><th>' + c.esc(T(c, "site.audit.colType", "Type")) + '</th><th>' + c.esc(T(c, "site.audit.colId", "Id")) + '</th><th>' + c.esc(T(c, "site.audit.colVersion", "Version")) + '</th><th>' + c.esc(T(c, "site.audit.colActor", "Actor")) + '</th></tr></thead><tbody>' +
            records.map(function (rec) {
              var actor = rec.writtenBy ? rec.writtenBy.id : (rec.resourceType === "_wardsynq_bed_claim" ? "system:bed-claim" : "");
              var at = (rec.writtenBy && rec.writtenBy.at) || rec.claimedAt || "";
              return "<tr><td>" + EN(c, c.esc(rec.seq)) + "</td><td>" + EN(c, c.esc(localAt(at))) + "</td><td>" + EN(c, c.esc(typeText(rec.resourceType))) + '</td><td class="mono">' + EN(c, c.esc(rec.id)) + "</td><td>" + EN(c, c.esc(rec.version)) + "</td><td>" + actorHtml(c, actor, names) + "</td></tr>";
            }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.audit.changesNone", "No changes recorded yet.")) + '</p>') +
          ((r.records || []).length >= 100 && r.cursor ? '<button type="button" class="btn quiet" id="audChangesMore">' + c.esc(T(c, "site.audit.loadMore", "Load more")) + '</button>' : "");
        var more = document.getElementById("audChangesMore");
        if (more) more.onclick = function () { more.disabled = true; loadChanges(c, card, r.cursor, records); };
      });
    });
  }
  WSQ._audit = { actorHtml: actorHtml, localAt: localAt, typeText: typeText };

  // ---- Emergency access: declarations + live status + break-glass grants -------------------------
  function loadEmergency(c, card) {
    var q = "?orgId=" + encodeURIComponent(c.state.orgId);
    var title = c.esc(T(c, "site.audit.emergencyTitle", "Emergency access"));
    card.innerHTML = '<h2>' + title + '</h2><span class="spin"></span>';
    return Promise.all([
      c.api("/ward/emergency-log" + q),
      c.api("/ward/emergency-status" + q),
      c.api("/ward/break-glass-log" + q),
    ]).then(function (res) {
      // LT-37: who declared and who broke glass, by name for an admin (the same lookup as Record changes).
      var ids = [];
      ((res[0] && res[0].activations) || []).forEach(function (a) { if (a.declaredBy && ids.indexOf(a.declaredBy) < 0) ids.push(a.declaredBy); });
      ((res[2] && res[2].grants) || []).forEach(function (g) { if (g.actorId && ids.indexOf(g.actorId) < 0) ids.push(g.actorId); });
      if (!c.can("staff.admin") || !ids.length) return res.concat([null]);
      return c.api("/ward/actor-names" + q + "&ids=" + encodeURIComponent(ids.slice(0, 100).join(","))).then(function (nr) { return res.concat([nr && nr.ok ? nr.names : null]); }, function () { return res.concat([null]); });
    }).then(function (res) {
      var log = res[0], status = res[1], grants = res[2], names = res[3];
      var html = "<h2>" + title + "</h2>";
      if (!log || !log.ok) {
        html += '<div class="msg err">' + c.esc(T(c, "site.audit.declarationsPrefix", "Declarations:")) + " " + EN(c, c.esc(refusal(c, log))) + "</div>";
      } else {
        var acts = log.activations || [];
        html += "<h3>" + c.esc(T(c, "site.audit.declarationsHeading", "Declarations")) + "</h3>" + (acts.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.audit.colState", "State")) + '</th><th>' + c.esc(T(c, "site.audit.colDeclaredBy", "Declared by")) + '</th><th>' + c.esc(T(c, "site.audit.colAt", "At")) + '</th><th>' + c.esc(T(c, "site.audit.colReason", "Reason")) + '</th></tr></thead><tbody>' +
          acts.map(function (a) {
            return "<tr><td><span class=\"pill" + (a.active ? " warn" : "") + "\">" + c.esc(declState(c, a.active, a.revokedAt)) + "</span></td><td>" + actorHtml(c, a.declaredBy, names) + "</td><td>" + EN(c, c.esc(localAt(a.declaredAt))) + "</td><td>" + EN(c, c.esc(a.reason)) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.audit.declarationsNone", "No emergency has ever been declared.")) + '</p>');
      }
      if (status && status.ok) {
        html += status.any ? '<div class="msg note">' + TS(c, "site.audit.emergencyActiveCount", "{count} emergency active right now.", { count: (status.active || []).length }) + '</div>' : '<p class="quiet">' + c.esc(T(c, "site.audit.emergencyNoneActive", "No emergency is active right now.")) + '</p>';
      }
      if (!grants || !grants.ok) {
        html += '<div class="msg err">' + c.esc(T(c, "site.audit.breakGlassPrefix", "Break-glass grants:")) + " " + EN(c, c.esc(refusal(c, grants))) + "</div>";
      } else {
        var gl = grants.grants || [];
        html += "<h3>" + c.esc(T(c, "site.audit.breakGlassHeading", "Break-glass grants")) + "</h3>" + (gl.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.audit.colPatient", "Patient")) + '</th><th>' + c.esc(T(c, "site.audit.colBy", "By")) + '</th><th>' + c.esc(T(c, "site.audit.colAt", "At")) + '</th><th>' + c.esc(T(c, "site.audit.colReason", "Reason")) + '</th><th>' + c.esc(T(c, "site.audit.colNotified", "Notified")) + '</th></tr></thead><tbody>' +
          gl.map(function (g) {
            return '<tr><td class="mono">' + EN(c, c.esc(g.patientId)) + "</td><td>" + actorHtml(c, g.actorId, names) + "</td><td>" + EN(c, c.esc(localAt(g.grantedAt))) + "</td><td>" + EN(c, c.esc(g.reason)) + "</td><td>" + c.esc(notifiedWord(c, g)) + "</td></tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.audit.breakGlassNone", "No break-glass access has been used.")) + '</p>');
      }
      card.innerHTML = html;
    });
  }

  // ---- Source grants (integration sources allowed to write) ---------------------------------------
  function loadSourceGrants(c, card) {
    var title = c.esc(T(c, "site.audit.sourceGrantsTitle", "Source grants"));
    card.innerHTML = '<h2>' + title + '</h2><span class="spin"></span>';
    return c.api("/ward/source-grants?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok) { card.innerHTML = "<h2>" + title + "</h2><div class=\"msg err\">" + EN(c, c.esc(refusal(c, r))) + "</div>"; return; }
      var grants = r.grants || [];
      var canRevoke = c.can("staff.admin");
      card.innerHTML = "<h2>" + title + "</h2>" +
        (grants.length ? '<div class="tbl"><table><thead><tr><th>' + c.esc(T(c, "site.audit.colSystem", "System")) + '</th><th>' + c.esc(T(c, "site.audit.colState", "State")) + '</th><th>' + c.esc(T(c, "site.audit.colNote", "Note")) + '</th><th>' + c.esc(T(c, "site.audit.colGrantedBy", "Granted by")) + '</th><th>' + c.esc(T(c, "site.audit.colGrantedAt", "Granted at")) + '</th>' + (canRevoke ? "<th></th>" : "") + "</tr></thead><tbody>" +
          grants.map(function (g) {
            var pillCls = g.state === "active" ? " ok" : g.state === "revoked" ? " stop" : " warn";
            return "<tr><td>" + EN(c, c.esc(g.sourceSystem)) + '</td><td><span class="pill' + pillCls + '">' + c.esc(grantStateWord(c, g.state)) + "</span></td><td>" + EN(c, c.esc(g.note || "")) + "</td><td>" + EN(c, c.esc(g.grantedBy || "")) + "</td><td>" + EN(c, c.esc(g.grantedAt || "")) + "</td>" +
              (canRevoke ? ("<td>" + (g.state === "active" ? '<button type="button" class="btn quiet" data-revoke="' + c.esc(g.sourceSystem) + '">' + c.esc(T(c, "site.audit.revokeButton", "Revoke")) + '</button>' : "") + "</td>") : "") + "</tr>";
          }).join("") + "</tbody></table></div>" : '<p class="quiet">' + c.esc(T(c, "site.audit.sourceGrantsNone", "No integration source has been granted write access.")) + '</p>') +
        (canRevoke ? "" : '<p class="quiet">' + c.esc(T(c, "site.audit.revokeNeedsAdmin", "Revoking a source needs staff.admin.")) + '</p>');
      card.querySelectorAll("[data-revoke]").forEach(function (b) {
        b.onclick = function () {
          var sys = b.getAttribute("data-revoke");
          var reason = (window.prompt && window.prompt(T(c, "site.audit.revokeReasonPrompt", "Reason for revoking {system}?", { system: sys }))) || "";
          if (!reason) return;
          c.api("/ward/source-revoke", { orgId: c.state.orgId, sourceSystem: sys, reason: reason }).then(function (r2) {
            if (!r2 || !r2.ok) { c.toast(refusal(c, r2)); return; }
            c.toast(T(c, "site.audit.sourceRevoked", "Source revoked.")); loadSourceGrants(c, card);
          });
        };
      });
    });
  }

  // ---- Service health (staff.admin only) -----------------------------------------------------------
  function loadHealth(c, card) {
    var title = c.esc(T(c, "site.audit.healthTitle", "Service health"));
    if (!c.can("staff.admin")) { card.innerHTML = '<h2>' + title + '</h2><p class="quiet">' + c.esc(T(c, "site.audit.healthNeedsAdmin", "Needs staff.admin.")) + '</p>'; return Promise.resolve(); }
    card.innerHTML = '<h2>' + title + '</h2><span class="spin"></span>';
    return c.api("/ward/operational-health?orgId=" + encodeURIComponent(c.state.orgId)).then(function (r) {
      if (!r || !r.ok || !r.health) { card.innerHTML = "<h2>" + title + "</h2><div class=\"msg err\">" + EN(c, c.esc(refusal(c, r) || T(c, "site.audit.unavailable", "unavailable"))) + "</div>"; return; }
      var h = r.health, ai = h.ai || {}, notif = h.notifications || {}, twin = h.twin || {};
      /* LT-37: "AI Status ok" here beside "MaiK Down" on System health read as a contradiction. These statuses are
       * whether each ACTIVITY LOG could be read, and the screen now says so; whether a service answers now is a live
       * check on System health, linked. */
      var logWord = function (s) { return s === "ok" ? c.esc(T(c, "site.audit.logRead", "activity log read")) : EN(c, c.esc(s)); };
      card.innerHTML = "<h2>" + title + "</h2><p class=\"quiet\">" + c.esc(T(c, "site.audit.asOfLabel", "As of")) + " " + EN(c, c.esc(localAt(h.generatedAt))) + "</p>" +
        '<div class="msg note">' + c.esc(T(c, "site.audit.healthIsLogs", "This summarises what the activity logs record. Whether each service is answering right now is checked live on Admin Center, System health.")) +
        ' <button type="button" class="btn quiet" id="audHealthLive">' + c.esc(T(c, "site.audit.openSystemHealth", "Open System health")) + "</button></div>" +
        '<h3>' + c.esc(T(c, "site.audit.aiHeading", "AI")) + '</h3><div class="kv"><dt>' + c.esc(T(c, "site.audit.statusLabel", "Status")) + '</dt><dd>' + logWord(ai.status) + "</dd>" +
        (ai.status === "ok" ? "<dt>" + c.esc(T(c, "site.audit.interactionsSampledLabel", "Interactions sampled")) + "</dt><dd>" + EN(c, c.esc(ai.interactionsSampled)) + "</dd><dt>" + c.esc(T(c, "site.audit.withheldRateLabel", "Withheld rate")) + "</dt><dd>" + pct(c, ai.withheldRate) + "</dd><dt>" + c.esc(T(c, "site.audit.injectionSignalsLabel", "Injection signals")) + "</dt><dd>" + EN(c, c.esc(ai.injectionSignalsObserved)) + "</dd>"
          : "<dt>" + c.esc(T(c, "site.audit.detailLabel", "Detail")) + "</dt><dd>" + EN(c, c.esc(ai.error || "")) + "</dd>") + "</div>" +
        '<h3>' + c.esc(T(c, "site.audit.notificationsHeading", "Notifications")) + '</h3><div class="kv"><dt>' + c.esc(T(c, "site.audit.statusLabel", "Status")) + '</dt><dd>' + logWord(notif.status) + "</dd>" +
        (notif.status === "ok" ? "<dt>" + c.esc(T(c, "site.audit.deliveredLabel", "Delivered")) + "</dt><dd>" + pct(c, notif) + "</dd><dt>" + c.esc(T(c, "site.audit.attemptsLabel", "Attempts")) + "</dt><dd>" + EN(c, c.esc(notif.count)) + "</dd>"
          : "<dt>" + c.esc(T(c, "site.audit.detailLabel", "Detail")) + "</dt><dd>" + EN(c, c.esc(notif.error || "")) + "</dd>") + "</div>" +
        '<h3>' + c.esc(T(c, "site.audit.digitalTwinHeading", "Digital Twin")) + '</h3><div class="kv"><dt>' + c.esc(T(c, "site.audit.statusLabel", "Status")) + '</dt><dd>' + logWord(twin.status) + "</dd>" +
        (twin.status === "ok" ? "<dt>" + c.esc(T(c, "site.audit.sectionsOkLabel", "Sections ok")) + "</dt><dd>" + EN(c, c.esc(twin.sectionsOk)) + " / " + EN(c, c.esc(twin.sectionsTotal)) + "</dd>"
          : "<dt>" + c.esc(T(c, "site.audit.detailLabel", "Detail")) + "</dt><dd>" + EN(c, c.esc(twin.error || "")) + "</dd>") + "</div>" +
        '<p class="quiet">' + c.esc(T(c, "site.audit.excludedLabel", "Not covered by this report:")) + " " + EN(c, c.esc((h.excludedFromThisReport || []).join(", "))) + "</p>";
      var live = document.getElementById("audHealthLive");
      if (live) live.onclick = function () { c.state._adminTab = "health"; c.go("admin"); };
    });
  }
})();
