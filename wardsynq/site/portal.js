/* wardsynq/site/portal.js - the patient's (and an agreed family member's) own page. P2.9.
 *
 * NOT A STAFF PAGE. It loads no staff session, no Firebase, no shell.js, and calls only /api/portal/*,
 * which verifies the access code or session on the server for every request and takes the patient
 * from the grant. What this page draws is never the security boundary: a section a proxy was not
 * granted never arrives here at all.
 *
 * NO PHI IN THE ADDRESS. The session lives in sessionStorage (gone when the tab closes) and every call
 * is a POST with the session in the body. The only thing the address may carry is #org=<hospital id>,
 * which names a hospital, not a person.
 *
 * LOADING, FAILED AND EMPTY ARE THREE DIFFERENT SCREENS. "We could not load your bills" must never
 * look like "you have no bills": a patient who reads a failure as "nothing owed" or "no results" has
 * been told something false.
 *
 * P2 GAPS: queue status, released documents and the full discharge summary. Their words come from
 * i18n.js (loaded first by portal.html); queue status and withheld text carry a fourth state each, "ask
 * at the desk" and "withheld until your care team discusses it", which is neither empty nor failed.
 */
(function () {
  "use strict";
  var KEY = "wsqPortalSession";
  function tr(key, vars) {
    var I = typeof window !== "undefined" && window.WSQI18n, lang = "en";
    try { lang = document.documentElement.lang || "en"; } catch (e) {}
    return I ? I.t(key, vars, lang) : key;
  }

  function esc(s) { return String(s == null ? "" : s).replace(/[&<>"']/g, function (c) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]; }); }
  function when(iso) { var t = Date.parse(iso || ""); return isFinite(t) ? new Date(t).toLocaleString() : ""; }
  function money(n, cur) { var v = Number(n || 0); return (cur ? esc(cur) + " " : "") + v.toFixed(2); }
  function lines(text) { return esc(text).replace(/\n/g, "<br>"); }

  /** PURE. One section: failed, empty and filled are always distinct. */
  function section(id, title, state, items, renderItem, emptyText) {
    var body;
    if (state === "failed") body = '<div class="msg err" role="alert">We could not load this part of your record. This does not mean there is nothing here. Try again later.</div>';
    else if (!items || !items.length) body = '<p class="quiet" data-empty="' + esc(id) + '">' + esc(emptyText) + "</p>";
    else body = '<ul class="plist">' + items.map(function (x) { return "<li>" + renderItem(x) + "</li>"; }).join("") + "</ul>";
    return '<section class="card" aria-labelledby="h-' + esc(id) + '" data-section="' + esc(id) + '"><h2 id="h-' + esc(id) + '">' + esc(title) + "</h2>" + body + "</section>";
  }

  /** PURE. Queue status. q: undefined/null = loading, false = failed, else the /api/portal/queue answer. */
  function statusSection(q) {
    var body;
    if (q == null) body = '<p role="status" data-state="loading"><span class="spin"></span> ' + esc(tr("status.loading")) + "</p>";
    else if (q === false) body = '<div class="msg err" role="alert" data-state="failed">' + esc(tr("status.failed")) + "</div>";
    else if (!q.available) body = '<p class="quiet" data-state="off">' + esc(tr("status.off")) + "</p>";
    /* Not "empty": the queue may well hold this patient, it just cannot prove which entry is theirs. */
    else if (q.ambiguous) body = '<div class="msg note" data-state="ambiguous">' + esc(tr("status.ambiguous")) + "</div>";
    else if (!q.tickets || !q.tickets.length) body = '<p class="quiet" data-empty="status">' + esc(tr("status.empty")) + "</p>";
    else body = '<ul class="plist">' + q.tickets.map(function (t) {
      var where = t.desk ? tr("status.desk") : (t.label || tr("status.opd"));
      var eta = Date.parse(t.eta || "");
      return '<li data-ticket-state="' + esc(t.state) + '"><b>' + esc(tr("status.state." + t.state)) + "</b><br>" + esc(tr("status.where", { place: where })) +
        (t.ahead == null ? "" : "<br>" + esc(t.ahead === 0 ? tr("status.aheadNone") : t.ahead === 1 ? tr("status.aheadOne") : tr("status.ahead", { n: t.ahead })) +
          "<br>" + esc(isFinite(eta) ? tr("status.eta", { time: new Date(eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : tr("status.noEta"))) + "</li>";
    }).join("") + "</ul>";
    return '<section class="card" aria-labelledby="h-status" data-section="status"><h2 id="h-status">' + esc(tr("status.title")) + "</h2>" + body +
      (q == null ? "" : '<button class="btn" type="button" data-act="queue">' + esc(tr("status.refresh")) + "</button>") + "</section>";
  }

  /** PURE. One released discharge summary: the patient copy's three sections, or the full signed summary. */
  function dischargeItem(d) {
    if (d.scope === "full") {
      return '<article class="ds-full" data-ds="' + esc(d.id) + '"><h3>' + esc(tr("dc.full")) + "</h3>" + (d.sections || []).map(function (s) {
        return "<h4>" + esc(tr("dc.section." + s.key)) + "</h4>" +
          (s.withheld ? '<p class="msg note" data-withheld="' + esc(s.key) + '">' + esc(tr("dc.withheld")) + "</p>" : "<p>" + lines(s.text) + "</p>");
      }).join("") + '<button class="btn noprint" type="button" data-act="print">' + esc(tr("dc.print")) + "</button></article>";
    }
    return (d.admission ? "<h3>Your stay</h3><p>" + lines(d.admission) + "</p>" : "") +
      (d.medicines ? "<h3>Medicines</h3><p>" + lines(d.medicines) + "</p>" : "") +
      (d.careInstructions ? "<h3>Care instructions</h3><p>" + lines(d.careInstructions) + "</p>" : "");
  }

  /** PURE. One released document, or the line that says it has been taken back. */
  function documentItem(d) {
    if (d.unavailable) return '<span data-doc-state="' + esc(d.unavailable) + '">' + esc(tr(d.unavailable === "withdrawn" ? "docs.withdrawn" : "docs.unavailable")) + "</span>";
    var type = tr("docs.type." + d.docType);
    return "<b>" + esc(d.title) + "</b><br>" + esc(type.indexOf("docs.type.") === 0 ? d.docType : type) + ", " + esc(when(d.uploadedAt)) + ", " + esc(tr("docs.version", { n: d.version })) +
      '<br><button class="btn" type="button" data-act="doc" data-id="' + esc(d.documentId) + '" data-version="' + esc(d.version) + '">' + esc(tr("docs.download")) + '</button> <span class="quiet" aria-live="polite"></span>';
  }

  /** PURE. The whole signed-in page from the server's answer. Only granted sections are drawn. */
  function renderRecord(r) {
    var access = r.access || { kind: "patient", sections: [] };
    var has = function (s) { return (access.sections || []).indexOf(s) >= 0; };
    var failed = function (s) { return (r.failedSections || []).indexOf(s) >= 0 ? "failed" : "ok"; };
    var doc = r.document || {};
    var out = [];
    var who = doc.patient && doc.patient.name ? doc.patient.name : "";
    out.push('<div class="title"><h1>' + (access.kind === "proxy" ? "Record of " + esc(who || "the patient") : "Your record") + "</h1></div>");
    if (access.kind === "proxy") out.push('<div class="msg note">You are viewing as ' + esc(access.relationship || "a family member") + ", with the patient's agreement. You can see only what they agreed to share.</div>");
    if (r.statements && r.statements.length && (has("results") || has("diagnoses"))) out.push('<div class="msg note">' + r.statements.map(esc).join("<br>") + "</div>");
    if (has("status")) out.push(statusSection(r.queue));

    if (has("appointments")) {
      out.push(section("appointments", "Appointments", "ok", doc.appointments, function (a) {
        return "<b>" + esc(when(a.at) || "Time to be confirmed") + "</b>" + (a.with ? " with " + esc(a.with) : "") + (a.kind ? " (" + esc(a.kind) + ")" : "");
      }, "No appointments are booked."));
      out.push('<section class="card" data-section="appointment-request"><h2>Ask for an appointment</h2><p class="quiet">This sends a request. Nothing is booked until the hospital contacts you.</p>' +
        '<label class="f"><span>What is it for?</span><input id="pApptReason" maxlength="300"></label>' +
        '<label class="f"><span>Days or times that suit you (optional)</span><input id="pApptPref" maxlength="200"></label>' +
        '<button class="btn primary" type="button" data-act="appt">Send request</button><div id="pApptMsg" aria-live="polite"></div></section>');
    }
    if (has("medicines")) out.push(section("medicines", "Prescriptions and medicines", "ok", doc.medicines, function (m) {
      return "<b>" + esc(m.drug) + "</b>" + [m.dose, m.route, m.frequency].filter(Boolean).map(function (x) { return " " + esc(typeof x === "object" ? (x.value + " " + x.unit) : x); }).join(",") + (m.note ? "<br>" + esc(m.note) : "");
    }, "No current medicines are listed."));
    if (has("results")) {
      out.push(section("results", "Lab and radiology results", "ok", doc.results, function (x) {
        return "<b>" + esc(x.name) + "</b> " + esc(when(x.reportedAt)) + (x.conclusion ? "<br>" + esc(x.conclusion) : "");
      }, "No results have been shared with you yet."));
      if (doc.withheldResults && doc.withheldResults.length) out.push('<div class="msg note">' + doc.withheldResults.map(function (w) { return esc(w.say); }).join("<br>") + "</div>");
    }
    if (has("diagnoses")) {
      out.push(section("diagnoses", "Diagnoses", "ok", doc.diagnoses, function (d) { return "<b>" + esc(d.display) + "</b>" + (d.note ? "<br>" + esc(d.note) : ""); }, "No diagnoses are listed."));
      out.push(section("allergies", "Allergies", "ok", doc.allergies, function (a) { return "<b>" + esc(a.substance) + "</b>" + (a.reaction ? ": " + esc(a.reaction) : ""); }, "No allergies are recorded."));
    }
    if (has("discharge") || has("discharge-full")) out.push(section("discharge", "Discharge summaries and care instructions", failed("discharge"), r.dischargeSummaries, dischargeItem, "No discharge summary has been shared with you."));
    if (has("documents")) out.push(section("documents", tr("docs.title"), failed("documents"), r.documents, documentItem, tr("docs.empty")));
    if (has("bills")) out.push(section("bills", "Bills and payments", failed("bills"), r.bills, function (b) {
      var state = b.status === "void" ? "Cancelled" : b.status === "paid" ? "Paid" : "Balance due " + money(b.balance, b.currency);
      return "<b>" + esc(state) + "</b><br>Charged " + money(b.charged, b.currency) + ", paid " + money(b.paid, b.currency) +
        '<ul class="sub">' + (b.lines || []).map(function (l) { return "<li>" + esc(l.item) + " x" + esc(l.quantity) + ": " + money(l.amount, b.currency) + "</li>"; }).join("") + "</ul>";
    }, "You have no bills."));
    if (has("consents")) out.push(section("consents", "Consents", failed("consents"), r.consents, function (c) {
      return "<b>" + esc(c.scopeLabel) + "</b>: " + esc(c.status) + (c.detail ? "<br>" + esc(c.detail) : "") +
        (c.canWithdraw ? '<br><button class="btn danger" type="button" data-act="withdraw" data-id="' + esc(c.consentId) + '">Withdraw this consent</button>'
          : c.status === "granted" && access.kind === "patient" ? '<br><span class="quiet">To withdraw this, speak to your care team.</span>' : "");
    }, "No consents are recorded."));
    if (has("messages")) {
      out.push('<section class="card" data-section="messages"><h2>Messages to your care team</h2>' +
        '<div class="msg err" role="note"><b>' + esc(r.notEmergency || "This is not a way to get urgent help.") + "</b></div>" +
        '<label class="f"><span>Your message</span><textarea id="pMsgBody" rows="4" maxlength="2000"></textarea></label>' +
        '<button class="btn primary" type="button" data-act="message">Send message</button><div id="pMsgMsg" aria-live="polite"></div>' +
        (r.messages && r.messages.length ? '<ul class="plist">' + r.messages.map(function (m) {
          return "<li><span class=\"quiet\">" + esc(when(m.sentAt)) + "</span><br>" + esc(m.body) +
            (m.reply ? '<div class="msg ok">Reply ' + esc(when(m.answeredAt)) + ": " + esc(m.reply) + "</div>" : '<div class="quiet">Not answered yet.</div>') + "</li>";
        }).join("") + "</ul>" : '<p class="quiet" data-empty="messages">You have not sent any messages.</p>') + "</section>");
    }
    return out.join("");
  }

  /** PURE. The screen for each phase. */
  function renderPhase(p) {
    if (p.phase === "loading") return '<div class="card" role="status" data-phase="loading"><span class="spin"></span> Loading your record...</div>';
    if (p.phase === "failed") return '<div class="card" role="alert" data-phase="failed"><div class="msg err">We could not load your record. This is a connection or server problem, not an empty record.</div><button class="btn" type="button" data-act="retry">Try again</button></div>';
    if (p.phase === "ended") return '<div class="card" role="alert" data-phase="ended"><div class="msg err">' + esc(p.detail || "Your session has ended.") + '</div><p>Ask your care team for a new code.</p><button class="btn" type="button" data-act="signout">Start again</button></div>';
    if (p.phase === "ready") return '<div data-phase="ready">' + renderRecord(p.data) + '<p><button class="btn quiet" type="button" data-act="signout">Sign out</button></p></div>';
    return '<form class="card" id="pSignin" data-phase="signin" autocomplete="off"><h1>Sign in to your record</h1>' +
      "<p>Use the access ID and code your care team gave you in person. The code works once.</p>" +
      '<label class="f"><span>Hospital ID</span><input id="pOrg" required value="' + esc(p.orgId || "") + '"></label>' +
      '<label class="f"><span>Access ID</span><input id="pGrant" required autocapitalize="off" spellcheck="false"></label>' +
      '<label class="f"><span>Code</span><input id="pCode" required inputmode="numeric" autocomplete="one-time-code"></label>' +
      '<button class="btn primary" type="submit">Sign in</button><div id="pSigninMsg" aria-live="polite">' + (p.error ? '<div class="msg err">' + esc(p.error) + "</div>" : "") + "</div></form>";
  }

  var api = {
    esc: esc, section: section, renderRecord: renderRecord, renderPhase: renderPhase, statusSection: statusSection, dischargeItem: dischargeItem, documentItem: documentItem
  };
  if (typeof window !== "undefined") window.WSQPortal = api;
  if (typeof document === "undefined" || !document.getElementById("portal")) return;

  var root = document.getElementById("portal");
  function load() { try { return JSON.parse(sessionStorage.getItem(KEY) || "null"); } catch (e) { return null; } }
  function save(s) { try { if (s) sessionStorage.setItem(KEY, JSON.stringify(s)); else sessionStorage.removeItem(KEY); } catch (e) {} }
  function post(sub, body) {
    return fetch("/api/portal/" + sub, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body), credentials: "omit" })
      .then(function (res) { return res.json().then(function (j) { j.httpStatus = res.status; return j; }, function () { return { ok: false, httpStatus: res.status }; }); });
  }
  function orgFromHash() { var m = /(?:^|[#&])org=([^&]+)/.exec(location.hash || ""); return m ? decodeURIComponent(m[1]) : ""; }
  function show(p) { root.innerHTML = renderPhase(p); var h = root.querySelector("h1"); if (h) { h.setAttribute("tabindex", "-1"); } }

  function refresh() {
    var s = load();
    if (!s) return show({ phase: "signin", orgId: orgFromHash() });
    show({ phase: "loading" });
    post("record", s).then(function (r) {
      if (r && r.ok) { show({ phase: "ready", data: r }); if (r.access && (r.access.sections || []).indexOf("status") >= 0) loadQueue(s); return; }
      if (r && r.httpStatus === 401) { save(null); return show({ phase: "ended", detail: r.detail }); }
      show({ phase: "failed" });
    }, function () { show({ phase: "failed" }); });
  }

  /* Queue status loads after the record and redraws only its own section, so a message being typed
   * is never wiped by it. */
  function loadQueue(s) {
    var put = function (q) { var el = root.querySelector('[data-section="status"]'); if (el) el.outerHTML = statusSection(q); };
    put(null);
    post("queue", { orgId: s.orgId, grantId: s.grantId, token: s.token }).then(function (q) {
      if (q && q.httpStatus === 401) { save(null); return show({ phase: "ended", detail: q.detail }); }
      put(q && q.ok ? q : false);
    }, function () { put(false); });
  }

  /* The bytes come back in the response and are saved from a local object URL: the page never holds an
   * address for the stored file. A document withdrawn since the page loaded redraws the page without it. */
  function downloadDocument(s, b) {
    var note = b.nextElementSibling;
    var body = JSON.stringify({ orgId: s.orgId, grantId: s.grantId, token: s.token, documentId: b.getAttribute("data-id"), version: Number(b.getAttribute("data-version")) });
    var fail = function () { b.disabled = false; if (note) note.textContent = tr("docs.failed"); };
    if (note) note.textContent = tr("docs.downloading");
    fetch("/api/portal/document", { method: "POST", headers: { "Content-Type": "application/json" }, body: body, credentials: "omit" }).then(function (res) {
      var type = res.headers.get("Content-Type") || "";
      if (res.ok && type.indexOf("application/json") < 0) {
        return res.blob().then(function (blob) {
          var url = URL.createObjectURL(blob), a = document.createElement("a");
          var named = /filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") || "");
          a.href = url; a.download = named ? named[1] : "document";
          document.body.appendChild(a); a.click(); a.parentNode.removeChild(a);
          setTimeout(function () { URL.revokeObjectURL(url); }, 30000);
          b.disabled = false; if (note) note.textContent = "";
        }, fail);
      }
      return res.json().then(null, function () { return {}; }).then(function (j) {
        if (res.status === 401) { save(null); return show({ phase: "ended", detail: j.detail }); }
        if (res.status === 404 || res.status === 410) return refresh();
        fail();
      });
    }, fail);
  }

  function printSummary(b) {
    var article = b.closest(".ds-full"); if (!article) return;
    var done = function () { article.classList.remove("printing"); document.body.classList.remove("printing"); };
    article.classList.add("printing"); document.body.classList.add("printing");
    window.onafterprint = done;
    window.print();
  }

  root.addEventListener("submit", function (ev) {
    if (ev.target.id !== "pSignin") return;
    ev.preventDefault();
    var orgId = document.getElementById("pOrg").value.trim(), grantId = document.getElementById("pGrant").value.trim(), code = document.getElementById("pCode").value.trim();
    document.getElementById("pSigninMsg").innerHTML = '<span class="spin"></span> Checking...';
    post("redeem", { orgId: orgId, grantId: grantId, code: code }).then(function (r) {
      if (r && r.ok && r.token) { save({ orgId: orgId, grantId: grantId, token: r.token }); return refresh(); }
      show({ phase: "signin", orgId: orgId, error: (r && r.detail) || "That code is not valid." });
    }, function () { show({ phase: "signin", orgId: orgId, error: "We could not reach the hospital. Check your connection and try again." }); });
  });

  root.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-act]"); if (!b) return;
    var act = b.getAttribute("data-act"), s = load();
    if (act === "retry") return refresh();
    if (act === "signout") { save(null); return refresh(); }
    if (act === "print") return printSummary(b);
    if (!s) return refresh();
    if (act === "queue") return loadQueue(s);
    if (act === "doc") { b.disabled = true; return downloadDocument(s, b); }
    function say(id, r, okText) {
      var el = document.getElementById(id); if (!el) return;
      el.innerHTML = '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + esc(r && r.ok ? okText : ((r && r.detail) || "That did not go through. Nothing was sent.")) + "</div>";
    }
    b.disabled = true;
    if (act === "message") {
      var body = document.getElementById("pMsgBody").value.trim();
      if (!body) { b.disabled = false; return say("pMsgMsg", { ok: false, detail: "Write a message first." }); }
      return post("message", { orgId: s.orgId, grantId: s.grantId, token: s.token, body: body }).then(function (r) { b.disabled = false; say("pMsgMsg", r, r.note || "Sent."); if (r && r.ok) setTimeout(refresh, 1200); }, function () { b.disabled = false; say("pMsgMsg", null); });
    }
    if (act === "appt") {
      return post("appointment-request", { orgId: s.orgId, grantId: s.grantId, token: s.token, reason: document.getElementById("pApptReason").value.trim(), preference: document.getElementById("pApptPref").value.trim() })
        .then(function (r) { b.disabled = false; say("pApptMsg", r, r.note || "Request sent."); }, function () { b.disabled = false; say("pApptMsg", null); });
    }
    if (act === "withdraw") {
      if (!confirm("Withdraw this consent from now? Your care team will see this.")) { b.disabled = false; return; }
      return post("consent-withdraw", { orgId: s.orgId, grantId: s.grantId, token: s.token, consentId: b.getAttribute("data-id") })
        .then(function (r) { if (r && r.ok) return refresh(); b.disabled = false; alert((r && r.detail) || "That did not go through."); }, function () { b.disabled = false; alert("That did not go through."); });
    }
  });

  refresh();
})();
