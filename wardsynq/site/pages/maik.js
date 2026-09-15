/* wardsynq/site/pages/maik.js - MaiK, the governed clinical AI, for one admitted or ED patient.
 *
 * Same route the ward chart uses (POST /ward/maik-ask), same review route (POST /ward/maik-review).
 * The patient is picked from the hospital's live inpatient and ED lists, never typed, so the
 * question is always bound to a real record id and encounter. Whatever the server withholds stays
 * withheld here: this page renders the interaction record, it does not soften it. */
(function () {
  "use strict";
  var WSQ = window.WSQ;

  /* Staff language (ui-i18n-site). The inline English is the fallback when the shell context has no t
   * (helpers rendered on their own), and must equal the key's English in i18n.js byte for byte. */
  function T(c, key, en, vars) { return c && c.t ? c.t(key, vars, en) : String(en).replace(/\{(\w+)\}/g, function (m, k) { return vars && vars[k] != null ? String(vars[k]) : m; }); }
  function TS(c, key, en, vars) { return c && c.tSafe ? c.tSafe(key, vars, en) : String(T(c, key, en, vars)).replace(/[&<>"']/g, function (ch) { return { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]; }); }
  function EN(c, html) { return c && c.en ? c.en(html) : html; }

  var TASKS = ["summarise", "draft-note", "explain", "extract"];
  function taskLabel(c, value) {
    if (value === "summarise") return T(c, "site.maik.taskSummarise", "Summarise this admission");
    if (value === "draft-note") return T(c, "site.maik.taskDraftNote", "Draft a progress note");
    if (value === "explain") return T(c, "site.maik.taskExplain", "Explain the current picture");
    if (value === "extract") return T(c, "site.maik.taskExtract", "Extract key facts");
    return value;
  }
  function reviewWord(c, rv) {
    if (rv === "accepted") return T(c, "site.maik.reviewAccepted", "accepted");
    if (rv === "rejected") return T(c, "site.maik.reviewRejected", "rejected");
    return T(c, "site.maik.reviewPending", "pending");
  }

  /* LT-40: why an ask failed, as escaped HTML, in the staff language with the English under it. A bare code
   * ("bad_response") told a clinician nothing. Not configured (409 from the gateway's routing refusals) is
   * the hospital's setup; no JSON at all, or a 5xx, is the AI service not answering. The server's own
   * sentence follows in English, because it names what to change. */
  var NOT_CONFIGURED = ["maik_disabled", "no_phi_approved_model", "no_model"];
  function askFailure(c, r) {
    if (!r) return TS(c, "site.maik.unreachable", "MaiK could not be reached.");
    var detail = r && (r.detail || r.message) ? '<br><span class="quiet">' + EN(c, c.esc(r.detail || r.message)) + "</span>" : "";
    if (r && (r.notConfigured || NOT_CONFIGURED.indexOf(r.error) >= 0))
      return TS(c, "site.maik.notConfigured", "MaiK is not set up for this hospital. A hospital administrator turns it on and approves a model provider in Admin Center, MaiK clinical AI. Charting and safety checks work without it.") + detail;
    if (r.error === "bad_response" || r.error === "network" || r.error === "model_unavailable" || r.error === "empty_answer" || (r.status && r.status >= 500))
      return TS(c, "site.maik.notAnswering", "MaiK did not answer: the AI service is not reachable right now. Nothing was written. Charting and safety checks work without it; try again later.") + detail;
    return TS(c, "site.maik.askRefused", "MaiK could not answer this request.") + (detail || '<br><span class="quiet">' + EN(c, c.esc(r.error || "")) + "</span>");
  }

  WSQ._maikAskFailure = askFailure;

  WSQ.page("maik", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc, ms = c.ms;
    if (!c.isWardsynq()) { el.innerHTML = '<div class="msg note">' + esc(T(c, "site.maik.noRecord", "MaiK reads the WardSynQ clinical record. This hospital does not keep one.")) + '</div>'; return; }
    if (!c.can("emr.view")) { el.innerHTML = '<div class="msg note">' + TS(c, "site.maik.noEmrViewLead", "Your role (") + EN(c, esc(st.who.role)) + TS(c, "site.maik.noEmrViewTrail", ") does not include emr.view.") + "</div>"; return; }
    var q = "?orgId=" + encodeURIComponent(st.orgId);
    var S = { patients: [], sel: null, task: "summarise", busy: false, i: null, err: "" };
    el.innerHTML =
      '<div class="title"><h1>' + esc(T(c, "site.maik.title", "MaiK clinical AI")) + '</h1><span class="sub">' + esc(T(c, "site.maik.subtitle", "governed, reviewed by you, never a second source of truth")) + '</span></div>' +
      '<div class="msg note">' + TS(c, "site.maik.governedNote", "MaiK drafts from the record and its answers are unsigned until a clinician accepts them. Every interaction is written to the record with its model, sources and your review. Clinical content in this build is not yet signed off by a hospital committee.") + '</div>' +
      '<div class="card"><h2>' + esc(T(c, "site.maik.patientTitle", "Patient")) + '</h2><div id="mkList"><span class="spin"></span></div></div>' +
      '<div class="card" id="mkAsk" hidden></div><div class="card" id="mkOut" hidden></div>';
    function paintAsk() {
      var ask = document.getElementById("mkAsk"); if (!S.sel) { ask.hidden = true; return; }
      ask.hidden = false;
      ask.innerHTML = "<h2>" + EN(c, esc(S.sel.name || S.sel.patientId)) + ' <span class="pill">' + EN(c, esc(S.sel.where)) + "</span></h2>" +
        '<div class="row"><label class="f"><span>' + esc(T(c, "site.maik.taskLabel", "Task")) + '</span><select id="mkTask">' + TASKS.map(function (t) { return '<option value="' + t + '"' + (t === S.task ? " selected" : "") + ">" + esc(taskLabel(c, t)) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f" style="flex:2 1 260px"><span>' + esc(T(c, "site.maik.questionLabel", "Question (optional)")) + '</span><input id="mkQ" maxlength="400" placeholder="' + esc(T(c, "site.maik.questionPlaceholder", "e.g. what changed since yesterday?")) + '"></label>' +
        '<button class="btn" id="mkGo" type="button"' + (S.busy ? " disabled" : "") + ">" + ms("psychology") + esc(S.busy ? T(c, "site.maik.asking", "Asking") : T(c, "site.maik.askButton", "Ask MaiK")) + "</button></div>" +
        (S.err ? '<div class="msg err">' + S.err + "</div>" : "");
      document.getElementById("mkTask").onchange = function (e) { S.task = e.target.value; };
      document.getElementById("mkGo").onclick = ask_;
    }
    function ask_() {
      if (!S.sel || S.busy) return;
      S.busy = true; S.err = ""; S.i = null; paintAsk(); paintOut();
      var body = { orgId: st.orgId, patientId: S.sel.patientId, encounterId: S.sel.encounterId || undefined, task: S.task };
      var qq = (document.getElementById("mkQ").value || "").trim(); if (qq) body.question = qq;
      c.api("/ward/maik-ask", body).then(function (r) {
        S.busy = false;
        if (r && r.ok) S.i = r.interaction;
        else S.err = askFailure(c, r);
        paintAsk(); paintOut();
      });
    }
    function paintOut() {
      var o = document.getElementById("mkOut"), i = S.i; if (!i) { o.hidden = true; return; }
      o.hidden = false;
      var rv = i.review && i.review.state ? i.review.state : "pending";
      o.innerHTML = "<h2>" + esc(T(c, "site.maik.answerLabel", "Answer")) + " <span class=\"pill " + (i.output ? "ok" : "stop") + "\">" + esc(i.output ? T(c, "site.maik.released", "released") : T(c, "site.maik.withheld", "withheld")) + "</span> <span class=\"pill " + (rv === "accepted" ? "ok" : rv === "rejected" ? "stop" : "warn") + "\">" + esc(T(c, "site.maik.reviewPrefix", "review:")) + " " + esc(reviewWord(c, rv)) + "</span></h2>" +
        (i.output ? '<div class="mono" style="font-family:inherit;font-size:14.5px">' + EN(c, esc(i.output)) + "</div>" :
          '<div class="msg err">' + TS(c, "site.maik.withheldLead", "MaiK withheld this answer") + (i.withheld && i.withheld.violations ? ": " + EN(c, esc(i.withheld.violations.join(", "))) : "") + TS(c, "site.maik.withheldTrail", ". Nothing was shown to you that the safety screen refused.") + "</div>") +
        '<dl class="kv" style="margin-top:12px"><dt>' + esc(T(c, "site.maik.interactionLabel", "Interaction")) + '</dt><dd class="mono">' + EN(c, esc(i.id)) + "</dd>" +
        (i.model ? "<dt>" + esc(T(c, "site.maik.modelLabel", "Model")) + "</dt><dd>" + EN(c, esc(i.model.model || "")) + (i.model.version ? " " + EN(c, esc(i.model.version)) : "") + "</dd>" : "") +
        "<dt>" + esc(T(c, "site.maik.taskColLabel", "Task")) + "</dt><dd>" + EN(c, esc(i.task || S.task)) + "</dd>" +
        (i.sources && i.sources.length ? "<dt>" + esc(T(c, "site.maik.sourcesLabel", "Sources")) + "</dt><dd>" + esc(T(c, "site.maik.sourcesCount", "{n} signed record documents", { n: i.sources.length })) + "</dd>" : "") +
        (i.review && i.review.by ? "<dt>" + esc(T(c, "site.maik.reviewedByLabel", "Reviewed by")) + "</dt><dd>" + EN(c, esc(i.review.by)) + (i.review.reason ? " (" + EN(c, esc(i.review.reason)) + ")" : "") + "</dd>" : "") + "</dl>" +
        (i.output && rv === "pending" && c.can("emr.treat") ? '<div class="row" style="margin-top:12px"><button class="btn" id="mkAcc" type="button">' + ms("check") + esc(T(c, "site.maik.acceptButton", "Accept")) + '</button><label class="f"><span>' + esc(T(c, "site.maik.rejectReasonLabel", "Reason (for reject)")) + '</span><input id="mkWhy" maxlength="200"></label><button class="btn danger" id="mkRej" type="button">' + ms("close") + esc(T(c, "site.maik.rejectButton", "Reject")) + "</button></div>" : "");
      var acc = document.getElementById("mkAcc"), rej = document.getElementById("mkRej");
      var review = function (decision) {
        var reason = (document.getElementById("mkWhy").value || "").trim();
        if (decision === "rejected" && !reason) { c.toast(T(c, "site.maik.sayWhyRejecting", "Say why you are rejecting it.")); return; }
        c.api("/ward/maik-review", { orgId: st.orgId, interactionId: i.id, decision: decision, reason: reason || undefined }).then(function (r) {
          if (r && r.ok && r.interaction) { S.i = r.interaction; paintOut(); c.toast(T(c, "site.maik.reviewRecorded", "Review recorded.")); }
          else c.toast((r && (r.detail || r.error)) || T(c, "site.maik.reviewNotRecorded", "The review could not be recorded."));
        });
      };
      if (acc) acc.onclick = function () { review("accepted"); };
      if (rej) rej.onclick = function () { review("rejected"); };
    }
    Promise.all([c.api("/ward/list" + q), c.api("/ward/ed-list" + q)]).then(function (rs) {
      var w = rs[0], e = rs[1], list = document.getElementById("mkList");
      var rows = [];
      if (w && w.ok) (w.patients || []).forEach(function (p) { rows.push({ patientId: p.patientId, encounterId: p.encounterId, name: p.name || p.display || p.patientId, where: (p.ward || "ward") + (p.bed ? " " + p.bed : "") }); });
      if (e && e.ok) (e.patients || []).forEach(function (p) { rows.push({ patientId: p.patientId, encounterId: p.encounterId, name: p.name || p.display || p.patientId, where: "ED" }); });
      S.patients = rows;
      if (!rows.length) {
        var listErr = (w && w.error) || (e && e.error);
        list.innerHTML = '<div class="msg note">' + ((w && !w.ok) || (e && !e.ok) ? (listErr ? EN(c, esc(listErr)) : esc(T(c, "site.maik.listsUnreadable", "The lists could not be read."))) : esc(T(c, "site.maik.noPatients", "No admitted or ED patients right now. MaiK works on a live encounter."))) + "</div>";
        return;
      }
      list.innerHTML = '<div class="tbl"><table><thead><tr><th>' + esc(T(c, "site.maik.colPatient", "Patient")) + '</th><th>' + esc(T(c, "site.maik.colWhere", "Where")) + '</th><th></th></tr></thead><tbody>' + rows.map(function (p, ix) {
        // LT-40: the internal record id under every name was noise to a clinician; the ward and bed tell patients apart.
        return "<tr><td><b>" + EN(c, esc(p.name)) + "</b></td><td>" + EN(c, esc(p.where)) + '</td><td><button class="btn quiet" type="button" data-ix="' + ix + '">' + esc(T(c, "site.maik.chooseButton", "Choose")) + '</button></td></tr>';
      }).join("") + "</tbody></table></div>";
      list.querySelectorAll("[data-ix]").forEach(function (b) { b.onclick = function () { S.sel = rows[Number(b.getAttribute("data-ix"))]; S.i = null; S.err = ""; paintAsk(); paintOut(); document.getElementById("mkAsk").scrollIntoView({ behavior: "smooth", block: "start" }); }; });
    });
  } });
})();
