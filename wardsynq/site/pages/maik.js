/* wardsynq/site/pages/maik.js - MaiK, the governed clinical AI, for one admitted or ED patient.
 *
 * Same route the ward chart uses (POST /ward/maik-ask), same review route (POST /ward/maik-review).
 * The patient is picked from the hospital's live inpatient and ED lists, never typed, so the
 * question is always bound to a real record id and encounter. Whatever the server withholds stays
 * withheld here: this page renders the interaction record, it does not soften it. */
(function () {
  "use strict";
  var TASKS = [["summarise", "Summarise this admission"], ["draft-note", "Draft a progress note"], ["explain", "Explain the current picture"], ["extract", "Extract key facts"]];
  WSQ.page("maik", { render: function (c) {
    var el = c.el, st = c.state, esc = c.esc, ms = c.ms;
    if (!c.isWardsynq()) { el.innerHTML = '<div class="msg note">MaiK reads the WardSynQ clinical record. This hospital does not keep one.</div>'; return; }
    if (!c.can("emr.view")) { el.innerHTML = '<div class="msg note">Your role (' + esc(st.who.role) + ") does not include emr.view.</div>"; return; }
    var q = "?orgId=" + encodeURIComponent(st.orgId);
    var S = { patients: [], sel: null, task: "summarise", busy: false, i: null, err: "" };
    el.innerHTML =
      '<div class="title"><h1>MaiK clinical AI</h1><span class="sub">governed, reviewed by you, never a second source of truth</span></div>' +
      '<div class="msg note">MaiK drafts from the record and its answers are unsigned until a clinician accepts them. Every interaction is written to the record with its model, sources and your review. Clinical content in this build is not yet signed off by a hospital committee.</div>' +
      '<div class="card"><h2>Patient</h2><div id="mkList"><span class="spin"></span></div></div>' +
      '<div class="card" id="mkAsk" hidden></div><div class="card" id="mkOut" hidden></div>';
    function paintAsk() {
      var ask = document.getElementById("mkAsk"); if (!S.sel) { ask.hidden = true; return; }
      ask.hidden = false;
      ask.innerHTML = "<h2>" + esc(S.sel.name || S.sel.patientId) + ' <span class="pill">' + esc(S.sel.where) + "</span></h2>" +
        '<div class="row"><label class="f"><span>Task</span><select id="mkTask">' + TASKS.map(function (t) { return '<option value="' + t[0] + '"' + (t[0] === S.task ? " selected" : "") + ">" + esc(t[1]) + "</option>"; }).join("") + "</select></label>" +
        '<label class="f" style="flex:2 1 260px"><span>Question (optional)</span><input id="mkQ" maxlength="400" placeholder="e.g. what changed since yesterday?"></label>' +
        '<button class="btn" id="mkGo" type="button"' + (S.busy ? " disabled" : "") + ">" + ms("psychology") + (S.busy ? "Asking" : "Ask MaiK") + "</button></div>" +
        (S.err ? '<div class="msg err">' + esc(S.err) + "</div>" : "");
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
        else S.err = (r && (r.detail || r.message || r.error)) || "MaiK could not be reached.";
        paintAsk(); paintOut();
      });
    }
    function paintOut() {
      var o = document.getElementById("mkOut"), i = S.i; if (!i) { o.hidden = true; return; }
      o.hidden = false;
      var rv = i.review && i.review.state ? i.review.state : "pending";
      o.innerHTML = "<h2>Answer <span class=\"pill " + (i.output ? "ok" : "stop") + "\">" + (i.output ? "released" : "withheld") + "</span> <span class=\"pill " + (rv === "accepted" ? "ok" : rv === "rejected" ? "stop" : "warn") + "\">review: " + esc(rv) + "</span></h2>" +
        (i.output ? '<div class="mono" style="font-family:inherit;font-size:14.5px">' + esc(i.output) + "</div>" :
          '<div class="msg err">MaiK withheld this answer' + (i.withheld && i.withheld.violations ? ": " + esc(i.withheld.violations.join(", ")) : "") + ". Nothing was shown to you that the safety screen refused.</div>") +
        '<dl class="kv" style="margin-top:12px"><dt>Interaction</dt><dd class="mono">' + esc(i.id) + "</dd>" +
        (i.model ? "<dt>Model</dt><dd>" + esc(i.model.model || "") + (i.model.version ? " " + esc(i.model.version) : "") + "</dd>" : "") +
        "<dt>Task</dt><dd>" + esc(i.task || S.task) + "</dd>" +
        (i.sources && i.sources.length ? "<dt>Sources</dt><dd>" + esc(i.sources.length) + " signed record documents</dd>" : "") +
        (i.review && i.review.by ? "<dt>Reviewed by</dt><dd>" + esc(i.review.by) + (i.review.reason ? " (" + esc(i.review.reason) + ")" : "") + "</dd>" : "") + "</dl>" +
        (i.output && rv === "pending" && c.can("emr.treat") ? '<div class="row" style="margin-top:12px"><button class="btn" id="mkAcc" type="button">' + ms("check") + 'Accept</button><label class="f"><span>Reason (for reject)</span><input id="mkWhy" maxlength="200"></label><button class="btn danger" id="mkRej" type="button">' + ms("close") + "Reject</button></div>" : "");
      var acc = document.getElementById("mkAcc"), rej = document.getElementById("mkRej");
      var review = function (decision) {
        var reason = (document.getElementById("mkWhy").value || "").trim();
        if (decision === "rejected" && !reason) { c.toast("Say why you are rejecting it."); return; }
        c.api("/ward/maik-review", { orgId: st.orgId, interactionId: i.id, decision: decision, reason: reason || undefined }).then(function (r) {
          if (r && r.ok && r.interaction) { S.i = r.interaction; paintOut(); c.toast("Review recorded."); }
          else c.toast((r && (r.detail || r.error)) || "The review could not be recorded.");
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
      if (!rows.length) { list.innerHTML = '<div class="msg note">' + ((w && !w.ok) || (e && !e.ok) ? esc((w && w.error) || (e && e.error) || "The lists could not be read.") : "No admitted or ED patients right now. MaiK works on a live encounter.") + "</div>"; return; }
      list.innerHTML = '<div class="tbl"><table><thead><tr><th>Patient</th><th>Where</th><th></th></tr></thead><tbody>' + rows.map(function (p, ix) {
        return "<tr><td><b>" + esc(p.name) + "</b><br><span class=\"quiet mono\">" + esc(p.patientId) + "</span></td><td>" + esc(p.where) + '</td><td><button class="btn quiet" type="button" data-ix="' + ix + '">Choose</button></td></tr>';
      }).join("") + "</tbody></table></div>";
      list.querySelectorAll("[data-ix]").forEach(function (b) { b.onclick = function () { S.sel = rows[Number(b.getAttribute("data-ix"))]; S.i = null; S.err = ""; paintAsk(); paintOut(); document.getElementById("mkAsk").scrollIntoView({ behavior: "smooth", block: "start" }); }; });
    });
  } });
})();
