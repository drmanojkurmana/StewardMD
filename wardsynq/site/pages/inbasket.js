/* wardsynq/site/pages/inbasket.js - "In-basket": staff messages and everything else waiting on this person, in one place.
 *
 * Staff messages (functions/_wardsynq/staff-messaging.js): threads about a patient or a unit, addressed to roles, with
 * read state, edit and recall kept as versions, and an alert by push that carries no patient details. Nothing here
 * sends SMS, WhatsApp or email.
 *
 * Waiting on you: the lists that already exist, read from their own routes (patient portal messages, referrals, notes
 * to co-sign, the safety inbox with critical results), each with its age and owner. Every list keeps loading, failed
 * and empty apart: a list that could not be read never reads as "nothing waiting".
 */
(function () {
  "use strict";
  var WSQ = window.WSQ;
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }
  function val(id) { var e = document.getElementById(id); return e ? String(e.value || "").trim() : ""; }
  function at(iso) { var d = new Date(iso); return isNaN(d.getTime()) ? "" : d.toLocaleString(); }
  function hoursSince(iso) { var t = Date.parse(iso); return isNaN(t) ? null : Math.max(0, Math.round((Date.now() - t) / 3600000)); }
  /* Addressable roles offered on the form. Values are role codes sent to the server, never translated. */
  var ROLES = ["doctor", "nurse", "supervisor", "reception"];
  function roleLabel(c, r) {
    if (r === "doctor") return T(c, "site.inbasket.role.doctor", "Doctors");
    if (r === "nurse") return T(c, "site.inbasket.role.nurse", "Nurses");
    if (r === "supervisor") return T(c, "site.inbasket.role.supervisor", "Supervisors");
    return T(c, "site.inbasket.role.reception", "Front desk");
  }

  /** PURE. Why a request failed, in words, with the server's English under it. */
  function failed(c, r) {
    var why = r && (r.detail || r.message || r.error);
    return '<div class="msg err" role="alert">' + TS(c, "site.inbasket.notDone", "That did not go through. Nothing was changed.") + (why ? '<br><span class="quiet">' + EN(c, c.esc(why)) + "</span>" : "") + "</div>";
  }

  /** PURE. The thread list, with loading, failed and empty distinct. */
  function threadsHtml(c, r, open) {
    if (r == null) return '<p aria-live="polite"><span class="spin"></span> ' + c.esc(T(c, "site.inbasket.loadingThreads", "Loading messages...")) + "</p>";
    if (!r.ok) return '<div class="msg err" role="alert">' + TS(c, "site.inbasket.threadsFailed", "Messages could not be loaded. Do not read this as no messages.") + "</div>";
    if (!r.threads.length) return '<p data-empty="threads">' + c.esc(T(c, "site.inbasket.noThreads", "No message threads here.")) + "</p>";
    return (r.warning ? '<div class="msg err">' + EN(c, c.esc(r.warning)) + "</div>" : "") + '<ul class="ib-threads">' + r.threads.map(function (t) {
      var about = t.patientId ? EN(c, c.esc((t.patient && t.patient.name) || t.patientId)) + (t.patient && t.patient.mrn ? " (" + EN(c, c.esc(t.patient.mrn)) + ")" : "") : c.esc(T(c, "site.inbasket.unitLabel", "Unit")) + ": " + EN(c, c.esc(t.unit || ""));
      return '<li><button class="btn quiet" type="button" data-ib="open" data-id="' + c.esc(t.threadId) + '" aria-expanded="' + (open === t.threadId ? "true" : "false") + '">' +
        "<b>" + EN(c, c.esc(t.subject)) + "</b></button> " + about +
        (t.unread ? ' <span class="pill warn">' + c.esc(T(c, "site.inbasket.unread", "{n} unread", { n: t.unread })) + "</span>" : "") +
        ' <span class="quiet">' + c.esc(T(c, "site.inbasket.lastAt", "last message {at}", { at: at(t.lastAt) })) + "</span>" +
        (open === t.threadId ? '<div id="ibThread"></div>' : "") + "</li>";
    }).join("") + "</ul>";
  }

  /** PURE. One open thread: its messages, the author's own edit and recall, a reply box and the push alert. */
  function threadHtml(c, t, me) {
    var rows = t.messages.map(function (m) {
      var who = EN(c, c.esc(m.fromName || m.from)) + (m.fromRole ? " (" + EN(c, c.esc(m.fromRole)) + ")" : "");
      var body = m.recalled
        ? '<div class="msg note">' + c.esc(T(c, "site.inbasket.recalledLead", "Recalled by the sender:")) + " " + EN(c, c.esc(m.recalled.reason || "")) + "</div>"
        : '<div style="white-space:pre-wrap">' + EN(c, c.esc(m.body)) + "</div>";
      var mine = m.from === me && !m.recalled;
      return "<li><b>" + who + "</b> " + '<span class="quiet">' + c.esc(at(m.sentAt)) + (m.editedAt ? ", " + c.esc(T(c, "site.inbasket.edited", "edited")) : "") + "</span>" +
        (m.urgent ? ' <span class="pill stop">' + c.esc(T(c, "site.inbasket.urgent", "urgent")) + "</span>" : "") + body +
        (mine ? '<div class="row"><button class="btn quiet" type="button" data-ib="edit" data-id="' + c.esc(m.messageId) + '" data-v="' + c.esc(m.version) + '">' + c.esc(T(c, "site.inbasket.edit", "Edit")) + '</button><button class="btn danger" type="button" data-ib="recall" data-id="' + c.esc(m.messageId) + '" data-v="' + c.esc(m.version) + '">' + c.esc(T(c, "site.inbasket.recall", "Recall")) + "</button></div>" : "") +
        (m.escalations && m.escalations.length ? '<div class="quiet">' + m.escalations.map(function (e) { return c.esc(escalationText(c, e)); }).join("<br>") + "</div>" : "") + "</li>";
    }).join("");
    var last = t.messages[t.messages.length - 1];
    return '<ul class="ib-messages">' + rows + "</ul>" +
      '<div class="row"><label class="f" style="flex:2 1 260px"><span>' + c.esc(T(c, "site.inbasket.replyLabel", "Reply")) + '</span><textarea id="ibReply" rows="2" maxlength="2000"></textarea></label>' +
      '<button class="btn primary" type="button" data-ib="reply" data-id="' + c.esc(t.threadId) + '">' + c.esc(T(c, "site.inbasket.send", "Send")) + "</button>" +
      (t.toRoles.length && last && !last.recalled ? '<button class="btn quiet" type="button" data-ib="escalate" data-id="' + c.esc(last.messageId) + '">' + c.esc(T(c, "site.inbasket.alert", "Alert by push")) + "</button>" : "") + "</div>" +
      '<p class="quiet">' + c.esc(T(c, "site.inbasket.pushNote", "An alert tells the addressed roles who have not read this that a message is waiting. It carries no patient name, number, ward or text.")) + "</p>";
  }

  /** PURE. What a push attempt did, as plain text, never "delivered". */
  function escalationText(c, e) {
    if (e.reason === "PUSH_OFF") return T(c, "site.inbasket.pushOff", "Alert not sent: push alerts are off for this hospital.");
    if (e.reason === "NO_RECIPIENT") return T(c, "site.inbasket.pushNobody", "Alert not sent: everyone addressed has read it, or nobody holds the addressed roles.");
    if (e.reason === "NO_DEVICE") return T(c, "site.inbasket.pushNoDevice", "Alert not sent: none of the {n} people addressed has a phone registered.", { n: e.recipients });
    if (e.reason === "PUSH_NOT_CONFIGURED") return T(c, "site.inbasket.pushNotConfigured", "Alert not sent: push is not set up on this server.");
    if (e.reason) return T(c, "site.inbasket.pushNotSent", "Alert not sent: the push could not be attempted.");
    return T(c, "site.inbasket.pushSent", "Alert sent to {sent} of {total} phones for {n} people. Sent is not read.", { sent: e.sent, total: e.total, n: e.recipients });
  }

  /** PURE. One "waiting on you" source: loading, failed, empty or its items with age and owner. */
  function sourceHtml(c, title, r, rows, open) {
    var head = "<h3>" + c.esc(title) + (open ? ' <button class="btn quiet" type="button" data-go="' + c.esc(open) + '">' + c.esc(T(c, "site.inbasket.openList", "Open")) + "</button>" : "") + "</h3>";
    if (r == null) return head + '<p aria-live="polite"><span class="spin"></span> ' + c.esc(T(c, "site.inbasket.loading", "Loading...")) + "</p>";
    if (r.status === 403 || r.error === "permission") return head + '<p class="quiet">' + c.esc(T(c, "site.inbasket.notForRole", "Not part of your role.")) + "</p>";
    if (!r.ok) return head + '<div class="msg err" role="alert">' + TS(c, "site.inbasket.sourceFailed", "Could not be loaded. Do not read this as nothing waiting.") + "</div>";
    var items = rows(r);
    if (!items.length) return head + "<p>" + c.esc(T(c, "site.inbasket.nothingWaiting", "Nothing waiting.")) + "</p>";
    return head + (r.warning ? '<div class="msg err">' + EN(c, c.esc(r.warning)) + "</div>" : "") + "<ul>" + items.slice(0, 20).map(function (i) {
      return "<li>" + EN(c, c.esc(i.what)) + ' <span class="quiet">' + c.esc(T(c, "site.inbasket.age", "waiting {h} h", { h: i.hours == null ? "?" : i.hours })) +
        (i.owner ? ", " + c.esc(T(c, "site.inbasket.ownerLead", "for")) + " " + EN(c, c.esc(i.owner)) : "") + "</span></li>";
    }).join("") + (items.length > 20 ? "<li>" + c.esc(T(c, "site.inbasket.more", "and {n} more", { n: items.length - 20 })) + "</li>" : "") + "</ul>";
  }

  WSQ.page("inbasket", { render: function (c) {
    var el = c.el, st = c.state, org = st.orgId, q = "?orgId=" + encodeURIComponent(org);
    if (!c.can("emr.view")) { el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.inbasket.title", "In-basket")) + '</h1></div><div class="msg note">' + TS(c, "site.inbasket.noAccess", "Your role cannot read the chart, so it has no staff messages or clinical in-basket.") + "</div>"; return; }
    var S = { view: "mine", threads: null, open: null, me: null, patients: [] };
    var set = function (id, h) { var e = document.getElementById(id); if (e) e.innerHTML = h; };
    el.innerHTML = '<div class="title"><h1>' + c.esc(T(c, "site.inbasket.title", "In-basket")) + '</h1><span class="sub">' + c.esc(T(c, "site.inbasket.subtitle", "staff messages and what is waiting on you")) + "</span></div>" +
      '<div class="msg note">' + TS(c, "site.inbasket.keepInside", "Messages stay inside WardSynQ: nothing is sent by SMS, WhatsApp or email. A message about a patient is seen only by staff who may see that patient, and every edit or recall is kept.") + "</div>" +
      '<div class="card"><h2>' + c.esc(T(c, "site.inbasket.messagesCard", "Staff messages")) + "</h2>" +
      '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.inbasket.show", "Show")) + '</span><select id="ibView"><option value="mine">' + c.esc(T(c, "site.inbasket.forMe", "For my role or started by me")) + '</option><option value="">' + c.esc(T(c, "site.inbasket.all", "All I may see")) + "</option></select></label>" +
      '<button class="btn quiet" type="button" data-ib="refresh">' + c.esc(T(c, "site.inbasket.refresh", "Refresh")) + "</button></div>" +
      '<div id="ibThreads"></div></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.inbasket.newCard", "New thread")) + "</h2>" +
      '<div class="row"><label class="f"><span>' + c.esc(T(c, "site.inbasket.about", "About")) + '</span><select id="ibAbout"><option value="">' + c.esc(T(c, "site.inbasket.aUnit", "A unit, no patient")) + "</option></select></label>" +
      '<label class="f"><span>' + c.esc(T(c, "site.inbasket.unitField", "Unit (when not about a patient)")) + '</span><input id="ibUnit" maxlength="60"></label></div>' +
      '<p class="quiet">' + c.esc(T(c, "site.inbasket.unitWarning", "Do not name a patient in a unit thread; choose the patient instead, so only staff who may see them can read it.")) + "</p>" +
      '<div class="row"><label class="f" style="flex:2 1 260px"><span>' + c.esc(T(c, "site.inbasket.subject", "Subject")) + '</span><input id="ibSubject" maxlength="120"></label></div>' +
      '<div class="row"><label class="f" style="flex:2 1 260px"><span>' + c.esc(T(c, "site.inbasket.message", "Message")) + '</span><textarea id="ibBody" rows="3" maxlength="2000"></textarea></label></div>' +
      '<fieldset><legend>' + c.esc(T(c, "site.inbasket.toLegend", "For")) + "</legend>" + ROLES.map(function (r) { return '<label><input type="checkbox" name="ibTo" value="' + r + '"> ' + c.esc(roleLabel(c, r)) + "</label> "; }).join("") +
      '<label><input type="checkbox" id="ibUrgent"> ' + c.esc(T(c, "site.inbasket.urgentBox", "Urgent: alert their phones now")) + "</label></fieldset>" +
      '<button class="btn primary" type="button" data-ib="new">' + c.esc(T(c, "site.inbasket.startThread", "Send")) + '</button><div id="ibNewOut" aria-live="polite"></div></div>' +
      '<div class="card"><h2>' + c.esc(T(c, "site.inbasket.waitingCard", "Waiting on you")) + '</h2><div id="ibPortal"></div><div id="ibReferrals"></div><div id="ibCosign"></div><div id="ibSafety"></div></div>';

    function loadThreads() {
      set("ibThreads", threadsHtml(c, null));
      c.api("/ward/staff-messages" + q + (S.view ? "&view=" + S.view : "")).then(function (r) {
        S.threads = r || { ok: false }; if (r && r.ok) S.me = r.me;
        set("ibThreads", threadsHtml(c, S.threads, S.open)); paintThread();
      });
    }
    function paintThread() {
      var t = S.threads && S.threads.ok && S.threads.threads.filter(function (x) { return x.threadId === S.open; })[0];
      if (t) set("ibThread", threadHtml(c, t, S.me));
    }
    function openThread(id) {
      S.open = S.open === id ? null : id;
      set("ibThreads", threadsHtml(c, S.threads, S.open)); paintThread();
      if (S.open) c.api("/ward/staff-message-read", { orgId: org, threadId: id }).then(function (r) { if (r && r.ok) { var t = S.threads.threads.filter(function (x) { return x.threadId === id; })[0]; if (t) t.unread = 0; } });
    }
    function after(r, out) {
      if (r && r.ok) { loadThreads(); return true; }
      if (out) set(out, failed(c, r)); else c.toast(T(c, "site.inbasket.notDone", "That did not go through. Nothing was changed.") + (r && (r.detail || r.error) ? " " + (r.detail || r.error) : ""));
      return false;
    }

    /* Waiting on you: each source on its own route and its own capability. */
    function loadWaiting() {
      set("ibPortal", sourceHtml(c, T(c, "site.inbasket.src.portal", "Patient messages"), null));
      set("ibReferrals", sourceHtml(c, T(c, "site.inbasket.src.referrals", "Referrals to answer"), null));
      set("ibCosign", sourceHtml(c, T(c, "site.inbasket.src.cosign", "Notes waiting for a signature"), null));
      set("ibSafety", sourceHtml(c, T(c, "site.inbasket.src.safety", "Safety inbox and critical results"), null));
      c.api("/ward/patient-messages" + q).then(function (r) {
        set("ibPortal", sourceHtml(c, T(c, "site.inbasket.src.portal", "Patient messages"), r || { ok: false }, function (x) { return (x.messages || []).map(function (m) { return { what: m.subject || m.patientId, hours: m.waitingHours, owner: null }; }); }, "portal-access"));
      });
      c.api("/ward/referral-inbox" + q).then(function (r) {
        set("ibReferrals", sourceHtml(c, T(c, "site.inbasket.src.referrals", "Referrals to answer"), r || { ok: false }, function (x) { return (x.referrals || []).map(function (f) { return { what: (f.specialty || "") + (f.urgency ? " (" + f.urgency + ")" : ""), hours: hoursSince(f.requestedAt), owner: f.specialty || null }; }); }, "ward:referralinbox"));
      });
      c.api("/ward/cosign-queue" + q).then(function (r) {
        set("ibCosign", sourceHtml(c, T(c, "site.inbasket.src.cosign", "Notes waiting for a signature"), r || { ok: false }, function (x) { return (x.notes || []).concat(x.mine || []).map(function (n) { return { what: (n.patientName || n.patientId || "") + (n.noteType ? ": " + n.noteType : ""), hours: hoursSince(n.submittedAt), owner: n.authorId === S.me ? null : n.authorId }; }); }, null));
      });
      c.api("/ward/safety-inbox" + q).then(function (r) {
        set("ibSafety", sourceHtml(c, T(c, "site.inbasket.src.safety", "Safety inbox and critical results"), r || { ok: false }, function (x) { return (x.items || []).map(function (i) { return { what: ((i.patient && (i.patient.name || i.patient.patientId)) || "") + ": " + (i.detail || i.type), hours: hoursSince(i.since), owner: (i.responsibleRole || "") || null }; }); }, "ward:safetyinbox"));
      });
    }

    c.api("/ward/list" + q).then(function (w) {
      var sel = document.getElementById("ibAbout"); if (!sel) return;
      if (!w || !w.ok) { set("ibNewOut", '<div class="msg err">' + TS(c, "site.inbasket.patientsFailed", "The ward list could not be loaded, so only unit threads can be started now.") + "</div>"); return; }
      (w.patients || []).forEach(function (p, ix) {
        S.patients.push(p);
        var o = document.createElement("option"); o.value = String(ix); o.textContent = (p.name || p.patientId) + (p.ward ? " - " + p.ward + (p.bed ? " " + p.bed : "") : ""); sel.appendChild(o);
      });
    });
    document.getElementById("ibView").onchange = function (e) { S.view = e.target.value; S.open = null; loadThreads(); };
    el.onclick = function (ev) {
      var g = ev.target.closest && ev.target.closest("[data-go]"); if (g) { c.go(g.getAttribute("data-go")); return; }
      var b = ev.target.closest && ev.target.closest("[data-ib]"); if (!b) return;
      var a = b.getAttribute("data-ib"), id = b.getAttribute("data-id");
      if (a === "refresh") { loadThreads(); loadWaiting(); return; }
      if (a === "open") { openThread(id); return; }
      if (a === "reply") {
        var text = val("ibReply"); if (!text) { c.toast(T(c, "site.inbasket.writeFirst", "Write the message first.")); return; }
        b.disabled = true;
        c.api("/ward/staff-message-send", { orgId: org, threadId: id, body: text }).then(function (r) { b.disabled = false; after(r); });
        return;
      }
      if (a === "edit") {
        var nb = ""; try { nb = prompt(T(c, "site.inbasket.editPrompt", "The corrected message. The earlier text is kept in the record.")) || ""; } catch (e) {}
        if (!nb.trim()) return;
        c.api("/ward/staff-message-edit", { orgId: org, messageId: id, body: nb.trim(), expectedVersion: Number(b.getAttribute("data-v")) }).then(function (r) { after(r); });
        return;
      }
      if (a === "recall") {
        var why = ""; try { why = prompt(T(c, "site.inbasket.recallPrompt", "Why are you recalling this message? It stays in the record; its text is hidden.")) || ""; } catch (e) {}
        if (!why.trim()) return;
        c.api("/ward/staff-message-recall", { orgId: org, messageId: id, reason: why.trim(), expectedVersion: Number(b.getAttribute("data-v")) }).then(function (r) { after(r); });
        return;
      }
      if (a === "escalate") {
        b.disabled = true;
        c.api("/ward/staff-message-escalate", { orgId: org, messageId: id }).then(function (r) {
          b.disabled = false;
          if (r && r.escalation) c.toast(escalationText(c, r.escalation));
          after(r);
        });
        return;
      }
      if (a === "new") {
        var ix = val("ibAbout"), p = ix === "" ? null : S.patients[Number(ix)];
        var body = { orgId: org, subject: val("ibSubject"), body: val("ibBody"), urgent: !!(document.getElementById("ibUrgent") || {}).checked,
          toRoles: [].slice.call(document.querySelectorAll('input[name="ibTo"]:checked')).map(function (x) { return x.value; }) };
        if (p) { body.patientId = p.patientId; if (p.encounterId) body.encounterId = p.encounterId; } else body.unit = val("ibUnit");
        if (!body.subject || !body.body) { c.toast(T(c, "site.inbasket.subjectAndMessage", "Write a subject and a message.")); return; }
        b.disabled = true;
        c.api("/ward/staff-message-send", body).then(function (r) {
          b.disabled = false;
          if (after(r, "ibNewOut")) {
            set("ibNewOut", '<div class="msg ok">' + TS(c, "site.inbasket.sent", "Sent.") + (r.escalation ? " " + c.esc(escalationText(c, r.escalation)) : "") + "</div>");
            ["ibSubject", "ibBody"].forEach(function (k) { var e = document.getElementById(k); if (e) e.value = ""; });
          }
        });
      }
    };
    loadThreads();
    loadWaiting();
  } });
  WSQ._inbasket = { threadsHtml: threadsHtml, threadHtml: threadHtml, sourceHtml: sourceHtml, escalationText: escalationText };
})();
