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
  var LANG_FILES_V = 29;
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

  /* R6-2: a chart section the server could not read arrives as null, never as []. "failed" draws the
   * section's own could-not-be-read line; an empty list still draws "nothing recorded". A patient
   * reading "no allergies are recorded" off a read that failed is the whole reason for the split. */
  function unread(v) { return v === null ? "failed" : "ok"; }

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

  /** PURE. DPDP Act 2023: the hospital's privacy notice, the patient's acknowledgement of it and their own requests about
   * their data. p: null = loading, false = failed, else the /api/portal/privacy answer. The notice is the hospital's own
   * text in the language it was written in, shown as written. A proxy reads it and cannot act on the patient's behalf. */
  function privacySection(p) {
    var body;
    if (p == null) body = '<p role="status" data-state="loading"><span class="spin"></span> ' + esc(tr("privacy.loading")) + "</p>";
    else if (p === false) body = '<div class="msg err" role="alert" data-state="failed">' + esc(tr("privacy.failed")) + "</div>";
    else {
      var n = p.notice;
      /* The itemised parts the notice must carry (DPDP Rules 2025 r.3; SPDI Rules 2011 r.5(3)), as the hospital wrote them. */
      var parts = ["dataItems", "purposes", "withdrawConsent", "rights", "recipients", "collectingAgency", "boardComplaint"].filter(function (k) { return n && n[k]; });
      body = n ? '<article class="privacy-notice">' + (n.title ? "<h3>" + esc(n.title) + "</h3>" : "") + (n.text ? '<p style="white-space:pre-wrap">' + esc(n.text) + "</p>" : "") +
          parts.map(function (k) { return "<p><b>" + esc(tr("privacy.part." + k)) + '</b><br><span style="white-space:pre-wrap">' + esc(n[k]) + "</span></p>"; }).join("") +
          "<p><b>" + esc(tr("privacy.dpo")) + "</b> " + esc(n.dpoContact) + (n.grievanceContact ? "<br><b>" + esc(tr("privacy.grievance")) + "</b> " + esc(n.grievanceContact) : "") + "</p></article>" +
          (p.acknowledged ? '<p class="quiet" data-state="acknowledged">' + esc(tr("privacy.acknowledged")) + "</p>"
            : !p.proxy ? '<button class="btn" type="button" data-act="privacy-ack" data-lang="' + esc(n.language) + '">' + esc(tr("privacy.acknowledge")) + "</button>" : "")
        : '<p class="quiet" data-empty="privacy">' + esc(tr("privacy.none")) + "</p>";
      if (p.proxy) body += '<p class="quiet">' + esc(tr("privacy.proxy")) + "</p>";
      else body += "<h3>" + esc(tr("privacy.ask")) + "</h3>" +
        '<label class="f"><span>' + esc(tr("privacy.kind")) + '</span><select id="pDprKind">' + ["access", "correction", "erasure", "grievance", "nomination"].map(function (k) { return '<option value="' + k + '">' + esc(tr("privacy.kind." + k)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f"><span>' + esc(tr("privacy.detail")) + '</span><textarea id="pDprDetail" rows="3" maxlength="4000"></textarea></label>' +
        '<label class="f"><span>' + esc(tr("privacy.nominee")) + '</span><input id="pDprNomName"></label>' +
        '<label class="f"><span>' + esc(tr("privacy.nomineeRel")) + '</span><input id="pDprNomRel"></label>' +
        '<button class="btn primary" type="button" data-act="data-request">' + esc(tr("privacy.send")) + '</button><div id="pDprMsg" aria-live="polite"></div>';
      body += "<h3>" + esc(tr("privacy.yours")) + "</h3>" + (p.requests && p.requests.length ? '<ul class="plist">' + p.requests.map(function (r) {
        return "<li><b>" + esc(tr("privacy.kind." + r.kind)) + "</b>: " + esc(tr("privacy.state." + r.state)) + '<br><span class="quiet">' + esc(when(r.receivedAt)) + "</span>" +
          (r.response ? "<br>" + esc(r.response) : "") + "</li>";
      }).join("") + "</ul>" : '<p class="quiet" data-empty="data-requests">' + esc(tr("privacy.noRequests")) + "</p>");
    }
    return '<section class="card" aria-labelledby="h-privacy" data-section="privacy"><h2 id="h-privacy">' + esc(tr("privacy.title")) + "</h2>" + body + "</section>";
  }

  /* ---- gap wave 2026-09-16: booking, message preferences and surveys ------------------------------------------
   * Each loads after the record on its own and redraws only its own section. null = loading, false = failed. */
  function dayTime(iso) { var t = Date.parse(iso || ""); return isFinite(t) ? new Date(t).toLocaleString([], { weekday: "short", day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : ""; }
  function loadingCard(id, title) { return '<section class="card" data-section="' + id + '"><h2>' + esc(title) + '</h2><p role="status"><span class="spin"></span> ' + esc(tr("phase.loading")) + "</p></section>"; }
  function failedCard(id, title) { return '<section class="card" data-section="' + id + '"><h2>' + esc(title) + '</h2><div class="msg err" role="alert">' + esc(tr("section.failed")) + "</div></section>"; }

  /** PURE. b: the booking-options answer (null loading, false failed). ui: { dept, pick, moving, msg }. */
  function bookingSection(b, ui) {
    ui = ui || {};
    if (b == null) return loadingCard("booking", tr("book.title"));
    if (b === false) return failedCard("booking", tr("book.title"));
    if (!b.enabled) return '<section data-section="booking" hidden></section>';
    var dept = ui.dept || "";
    var slots = b.slots.filter(function (x) { return !dept || x.department === dept; });
    var who = function (x) { return x.clinicianName || tr("book.aDoctor"); };
    var h = '<section class="card" data-section="booking"><h2>' + esc(tr("book.title")) + '</h2><p class="quiet">' + esc(tr("book.rules", { cancel: b.rules.cancelHoursBefore, move: b.rules.rescheduleHoursBefore })) + "</p>";
    if (b.mine.length) h += "<h3>" + esc(tr("book.mine")) + '</h3><ul class="plist">' + b.mine.map(function (m) {
      var name = (b.clinicians.filter(function (x) { return x.clinicianId === m.clinicianId; })[0] || {}).name;
      return "<li><b>" + esc(dayTime(m.startAt)) + "</b>" + (name ? " " + esc(tr("appt.with", { who: name })) : "") +
        (m.canCancel ? ' <button class="btn" type="button" data-act="book-cancel" data-id="' + esc(m.appointmentId) + '">' + esc(tr("book.cancel")) + "</button>" : "") +
        (m.canReschedule ? ' <button class="btn" type="button" data-act="book-move" data-id="' + esc(m.appointmentId) + '">' + esc(tr("book.move")) + "</button>" : "") +
        (!m.online ? '<br><span class="quiet">' + esc(tr("book.byHospital")) + "</span>" : !m.canCancel ? '<br><span class="quiet">' + esc(tr("book.tooLate")) + "</span>" : "") + "</li>";
    }).join("") + "</ul>";
    if (ui.moving) h += '<div class="msg note">' + esc(tr("book.movingNote")) + ' <button class="btn" type="button" data-act="book-move-stop">' + esc(tr("book.keep")) + "</button></div>";
    h += '<label class="f"><span>' + esc(tr("book.department")) + '</span><select id="pBookDept"><option value="">' + esc(tr("book.anyDepartment")) + "</option>" +
      b.departments.map(function (d) { return '<option value="' + esc(d) + '"' + (d === dept ? " selected" : "") + ">" + esc(d) + "</option>"; }).join("") + "</select></label>";
    if (!slots.length) h += '<p class="quiet" data-empty="booking">' + esc(tr("book.noSlots", { days: b.rules.maxDaysAhead })) + "</p>";
    else h += '<label class="f"><span>' + esc(tr("book.time")) + '</span><select id="pBookSlot">' + slots.slice(0, 400).map(function (x, i) {
      return '<option value="' + i + '"' + (ui.pick === x.clinicianId + "|" + x.startAt ? " selected" : "") + ' data-clinician="' + esc(x.clinicianId) + '" data-start="' + esc(x.startAt) + '">' + esc(dayTime(x.startAt) + ", " + who(x) + " (" + x.department + ")") + "</option>";
    }).join("") + "</select></label>";
    var pick = ui.confirm ? b.slots.filter(function (x) { return x.clinicianId + "|" + x.startAt === ui.confirm; })[0] : null;
    if (pick) h += '<div class="msg note" role="note">' + esc(tr(ui.moving ? "book.confirmMove" : "book.confirmText", { when: dayTime(pick.startAt), who: who(pick), department: pick.department })) +
      '<br><button class="btn primary" type="button" data-act="book-confirm">' + esc(tr("book.confirm")) + '</button> <button class="btn" type="button" data-act="book-back">' + esc(tr("book.back")) + "</button></div>";
    else if (slots.length) h += '<button class="btn primary" type="button" data-act="book-ask">' + esc(tr(ui.moving ? "book.moveHere" : "book.book")) + "</button>";
    return h + '<div id="pBookMsg" aria-live="polite">' + (ui.msg ? '<div class="msg ' + (ui.msg.ok ? "ok" : "err") + '">' + esc(ui.msg.text) + "</div>" : "") + "</div></section>";
  }

  /** PURE. p: the comm-preferences answer. */
  function commSection(p) {
    if (p == null) return loadingCard("comm", tr("comm.title"));
    if (p === false) return failedCard("comm", tr("comm.title"));
    var h = '<section class="card" data-section="comm"><h2>' + esc(tr("comm.title")) + '</h2><p class="quiet">' + esc(tr("comm.intro")) + "</p>";
    ["sms", "whatsapp"].forEach(function (ch) {
      var x = p.preference.channels[ch];
      h += "<h3>" + esc(tr("comm." + ch)) + "</h3><p>" + esc(x.optedIn ? tr("comm.on", { number: x.mobile }) : tr("comm.off")) + "</p>";
      if (p.canChange) h += '<label class="f"><span>' + esc(tr("comm.mobile")) + '</span><input id="pComm_' + ch + '" inputmode="tel" autocomplete="tel"></label>' +
        '<button class="btn primary" type="button" data-act="comm-in" data-ch="' + ch + '">' + esc(tr("comm.yes")) + "</button> " +
        (x.optedIn ? '<button class="btn" type="button" data-act="comm-out" data-ch="' + ch + '">' + esc(tr("comm.stop")) + "</button>" : "");
    });
    if (!p.canChange) h += '<p class="quiet">' + esc(tr("comm.patientOnly")) + "</p>";
    return h + '<div id="pCommMsg" aria-live="polite"></div></section>';
  }

  /** PURE. One survey's questions: NPS, the hospital's questions, a comment. prefix keeps two forms apart. */
  function surveyForm(sv, prefix, sendAttrs) {
    var nps = "";
    for (var i = 0; i <= 10; i++) nps += '<label class="nps"><input type="radio" name="' + prefix + 'nps" value="' + i + '"> ' + i + "</label> ";
    return '<fieldset><legend>' + esc(tr("fb.nps")) + "</legend>" + nps + '<p class="quiet">' + esc(tr("fb.npsScale")) + "</p></fieldset>" +
      (sv.questions || []).map(function (q) {
        var name = prefix + "q_" + q.id;
        if (q.kind === "text") return '<label class="f"><span>' + esc(q.text) + '</span><textarea id="' + name + '" rows="2" maxlength="1000"></textarea></label>';
        var opts = q.kind === "yesno" ? [["true", tr("fb.yes")], ["false", tr("fb.no")]] : [["1", "1"], ["2", "2"], ["3", "3"], ["4", "4"], ["5", "5"]];
        return "<fieldset><legend>" + esc(q.text) + "</legend>" + opts.map(function (o) { return '<label><input type="radio" name="' + name + '" value="' + o[0] + '"> ' + esc(o[1]) + "</label> "; }).join("") +
          (q.kind === "rating5" ? '<p class="quiet">' + esc(tr("fb.ratingScale")) + "</p>" : "") + "</fieldset>";
      }).join("") +
      '<label class="f"><span>' + esc(tr("fb.comment")) + '</span><textarea id="' + prefix + 'comment" rows="3" maxlength="2000"></textarea></label>' +
      '<button class="btn primary" type="button" data-act="survey-send" ' + sendAttrs + ">" + esc(tr("fb.send")) + '</button><div id="' + prefix + 'msg" aria-live="polite"></div>';
  }

  /** PURE. The signed-in patient's open surveys. */
  function surveysSection(r) {
    if (r == null) return loadingCard("surveys", tr("fb.title"));
    if (r === false) return failedCard("surveys", tr("fb.title"));
    if (!r.surveys.length) return '<section data-section="surveys" hidden></section>';
    return '<section class="card" data-section="surveys"><h2>' + esc(tr("fb.title")) + "</h2>" + r.surveys.map(function (sv, i) {
      return "<article><h3>" + esc(tr(sv.kind === "discharge" ? "fb.afterStay" : "fb.afterVisit")) + (sv.department ? ", " + esc(sv.department) : "") + "</h3>" +
        (r.canAnswer ? surveyForm(sv, "pS" + i + "_", 'data-invite="' + esc(sv.inviteId) + '" data-prefix="pS' + i + '_"') : '<p class="quiet">' + esc(tr("fb.patientOnly")) + "</p>") + "</article>";
    }).join("") + "</section>";
  }

  /** PURE. The survey opened from a link, without signing in. p: { phase: loading|failed|closed|answered|open|thanks, survey, hospital } */
  function surveyPage(p) {
    if (p.phase === "loading") return '<div class="card" role="status"><span class="spin"></span> ' + esc(tr("phase.loading")) + "</div>";
    if (p.phase === "failed") return '<div class="card" role="alert"><div class="msg err">' + esc(tr("fb.linkFailed")) + "</div></div>";
    if (p.phase === "thanks" || p.phase === "answered") return '<div class="card" role="status"><h1>' + esc(tr("fb.thanksTitle")) + "</h1><p>" + esc(tr(p.phase === "thanks" ? "fb.thanks" : "fb.alreadyAnswered")) + "</p></div>";
    if (p.phase !== "open") return '<div class="card" role="alert"><div class="msg note">' + esc(tr("fb.closed")) + "</div></div>";
    return '<form class="card" onsubmit="return false"><h1>' + esc(tr("fb.linkTitle", { hospital: p.hospital || "" })) + "</h1><p>" + esc(tr(p.survey.kind === "discharge" ? "fb.afterStay" : "fb.afterVisit")) + "</p>" + surveyForm(p.survey, "pL_", 'data-link="1" data-prefix="pL_"') + "</form>";
  }

  /** From a survey form in the page: the answers object, or null when no score was chosen. */
  function answersFrom(prefix, questions) {
    var picked = function (name) { var el = document.querySelector('input[name="' + name + '"]:checked'); return el ? el.value : null; };
    var nps = picked(prefix + "nps");
    if (nps == null) return null;
    var answers = {};
    (questions || []).forEach(function (q) {
      if (q.kind === "text") { var t = document.getElementById(prefix + "q_" + q.id); if (t && t.value.trim()) answers[q.id] = t.value.trim(); return; }
      var v = picked(prefix + "q_" + q.id);
      if (v != null) answers[q.id] = q.kind === "yesno" ? v === "true" : Number(v);
    });
    var c = document.getElementById(prefix + "comment");
    return { nps: Number(nps), comment: c ? c.value.trim() : "", answers: answers };
  }

  /* ---- pre-admission forms (form-response.js portalIntake) ----------------------------------------------------
   * The hospital's own forms, for a planned admission only. The questions and their labels are the hospital's words,
   * shown as written. What the patient sends is labelled as theirs until a member of staff reviews it. */
  function intakeVisible(cond, a) {
    if (!cond) return true;
    if (cond.all) return cond.all.every(function (c) { return intakeVisible(c, a); });
    if (cond.any) return cond.any.some(function (c) { return intakeVisible(c, a); });
    var v = a[cond.field], filled = !(v == null || v === "" || (v && v.length === 0));
    return cond.op === "filled" ? filled : cond.op === "empty" ? !filled : cond.op === "eq" ? v === cond.value : cond.op === "ne" ? v !== cond.value
      : cond.op === "in" ? (cond.value || []).indexOf(v) >= 0 : cond.op === "gt" ? +v > +cond.value : cond.op === "gte" ? +v >= +cond.value : cond.op === "lt" ? +v < +cond.value : cond.op === "lte" ? +v <= +cond.value : false;
  }
  function intakeField(f, a, err) {
    var id = "pIf_" + f.key, v = a[f.key], attr = ' id="' + esc(id) + '" data-intake-field="' + esc(f.key) + '"';
    var input = f.type === "textarea" ? "<textarea" + attr + ' rows="3" maxlength="8000">' + esc(v || "") + "</textarea>"
      : f.type === "boolean" ? "<select" + attr + '><option value="">-</option><option value="true"' + (v === true ? " selected" : "") + ">" + esc(tr("intake.yes")) + '</option><option value="false"' + (v === false ? " selected" : "") + ">" + esc(tr("intake.no")) + "</option></select>"
      : f.type === "single_choice" ? "<select" + attr + '><option value="">-</option>' + f.options.map(function (o) { return '<option value="' + esc(o.value) + '"' + (v === o.value ? " selected" : "") + ">" + esc(o.label || o.value) + "</option>"; }).join("") + "</select>"
      : f.type === "multi_choice" ? f.options.map(function (o) { return '<label><input type="checkbox" data-intake-multi="' + esc(f.key) + '" value="' + esc(o.value) + '"' + ((v || []).indexOf(o.value) >= 0 ? " checked" : "") + "> " + esc(o.label || o.value) + "</label>"; }).join(" ")
      : f.type === "calculated" ? '<span class="quiet">' + esc(tr("intake.calculated")) + "</span>"
      : "<input" + attr + ' type="' + (f.type === "number" || f.type === "integer" ? "number" : f.type === "date" ? "date" : f.type === "datetime" ? "datetime-local" : "text") + '" value="' + esc(v == null ? "" : v) + '">';
    return '<label class="f"><span>' + esc(f.label) + (f.required ? " *" : "") + "</span>" + input + (err ? '<span class="msg err" role="alert">' + esc(err) + "</span>" : "") + "</label>";
  }
  /** PURE. Which admission or appointment an open-form key names: "requestId|formKey", or "appt:appointmentId|formKey". */
  function intakeTarget(key) {
    var k = String(key || "").split("|"), appt = k[0].indexOf("appt:") === 0;
    return { requestId: appt ? null : k[0], appointmentId: appt ? k[0].slice(5) : null, formKey: k.slice(1).join("|") };
  }
  /** PURE. The patient's own response for one open-form key, if any. */
  function intakeMine(d, key) {
    var t = intakeTarget(key);
    return (d.responses || []).filter(function (x) { return x.formKey === t.formKey && (t.appointmentId ? x.appointmentId === t.appointmentId : x.admissionRequestId === t.requestId); })[0];
  }
  /** PURE. d: the intake-forms answer (null loading, false failed). ui: { open: "requestId|formKey" or "appt:id|formKey", answers, errors, msg }.
   * R4-5: a booked appointment still to come is listed like a planned admission, with the forms the hospital marked for
   * appointments (the server sends none unless the hospital turned that on). */
  function intakeSection(d, ui) {
    ui = ui || {};
    if (d == null) return loadingCard("intake", tr("intake.title"));
    if (d === false) return failedCard("intake", tr("intake.title"));
    var appts = d.appointments || [];
    // Nothing planned: nothing to offer, and no empty card to wonder about.
    if (!d.admissions.length && !appts.length) return '<section data-section="intake" hidden></section>';
    var h = '<section class="card" data-section="intake"><h2>' + esc(tr("intake.title")) + '</h2><p class="msg note">' + esc(tr("intake.notVerified")) + '</p><p class="quiet">' + esc(tr("intake.privacy")) + "</p>";
    var groups = d.admissions.map(function (adm) { return { id: adm.requestId, head: tr("intake.for", { date: adm.plannedFor }) + (adm.specialty ? ", " + adm.specialty : ""), forms: d.forms }; })
      .concat(appts.map(function (a) { return { id: "appt:" + a.appointmentId, head: tr("intake.forAppointment", { when: when(a.startAt) }) + (a.department ? ", " + a.department : ""), forms: d.appointmentForms || [] }; }));
    groups.forEach(function (g) {
      h += "<h3>" + esc(g.head) + "</h3>";
      if (!g.forms.length) { h += '<p class="quiet" data-empty="intake">' + esc(tr("intake.noForms")) + "</p>"; return; }
      g.forms.forEach(function (f) {
        var key = g.id + "|" + f.key, mine = intakeMine(d, key);
        h += '<article data-intake-form="' + esc(key) + '"><h4>' + esc(f.title) + "</h4>";
        if (mine) h += mine.reviewState === "accepted" ? '<p class="msg ok" data-intake-state="accepted">' + esc(tr("intake.accepted", { when: when(mine.reviewedAt) })) + "</p>"
          : mine.reviewState === "returned" ? '<p class="msg err" data-intake-state="returned">' + esc(tr("intake.returned")) + " " + esc(mine.reviewReason) + "</p>"
          : '<p class="quiet" data-intake-state="submitted">' + esc(tr("intake.sent", { when: when(mine.submittedAt) })) + "</p>";
        if (mine && mine.reviewState === "accepted") { h += "</article>"; return; }
        if (ui.open !== key) { h += '<button class="btn" type="button" data-act="intake-open" data-key="' + esc(key) + '">' + esc(tr(mine ? "intake.change" : "intake.fill")) + "</button></article>"; return; }
        var a = ui.answers || {}, errs = ui.errors || {};
        h += (f.sections || []).map(function (sec) {
          return "<fieldset><legend>" + esc(sec.title) + "</legend>" + (sec.fields || []).filter(function (fd) { return intakeVisible(fd.showWhen, a); }).map(function (fd) { return intakeField(fd, a, errs[fd.key]); }).join("") + "</fieldset>";
        }).join("") +
          '<button class="btn primary" type="button" data-act="intake-send" data-key="' + esc(key) + '" data-version="' + esc(f.version) + '">' + esc(tr("intake.send")) + '</button> <button class="btn" type="button" data-act="intake-close">' + esc(tr("intake.close")) + "</button></article>";
      });
    });
    return h + '<div id="pIntakeMsg" aria-live="polite">' + (ui.msg ? '<div class="msg ' + (ui.msg.ok ? "ok" : "err") + '">' + esc(ui.msg.text) + "</div>" : "") + "</div></section>";
  }
  /** From the open form in the page: the answers as typed, numbers as numbers. */
  function intakeAnswersFrom(f) {
    var a = {};
    (f.sections || []).forEach(function (sec) { (sec.fields || []).forEach(function (fd) {
      if (fd.type === "calculated") return;
      if (fd.type === "multi_choice") {
        var boxes = document.querySelectorAll('[data-intake-multi="' + fd.key + '"]'), picked = [];
        for (var i = 0; i < boxes.length; i++) if (boxes[i].checked) picked.push(boxes[i].value);
        if (picked.length) a[fd.key] = picked; return;
      }
      var el = document.getElementById("pIf_" + fd.key), v = el ? String(el.value || "").trim() : "";
      if (v === "") return;
      a[fd.key] = fd.type === "number" || fd.type === "integer" ? Number(v) : fd.type === "boolean" ? v === "true" : v;
    }); });
    return a;
  }

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
    if (has("forms")) out.push(intakeSection(null));

    if (has("appointments")) {
      out.push(section("appointments", tr("appt.title"), unread(doc.appointments), doc.appointments, function (a) {
        return "<b>" + esc(when(a.at) || tr("appt.tbc")) + "</b>" + (a.with ? " " + esc(tr("appt.with", { who: a.with })) : "") + (a.kind ? " (" + esc(a.kind) + ")" : "");
      }, tr("appt.empty")));
      out.push('<section class="card" data-section="appointment-request"><h2>' + esc(tr("appt.ask")) + '</h2><p class="quiet">' + esc(tr("appt.askNote")) + "</p>" +
        '<label class="f"><span>' + esc(tr("appt.reason")) + '</span><input id="pApptReason" maxlength="300"></label>' +
        '<label class="f"><span>' + esc(tr("appt.pref")) + '</span><input id="pApptPref" maxlength="200"></label>' +
        '<button class="btn primary" type="button" data-act="appt">' + esc(tr("appt.send")) + '</button><div id="pApptMsg" aria-live="polite"></div></section>');
      out.push(bookingSection(null));
    }
    if (has("medicines")) out.push(section("medicines", tr("meds.title"), unread(doc.medicines), doc.medicines, function (m) {
      return "<b>" + esc(m.drug) + "</b>" + [m.dose, m.route, m.frequency].filter(Boolean).map(function (x) { return " " + esc(typeof x === "object" ? (x.value + " " + x.unit) : x); }).join(",") + (m.note ? "<br>" + esc(m.note) : "");
    }, tr("meds.empty")));
    if (has("results")) {
      out.push(section("results", tr("results.title"), unread(doc.results), doc.results, function (x) {
        return "<b>" + esc(x.name) + "</b> " + esc(when(x.reportedAt)) + (x.conclusion ? "<br>" + esc(x.conclusion) : "");
      }, tr("results.empty")));
      if (doc.withheldResults && doc.withheldResults.length) out.push('<div class="msg note">' + doc.withheldResults.map(function (w) { return esc(w.say); }).join("<br>") + "</div>");
    }
    if (has("diagnoses")) {
      out.push(section("diagnoses", tr("dx.title"), unread(doc.diagnoses), doc.diagnoses, function (d) { return "<b>" + esc(d.display) + "</b>" + (d.note ? "<br>" + esc(d.note) : ""); }, tr("dx.empty")));
      out.push(section("allergies", tr("allergy.title"), unread(doc.allergies), doc.allergies, function (a) { return "<b>" + esc(a.substance) + "</b>" + (a.reaction ? ": " + esc(a.reaction) : ""); }, tr("allergy.empty")));
    }
    if (has("discharge") || has("discharge-full")) out.push(dischargeSection(failed("discharge"), r.dischargeSummaries));
    if (has("documents")) out.push(section("documents", tr("docs.title"), failed("documents"), r.documents, documentItem, tr("docs.empty")));
    /* The approved leaflets a clinician gave, in the leaflet's own language; the words are the hospital's, never translated here. */
    if (has("education")) out.push(section("education", tr("edu.title"), failed("education"), r.education, function (x) {
      return '<b lang="' + esc(x.language) + '">' + esc(x.title) + '</b> <span class="quiet">' + esc(tr("edu.given", { when: when(x.attachedAt) })) + '</span><div lang="' + esc(x.language) + '">' + lines(x.body) + "</div>";
    }, tr("edu.empty")));
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
    out.push(commSection(null), surveysSection(null));
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
    out.push(privacySection(null));
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
    bookingSection: bookingSection, intakeSection: intakeSection, commSection: commSection, surveysSection: surveysSection, surveyPage: surveyPage,
    esc: esc, section: section, privacySection: privacySection, renderRecord: renderRecord, renderPhase: renderPhase, statusSection: statusSection, dischargeItem: dischargeItem, dischargeSection: dischargeSection, documentItem: documentItem
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
      if (r && r.ok) { show({ phase: "ready", data: r }); if (r.access && (r.access.sections || []).indexOf("status") >= 0) loadQueue(s); loadPrivacy(s); loadEngage(s, r.access); return; }
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

  /* The privacy section loads after the record and redraws only itself, like the queue status. */
  function loadPrivacy(s) {
    var put = function (p) { var el = root.querySelector('[data-section="privacy"]'); if (el) el.outerHTML = privacySection(p); };
    put(null);
    post("privacy", { orgId: s.orgId, grantId: s.grantId, token: s.token, language: document.documentElement.lang || "en" }).then(function (p) {
      if (p && p.httpStatus === 401) { save(null); return show({ phase: "ended", detail: p.detail }); }
      put(p && p.ok ? p : false);
    }, function () { put(false); });
  }
  /* Booking, message preferences and surveys: each loads on its own and redraws only its section. */
  var book = { data: null, ui: {} }, surveys = null, intake = { data: null, ui: {} };
  function putSection(id, html) { var el = root.querySelector('[data-section="' + id + '"]'); if (el) el.outerHTML = html; }
  function sessionBody(s, extra) { var b = { orgId: s.orgId, grantId: s.grantId, token: s.token }; for (var k in extra) b[k] = extra[k]; return b; }
  function ended(r) { if (r && r.httpStatus === 401) { save(null); show({ phase: "ended", detail: r.detail }); return true; } return false; }
  function loadBooking(s) {
    post("booking-options", sessionBody(s, {})).then(function (r) { if (ended(r)) return; book.data = r && r.ok ? r : false; putSection("booking", bookingSection(book.data, book.ui)); }, function () { book.data = false; putSection("booking", bookingSection(false)); });
  }
  function loadEngage(s, access) {
    if ((access.sections || []).indexOf("appointments") >= 0) { book.ui = {}; loadBooking(s); }
    if ((access.sections || []).indexOf("forms") >= 0) { intake.ui = {}; loadIntake(s); }
    post("comm-preferences", sessionBody(s, {})).then(function (r) { if (ended(r)) return; putSection("comm", commSection(r && r.ok ? r : false)); }, function () { putSection("comm", commSection(false)); });
    post("feedback-pending", sessionBody(s, {})).then(function (r) { if (ended(r)) return; surveys = r && r.ok ? r : false; putSection("surveys", surveysSection(surveys)); }, function () { putSection("surveys", surveysSection(false)); });
  }
  function loadIntake(s) {
    post("intake-forms", sessionBody(s, {})).then(function (r) { if (ended(r)) return; intake.data = r && r.ok ? r : false; putSection("intake", intakeSection(intake.data, intake.ui)); },
      function () { intake.data = false; putSection("intake", intakeSection(false)); });
  }
  function intakeForm(key) {
    var t = intakeTarget(key), list = intake.data ? (t.appointmentId ? intake.data.appointmentForms : intake.data.forms) : null;
    return list ? list.filter(function (f) { return f.key === t.formKey; })[0] : null;
  }
  function surveyFromHash() { var m = /(?:^|[#&])survey=([A-Za-z0-9_-]+)/.exec(location.hash || ""); return m ? m[1] : ""; }
  var linkSurvey = null;
  function showSurvey(p) { root.innerHTML = langSwitcher() + surveyPage(p); lastPhase = { survey: p }; }
  function openLinkSurvey() {
    showSurvey({ phase: "loading" });
    post("feedback-open", { orgId: orgFromHash(), surveyToken: surveyFromHash() }).then(function (r) {
      if (!r || !r.ok) return showSurvey({ phase: "failed" });
      linkSurvey = r.survey;
      showSurvey({ phase: r.state, survey: r.survey, hospital: r.hospital });
    }, function () { showSurvey({ phase: "failed" }); });
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
    // A controlling answer can show or hide other questions: redraw only the intake section, keeping what was typed.
    if (ev.target.hasAttribute && (ev.target.hasAttribute("data-intake-field") || ev.target.hasAttribute("data-intake-multi")) && intake.ui.open) {
      var of = intakeForm(intake.ui.open); if (of) { intake.ui.answers = intakeAnswersFrom(of); putSection("intake", intakeSection(intake.data, intake.ui)); }
      return;
    }
    if (ev.target.id === "pBookDept" && book.data) { book.ui.dept = ev.target.value; book.ui.confirm = null; return putSection("booking", bookingSection(book.data, book.ui)); }
    if (ev.target.id !== "pLang") return;
    var code = ev.target.value;
    saveLang(code);
    ensureLangLoaded(code, function () { document.documentElement.lang = code; if (lastPhase && lastPhase.survey) return showSurvey(lastPhase.survey); show(lastPhase || { phase: "loading" }); });
  });

  root.addEventListener("click", function (ev) {
    var b = ev.target.closest && ev.target.closest("[data-act]"); if (!b) return;
    var act = b.getAttribute("data-act"), s = load();
    if (act === "retry") return refresh();
    if (act === "signout") { save(null); return refresh(); }
    if (act === "print") return printSummary(b);
    if (act === "survey-send" && b.getAttribute("data-link")) {
      var la = answersFrom("pL_", linkSurvey && linkSurvey.questions);
      if (!la) { document.getElementById("pL_msg").innerHTML = '<div class="msg err">' + esc(tr("fb.chooseScore")) + "</div>"; return; }
      b.disabled = true;
      return post("feedback-submit", { orgId: orgFromHash(), surveyToken: surveyFromHash(), answers: la }).then(function (r) {
        if (r && r.ok) return showSurvey({ phase: "thanks" });
        b.disabled = false; document.getElementById("pL_msg").innerHTML = '<div class="msg err">' + esc((r && r.message) || tr("action.failed")) + "</div>";
      }, function () { b.disabled = false; document.getElementById("pL_msg").innerHTML = '<div class="msg err">' + esc(tr("action.failed")) + "</div>"; });
    }
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
    if (act === "privacy-ack") {
      return post("privacy-acknowledge", { orgId: s.orgId, grantId: s.grantId, token: s.token, language: b.getAttribute("data-lang") })
        .then(function (r) { if (r && r.ok) return loadPrivacy(s); b.disabled = false; alert((r && r.detail) || tr("action.failedShort")); }, function () { b.disabled = false; alert(tr("action.failedShort")); });
    }
    if (act === "data-request") {
      var kind = document.getElementById("pDprKind").value, detail = document.getElementById("pDprDetail").value.trim();
      if (!detail) { b.disabled = false; return say("pDprMsg", { ok: false, detail: tr("privacy.writeFirst") }); }
      var req = { orgId: s.orgId, grantId: s.grantId, token: s.token, kind: kind, detail: detail };
      if (kind === "nomination") req.nominee = { name: document.getElementById("pDprNomName").value.trim(), relationship: document.getElementById("pDprNomRel").value.trim() };
      return post("data-request", req).then(function (r) {
        b.disabled = false;
        if (r && r.ok) { say("pDprMsg", r, tr("privacy.sent")); return setTimeout(function () { loadPrivacy(s); }, 1200); }
        say("pDprMsg", r, "");
      }, function () { b.disabled = false; say("pDprMsg", null); });
    }
    if (act === "book-ask") {
      b.disabled = false;
      var sel = document.getElementById("pBookSlot"), opt = sel && sel.options[sel.selectedIndex];
      if (!opt) return;
      book.ui.confirm = opt.getAttribute("data-clinician") + "|" + opt.getAttribute("data-start"); book.ui.pick = book.ui.confirm; book.ui.msg = null;
      return putSection("booking", bookingSection(book.data, book.ui));
    }
    if (act === "book-back" || act === "book-move-stop") { b.disabled = false; book.ui.confirm = null; if (act === "book-move-stop") book.ui.moving = null; return putSection("booking", bookingSection(book.data, book.ui)); }
    if (act === "book-move") { b.disabled = false; book.ui.moving = b.getAttribute("data-id"); book.ui.confirm = null; return putSection("booking", bookingSection(book.data, book.ui)); }
    if (act === "book-confirm" || act === "book-cancel") {
      if (act === "book-cancel" && !confirm(tr("book.cancelConfirm"))) { b.disabled = false; return; }
      var parts = String(book.ui.confirm || "").split("|");
      var moving = book.ui.moving;
      var req = act === "book-cancel" ? post("booking-cancel", sessionBody(s, { appointmentId: b.getAttribute("data-id") }))
        : moving ? post("booking-reschedule", sessionBody(s, { appointmentId: moving, clinicianId: parts[0], startAt: parts.slice(1).join("|") }))
        : post("booking-book", sessionBody(s, { clinicianId: parts[0], startAt: parts.slice(1).join("|") }));
      return req.then(function (r) {
        if (ended(r)) return;
        book.ui = { msg: { ok: !!(r && r.ok), text: r && r.ok ? tr(act === "book-cancel" ? "book.cancelled" : moving ? "book.moved" : "book.booked") : ((r && r.detail) || tr("action.failed")) } };
        post("booking-options", sessionBody(s, {})).then(function (o) { book.data = o && o.ok ? o : false; putSection("booking", bookingSection(book.data, book.ui)); });
      }, function () { b.disabled = false; book.ui.msg = { ok: false, text: tr("action.failed") }; putSection("booking", bookingSection(book.data, book.ui)); });
    }
    if (act === "intake-open" || act === "intake-close") {
      b.disabled = false;
      var ok = act === "intake-open" ? b.getAttribute("data-key") : null, prev = null;
      if (ok) prev = intakeMine(intake.data, ok);
      intake.ui = { open: ok, answers: prev ? prev.answers : {}, errors: {} };
      return putSection("intake", intakeSection(intake.data, intake.ui));
    }
    if (act === "intake-send") {
      var ik = b.getAttribute("data-key"), kf = intakeForm(ik), it = intakeTarget(ik);
      if (!kf) { b.disabled = false; return; }
      intake.ui.answers = intakeAnswersFrom(kf);
      return post("intake-submit", sessionBody(s, { requestId: it.requestId || undefined, appointmentId: it.appointmentId || undefined, formKey: it.formKey, formVersion: Number(b.getAttribute("data-version")), answers: intake.ui.answers })).then(function (r) {
        if (ended(r)) return;
        if (r && r.ok) {
          intake.ui = { msg: { ok: true, text: tr(it.appointmentId ? "intake.thanksAppointment" : "intake.thanks") } };
          return post("intake-forms", sessionBody(s, {})).then(function (o) { intake.data = o && o.ok ? o : false; putSection("intake", intakeSection(intake.data, intake.ui)); });
        }
        intake.ui.errors = (r && r.errors) || {};
        intake.ui.msg = { ok: false, text: r && r.errors ? tr("intake.fix") : ((r && r.detail) || tr("action.failed")) };
        putSection("intake", intakeSection(intake.data, intake.ui));
      }, function () { b.disabled = false; intake.ui.msg = { ok: false, text: tr("action.failed") }; putSection("intake", intakeSection(intake.data, intake.ui)); });
    }
    if (act === "comm-in" || act === "comm-out") {
      var ch = b.getAttribute("data-ch");
      return post("comm-preference-set", sessionBody(s, { channel: ch, optedIn: act === "comm-in", mobile: act === "comm-in" ? (document.getElementById("pComm_" + ch) || {}).value : "" })).then(function (r) {
        if (ended(r)) return;
        if (!(r && r.ok)) { b.disabled = false; say("pCommMsg", { ok: false, detail: r && (r.detail || r.message) }); return; }
        post("comm-preferences", sessionBody(s, {})).then(function (p) { putSection("comm", commSection(p && p.ok ? p : false)); var m = document.getElementById("pCommMsg"); if (m) m.innerHTML = '<div class="msg ok">' + esc(tr("comm.saved")) + "</div>"; });
      }, function () { b.disabled = false; say("pCommMsg", null); });
    }
    if (act === "survey-send") {
      var prefix = b.getAttribute("data-prefix"), inviteId = b.getAttribute("data-invite");
      var sv = surveys && surveys.surveys.filter(function (x) { return x.inviteId === inviteId; })[0];
      var ans = answersFrom(prefix, sv && sv.questions);
      if (!ans) { b.disabled = false; return say(prefix + "msg", { ok: false, detail: tr("fb.chooseScore") }); }
      return post("feedback-submit", sessionBody(s, { inviteId: inviteId, answers: ans })).then(function (r) {
        if (ended(r)) return;
        if (!(r && r.ok)) { b.disabled = false; return say(prefix + "msg", { ok: false, detail: (r && r.message) || tr("action.failed") }); }
        surveys.surveys = surveys.surveys.filter(function (x) { return x.inviteId !== inviteId; });
        putSection("surveys", surveysSection(surveys));
        if (!surveys.surveys.length) { var el = root.querySelector('[data-section="surveys"]'); if (el) el.outerHTML = '<section class="card" data-section="surveys"><div class="msg ok">' + esc(tr("fb.thanks")) + "</div></section>"; }
      }, function () { b.disabled = false; say(prefix + "msg", null); });
    }
    if (act === "withdraw") {
      if (!confirm(tr("consents.confirm"))) { b.disabled = false; return; }
      return post("consent-withdraw", { orgId: s.orgId, grantId: s.grantId, token: s.token, consentId: b.getAttribute("data-id") })
        .then(function (r) { if (r && r.ok) return refresh(); b.disabled = false; alert((r && r.detail) || tr("action.failedShort")); }, function () { b.disabled = false; alert(tr("action.failedShort")); });
    }
  });

  var savedLang = window.WSQI18n && window.WSQI18n.offered(loadLang()) ? loadLang() : "en";
  ensureLangLoaded(savedLang, function () { document.documentElement.lang = savedLang; if (surveyFromHash()) return openLinkSurvey(); refresh(); });
})();
