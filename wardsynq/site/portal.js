/* wardsynq/site/portal.js - the patient's (and an agreed family member's) own page. P2.9, D6.
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
 *
 * LANGUAGE (D6). Every patient-visible string here is a key resolved through tr(), so switching
 * languages redraws the whole page. Only two i18n files ever load: i18n.js (English, ours) and the
 * visitor's one chosen language (wardsynq/site/i18n/<code>.js, translated by Antigravity) - never all
 * nine, so an untranslated key falls back to English rather than showing a raw key. The switcher
 * remembers the choice in localStorage and only ever sets document.documentElement.lang.
 */
(function () {
  "use strict";
  var KEY = "wsqPortalSession";
  var LANG_KEY = "wsqPortalLang";
  // Cache token for wardsynq/site/i18n/<code>.js. Bump it (here, not in the language files) when translations merge.
  var LANG_FILES_V = 6;
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
    if (state === "failed") body = '<div class="msg err" role="alert">' + esc(tr("section.failed")) + "</div>";
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
      return '<li data-ticket-state="' + esc(t.state) + '"><b>' + esc(tr("status.state." + t.state)) + "</b>" + (t.token ? '<br><strong class="token" data-token="' + esc(t.token) + '">' + esc(tr("status.token", { token: t.token })) + "</strong>" : "") + "<br>" + esc(tr("status.where", { place: where })) +
        (t.ahead == null ? "" : "<br>" + esc(t.ahead === 0 ? tr("status.aheadNone") : t.ahead === 1 ? tr("status.aheadOne") : tr("status.ahead", { n: t.ahead })) +
          "<br>" + esc(isFinite(eta) ? tr("status.eta", { time: new Date(eta).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) }) : tr("status.noEta"))) + "</li>";
    }).join("") + "</ul>";
    return '<section class="card" aria-labelledby="h-status" data-section="status"><h2 id="h-status">' + esc(tr("status.title")) + "</h2>" + body +
      (q == null ? "" : '<button class="btn" type="button" data-act="queue">' + esc(tr("status.refresh")) + "</button>") + "</section>";
  }

  /** PURE. D5: a section withheld entry by entry. A withheld entry is one translated line in its place, never its words. */
  function summaryEntries(s) {
    var group = null;
    return s.items.map(function (it) {
      var head = it.group && it.group !== group ? "<h5>" + esc(tr("dc.group." + it.group)) + "</h5>" : "";
      if (it.group) group = it.group;
      return head + (it.withheld ? '<p class="msg note" data-withheld-entry="' + esc(s.key) + '">' + esc(tr("dc.entryWithheld")) + "</p>" : "<p>" + lines(it.text) + "</p>");
    }).join("");
  }

  /** PURE. One released discharge summary: the patient copy's three sections, or the full signed summary. */
  function dischargeItem(d) {
    if (d.scope === "full") {
      return '<article class="ds-full" data-ds="' + esc(d.id) + '"><h3>' + esc(tr("dc.full")) + "</h3>" + (d.sections || []).map(function (s) {
        return "<h4>" + esc(tr("dc.section." + s.key)) + "</h4>" +
          (s.withheld ? '<p class="msg note" data-withheld="' + esc(s.key) + '">' + esc(tr("dc.withheld")) + "</p>" : s.items ? summaryEntries(s) : "<p>" + lines(s.text) + "</p>");
      }).join("") + '<button class="btn noprint" type="button" data-act="print">' + esc(tr("dc.print")) + "</button></article>";
    }
    return (d.admission ? "<h3>" + esc(tr("dc.stay")) + "</h3><p>" + lines(d.admission) + "</p>" : "") +
      (d.medicines ? "<h3>" + esc(tr("dc.meds")) + "</h3><p>" + lines(d.medicines) + "</p>" : "") +
      (d.careInstructions ? "<h3>" + esc(tr("dc.care")) + "</h3><p>" + lines(d.careInstructions) + "</p>" : "");
  }

  /** PURE. One released document, or the line that says it has been taken back. */
  function documentItem(d) {
    if (d.unavailable) return '<span data-doc-state="' + esc(d.unavailable) + '">' + esc(tr(d.unavailable === "withdrawn" ? "docs.withdrawn" : "docs.unavailable")) + "</span>";
    var type = tr("docs.type." + d.docType);
    return "<b>" + esc(d.title) + "</b><br>" + esc(type.indexOf("docs.type.") === 0 ? d.docType : type) + ", " + esc(when(d.uploadedAt)) + ", " + esc(tr("docs.version", { n: d.version })) +
      '<br><button class="btn" type="button" data-act="doc" data-id="' + esc(d.documentId) + '" data-version="' + esc(d.version) + '">' + esc(tr("docs.download")) + '</button> <span class="quiet" aria-live="polite"></span>';
  }

  /** PURE. The discharge section. The staff Patient copy screen (ward.js) draws its preview with this too. */
  function dischargeSection(state, list) { return section("discharge", tr("dc.title"), state, list, dischargeItem, tr("dc.empty")); }

  /** PURE. The whole signed-in page from the server's answer. Only granted sections are drawn. */
  function renderRecord(r) {
    var access = r.access || { kind: "patient", sections: [] };
    var has = function (s) { return (access.sections || []).indexOf(s) >= 0; };
    var failed = function (s) { return (r.failedSections || []).indexOf(s) >= 0 ? "failed" : "ok"; };
    var doc = r.document || {};
    var out = [];
    var who = doc.patient && doc.patient.name ? doc.patient.name : "";
    var title = access.kind === "proxy" ? tr("portal.title.proxy", { name: who || tr("portal.thePatient") }) : tr("portal.title.yours");
    out.push('<div class="title"><h1>' + esc(title) + "</h1></div>");
    if (access.kind === "proxy") out.push('<div class="msg note">' + esc(tr("portal.proxyNote", { relationship: access.relationship || tr("portal.familyMember") })) + "</div>");
    if (r.statements && r.statements.length && (has("results") || has("diagnoses"))) out.push('<div class="msg note">' + r.statements.map(esc).join("<br>") + "</div>");
    if (has("status")) out.push(statusSection(r.queue));

    if (has("appointments")) {
      out.push(section("appointments", tr("appt.title"), "ok", doc.appointments, function (a) {
        return "<b>" + esc(when(a.at) || tr("appt.tbc")) + "</b>" + (a.with ? " " + esc(tr("appt.with", { who: a.with })) : "") + (a.kind ? " (" + esc(a.kind) + ")" : "");
      }, tr("appt.empty")));
      out.push('<section class="card" data-section="appointment-request"><h2>' + esc(tr("appt.ask")) + '</h2><p class="quiet">' + esc(tr("appt.askNote")) + "</p>" +
        '<label class="f"><span>' + esc(tr("appt.reason")) + '</span><input id="pApptReason" maxlength="300"></label>' +
        '<label class="f"><span>' + esc(tr("appt.pref")) + '</span><input id="pApptPref" maxlength="200"></label>' +
        '<button class="btn primary" type="button" data-act="appt">' + esc(tr("appt.send")) + '</button><div id="pApptMsg" aria-live="polite"></div></section>');
    }
    if (has("medicines")) out.push(section("medicines", tr("meds.title"), "ok", doc.medicines, function (m) {
      return "<b>" + esc(m.drug) + "</b>" + [m.dose, m.route, m.frequency].filter(Boolean).map(function (x) { return " " + esc(typeof x === "object" ? (x.value + " " + x.unit) : x); }).join(",") + (m.note ? "<br>" + esc(m.note) : "");
    }, tr("meds.empty")));
    if (has("results")) {
      out.push(section("results", tr("results.title"), "ok", doc.results, function (x) {
        return "<b>" + esc(x.name) + "</b> " + esc(when(x.reportedAt)) + (x.conclusion ? "<br>" + esc(x.conclusion) : "");
      }, tr("results.empty")));
      if (doc.withheldResults && doc.withheldResults.length) out.push('<div class="msg note">' + doc.withheldResults.map(function (w) { return esc(w.say); }).join("<br>") + "</div>");
    }
    if (has("diagnoses")) {
      out.push(section("diagnoses", tr("dx.title"), "ok", doc.diagnoses, function (d) { return "<b>" + esc(d.display) + "</b>" + (d.note ? "<br>" + esc(d.note) : ""); }, tr("dx.empty")));
      out.push(section("allergies", tr("allergy.title"), "ok", doc.allergies, function (a) { return "<b>" + esc(a.substance) + "</b>" + (a.reaction ? ": " + esc(a.reaction) : ""); }, tr("allergy.empty")));
    }
    if (has("discharge") || has("discharge-full")) out.push(dischargeSection(failed("discharge"), r.dischargeSummaries));
    if (has("documents")) out.push(section("documents", tr("docs.title"), failed("documents"), r.documents, documentItem, tr("docs.empty")));
    if (has("bills")) out.push(section("bills", tr("bills.title"), failed("bills"), r.bills, function (b) {
      var state = b.status === "void" ? tr("bills.cancelled") : b.status === "paid" ? tr("bills.paid") : tr("bills.due", { amount: money(b.balance, b.currency) });
      return "<b>" + esc(state) + "</b><br>" + esc(tr("bills.summary", { charged: money(b.charged, b.currency), paid: money(b.paid, b.currency) })) +
        '<ul class="sub">' + (b.lines || []).map(function (l) { return "<li>" + esc(l.item) + " x" + esc(l.quantity) + ": " + money(l.amount, b.currency) + "</li>"; }).join("") + "</ul>";
    }, tr("bills.empty")));
    if (has("consents")) out.push(section("consents", tr("consents.title"), failed("consents"), r.consents, function (c) {
      return "<b>" + esc(c.scopeLabel) + "</b>: " + esc(c.status) + (c.detail ? "<br>" + esc(c.detail) : "") +
        (c.canWithdraw ? '<br><button class="btn danger" type="button" data-act="withdraw" data-id="' + esc(c.consentId) + '">' + esc(tr("consents.withdraw")) + "</button>"
          : c.status === "granted" && access.kind === "patient" ? '<br><span class="quiet">' + esc(tr("consents.speak")) + "</span>" : "");
    }, tr("consents.empty")));
    if (has("messages")) {
      out.push('<section class="card" data-section="messages"><h2>' + esc(tr("msg.title")) + '</h2>' +
        '<div class="msg err" role="note"><b>' + esc(r.notEmergency || tr("msg.notEmergency")) + "</b></div>" +
        '<label class="f"><span>' + esc(tr("msg.label")) + '</span><textarea id="pMsgBody" rows="4" maxlength="2000"></textarea></label>' +
        '<button class="btn primary" type="button" data-act="message">' + esc(tr("msg.send")) + '</button><div id="pMsgMsg" aria-live="polite"></div>' +
        (r.messages && r.messages.length ? '<ul class="plist">' + r.messages.map(function (m) {
          return "<li><span class=\"quiet\">" + esc(when(m.sentAt)) + "</span><br>" + esc(m.body) +
            (m.reply ? '<div class="msg ok">' + esc(tr("msg.reply", { when: when(m.answeredAt) })) + " " + esc(m.reply) + "</div>" : '<div class="quiet">' + esc(tr("msg.unanswered")) + "</div>") + "</li>";
        }).join("") + "</ul>" : '<p class="quiet" data-empty="messages">' + esc(tr("msg.empty")) + "</p>") + "</section>");
    }
    return out.join("");
  }

  /** PURE. The screen for each phase. */
  function renderPhase(p) {
    if (p.phase === "loading") return '<div class="card" role="status" data-phase="loading"><span class="spin"></span> ' + esc(tr("phase.loading")) + "</div>";
    if (p.phase === "failed") return '<div class="card" role="alert" data-phase="failed"><div class="msg err">' + esc(tr("phase.failed")) + '</div><button class="btn" type="button" data-act="retry">' + esc(tr("phase.retry")) + "</button></div>";
    if (p.phase === "ended") return '<div class="card" role="alert" data-phase="ended"><div class="msg err">' + esc(p.detail || tr("phase.ended")) + "</div><p>" + esc(tr("phase.newCode")) + '</p><button class="btn" type="button" data-act="signout">' + esc(tr("phase.startAgain")) + "</button></div>";
    if (p.phase === "ready") return '<div data-phase="ready">' + renderRecord(p.data) + '<p><button class="btn quiet" type="button" data-act="signout">' + esc(tr("signout")) + "</button></p></div>";
    return '<form class="card" id="pSignin" data-phase="signin" autocomplete="off"><h1>' + esc(tr("signin.title")) + "</h1>" +
      "<p>" + esc(tr("signin.intro")) + "</p>" +
      '<label class="f"><span>' + esc(tr("signin.hospital")) + '</span><input id="pOrg" required value="' + esc(p.orgId || "") + '"></label>' +
      '<label class="f"><span>' + esc(tr("signin.access")) + '</span><input id="pGrant" required autocapitalize="off" spellcheck="false"></label>' +
      '<label class="f"><span>' + esc(tr("signin.code")) + '</span><input id="pCode" required inputmode="numeric" autocomplete="one-time-code"></label>' +
      '<button class="btn primary" type="submit">' + esc(tr("signin.submit")) + '</button><div id="pSigninMsg" aria-live="polite">' + (p.error ? '<div class="msg err">' + esc(p.error) + "</div>" : "") + "</div></form>";
  }

  var api = {
    esc: esc, section: section, renderRecord: renderRecord, renderPhase: renderPhase, statusSection: statusSection, dischargeItem: dischargeItem, dischargeSection: dischargeSection, documentItem: documentItem
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

  /* Language switch (D6). Only i18n.js (English) is loaded by portal.html; a chosen non-English file
   * is fetched once, on demand, and cached in loadedLangs so re-picking it is free. */
  function loadLang() { try { return localStorage.getItem(LANG_KEY) || "en"; } catch (e) { return "en"; } }
  function saveLang(code) { try { localStorage.setItem(LANG_KEY, code); } catch (e) {} }
  var loadedLangs = { en: true };
  function ensureLangLoaded(code, cb) {
    if (loadedLangs[code]) return cb();
    // The code comes from localStorage or the switcher: only an offered language names a file.
    if (!window.WSQI18n || !window.WSQI18n.offered(code)) return cb();
    var el = document.createElement("script");
    el.src = "/wardsynq/site/i18n/" + code + ".js?v=" + LANG_FILES_V;
    el.onload = el.onerror = function () { loadedLangs[code] = true; cb(); };
    document.head.appendChild(el);
  }
  function langSwitcher() {
    var cur = document.documentElement.lang || "en";
    var langs = window.WSQI18n ? window.WSQI18n.languages() : [{ code: "en", name: "English" }];
    var opts = langs.map(function (l) { return '<option value="' + esc(l.code) + '"' + (l.code === cur ? " selected" : "") + ">" + esc(l.name) + "</option>"; }).join("");
    return '<div class="lang-switch"><label class="sr-only" for="pLang">' + esc(tr("lang.label")) + '</label><select id="pLang">' + opts + "</select></div>";
  }

  var lastPhase = null;
  function show(p) {
    lastPhase = p;
    root.innerHTML = langSwitcher() + renderPhase(p);
    var h = root.querySelector("h1"); if (h) { h.setAttribute("tabindex", "-1"); }
  }

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
    document.getElementById("pSigninMsg").innerHTML = '<span class="spin"></span> ' + esc(tr("signin.checking"));
    post("redeem", { orgId: orgId, grantId: grantId, code: code }).then(function (r) {
      if (r && r.ok && r.token) { save({ orgId: orgId, grantId: grantId, token: r.token }); return refresh(); }
      show({ phase: "signin", orgId: orgId, error: (r && r.detail) || tr("signin.invalid") });
    }, function () { show({ phase: "signin", orgId: orgId, error: tr("signin.unreachable") }); });
  });

  root.addEventListener("change", function (ev) {
    if (ev.target.id !== "pLang") return;
    var code = ev.target.value;
    saveLang(code);
    ensureLangLoaded(code, function () { document.documentElement.lang = code; show(lastPhase || { phase: "loading" }); });
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
      el.innerHTML = '<div class="msg ' + (r && r.ok ? "ok" : "err") + '">' + esc(r && r.ok ? okText : ((r && r.detail) || tr("action.failed"))) + "</div>";
    }
    b.disabled = true;
    if (act === "message") {
      var body = document.getElementById("pMsgBody").value.trim();
      if (!body) { b.disabled = false; return say("pMsgMsg", { ok: false, detail: tr("msg.writeFirst") }); }
      return post("message", { orgId: s.orgId, grantId: s.grantId, token: s.token, body: body }).then(function (r) { b.disabled = false; say("pMsgMsg", r, r.note || tr("msg.sent")); if (r && r.ok) setTimeout(refresh, 1200); }, function () { b.disabled = false; say("pMsgMsg", null); });
    }
    if (act === "appt") {
      return post("appointment-request", { orgId: s.orgId, grantId: s.grantId, token: s.token, reason: document.getElementById("pApptReason").value.trim(), preference: document.getElementById("pApptPref").value.trim() })
        .then(function (r) { b.disabled = false; say("pApptMsg", r, r.note || tr("appt.sent")); }, function () { b.disabled = false; say("pApptMsg", null); });
    }
    if (act === "withdraw") {
      if (!confirm(tr("consents.confirm"))) { b.disabled = false; return; }
      return post("consent-withdraw", { orgId: s.orgId, grantId: s.grantId, token: s.token, consentId: b.getAttribute("data-id") })
        .then(function (r) { if (r && r.ok) return refresh(); b.disabled = false; alert((r && r.detail) || tr("action.failedShort")); }, function () { b.disabled = false; alert(tr("action.failedShort")); });
    }
  });

  var savedLang = window.WSQI18n && window.WSQI18n.offered(loadLang()) ? loadLang() : "en";
  ensureLangLoaded(savedLang, function () { document.documentElement.lang = savedLang; refresh(); });
})();
