/* StewardMD - ResearchMD Conflicts Screen (window.SMD_RESEARCH.screens.conflicts).
 * ES5 only, buildless, mobile-first. Phase 2.5: conflict list and resolution,
 * tablet-first two-pane; phone views and approves. Both votes are unblinded
 * here because a conflict only exists once both reviewers have decided
 * (contracts/phase-2/blinding.md B3/B4). Resolution is owner/editor only.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  };

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    conflicts: [],
    nextCursor: null,
    records: {},
    reports: {},
    reasons: [],
    currentId: null,
    votes: null,
    votesLoading: false,
    reasonFor: null,
    note: "",
    busy: false,
    resolveError: null,
    announce: "",
    phoneView: "detail"
  };
  var seq = 0;

  function p2() { return SMD.p2 || {}; }

  function currentConflict() {
    for (var i = 0; i < st.conflicts.length; i++) {
      if (st.conflicts[i].id === st.currentId) return st.conflicts[i];
    }
    return st.conflicts.length ? st.conflicts[0] : null;
  }

  function conflictRecord(conf) {
    if (!conf) return null;
    if (conf.recordId) return st.records[conf.recordId] || null;
    var rep = st.reports[conf.reportId];
    if (rep && rep.recordId) return st.records[rep.recordId] || null;
    return null;
  }

  function decisionsPath(conf) {
    if (conf.recordId) return "/v1/records/" + encodeURIComponent(conf.recordId) + "/decisions";
    return "/v1/reports/" + encodeURIComponent(conf.reportId) + "/decisions";
  }

  function load(container, cursor) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var pid = encodeURIComponent(st.projectId);
    var path = "/v1/projects/" + pid + "/conflicts?limit=100";
    if (cursor) path += "&cursor=" + encodeURIComponent(cursor);
    var lists = cursor ? [SMD.api.request("GET", path)] : [
      SMD.api.request("GET", path),
      SMD.api.request("GET", "/v1/projects/" + pid + "/records?limit=100"),
      SMD.api.request("GET", "/v1/projects/" + pid + "/reports?limit=100"),
      SMD.api.request("GET", "/v1/projects/" + pid + "/exclusion-reasons")
    ];
    Promise.all(lists).then(function (res) {
      if (mySeq !== seq) return;
      var confs = (res[0] && res[0].conflicts) || [];
      st.conflicts = cursor ? st.conflicts.concat(confs) : confs;
      st.nextCursor = (res[0] && res[0].nextCursor) || null;
      if (!cursor) {
        var i;
        var recs = (res[1] && res[1].records) || [];
        for (i = 0; i < recs.length; i++) st.records[recs[i].id] = recs[i];
        var reps = (res[2] && res[2].reports) || [];
        for (i = 0; i < reps.length; i++) st.reports[reps[i].id] = reps[i];
        st.reasons = (res[3] && res[3].reasons) || [];
      }
      st.loaded = true;
      st.loading = false;
      if (!st.currentId && st.conflicts.length) st.currentId = st.conflicts[0].id;
      st.votesLoading = st.conflicts.length > 0;
      render(container);
      var cur = currentConflict();
      if (cur) loadVotes(container, cur);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function loadVotes(container, conf) {
    var mySeq = ++seq;
    st.votesLoading = true;
    st.votes = null;
    SMD.api.request("GET", decisionsPath(conf)).then(function (data) {
      if (mySeq !== seq) return;
      st.votesLoading = false;
      st.votes = data;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.votesLoading = false;
      st.resolveError = err;
      render(container);
    });
  }

  function selfVoted() {
    var votes = (st.votes && st.votes.votes) || [];
    for (var i = 0; i < votes.length; i++) {
      if (votes[i].reviewer === "self" && votes[i].decision !== "hidden") return true;
    }
    return false;
  }

  function resolve(container, conf, resolution, reasonCode) {
    if (st.busy) return;
    if (selfVoted() && !st.note.trim()) {
      st.resolveError = { message: "You voted on this item. Record in the note why you are resolving it (no non-voter owner or editor available).", code: "resolver_note" };
      render(container);
      return;
    }
    st.busy = true;
    st.resolveError = null;
    st.reasonFor = null;
    render(container);
    var mySeq = ++seq;
    var body = { resolution: resolution };
    if (reasonCode) body.reasonCode = reasonCode;
    if (st.note.trim()) body.note = st.note.trim();
    SMD.api.request("POST", "/v1/conflicts/" + encodeURIComponent(conf.id) + "/resolve", body).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      var resolved = data.conflict;
      for (var i = 0; i < st.conflicts.length; i++) {
        if (st.conflicts[i].id === resolved.id) { st.conflicts[i] = resolved; break; }
      }
      st.note = "";
      st.announce = "Conflict resolved: " + resolution + (resolution === "exclude" && reasonCode ? " (" + p2().reasonLabel(reasonCode, st.reasons) + ")" : "") + ". Both votes stay stored for audit.";
      render(container);
      loadVotes(container, resolved);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.resolveError = err;
      render(container);
    });
  }

  function voteLineHtml(v) {
    var who = v.reviewer === "self" ? "You" : "Reviewer 2";
    var h = '<div class="rmd-vote-line"><span class="rmd-vote-who">' + who + '</span>';
    if (v.decision === "hidden" || v.visible === false) {
      h += '<span class="rmd-peer-hidden">Hidden</span>';
    } else {
      h += '<span class="rmd-decision-' + esc(v.decision) + '">' + esc(v.decision) + '</span>';
      if (v.reasonCode) h += '<span class="rmd-muted">' + esc(p2().reasonLabel(v.reasonCode, st.reasons)) + '</span>';
      if (v.createdTs) h += '<span class="rmd-muted">' + esc(p2().fmtTs(v.createdTs)) + '</span>';
    }
    h += '</div>';
    return h;
  }

  function renderDetail(conf, role) {
    var rec = conflictRecord(conf) || {};
    var canResolve = (role === "owner" || role === "editor") && conf.status === "open";
    var h = [];
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-item-meta">');
    h.push('<span class="rmd-badge rmd-badge-soft">' + (conf.stage === "title_abstract" ? "Title &amp; abstract" : "Full text") + '</span>');
    h.push(conf.status === "open"
      ? '<span class="rmd-badge rmd-badge-neutral">Open</span>'
      : '<span class="rmd-badge rmd-badge-pill">Resolved</span>');
    h.push('<span class="rmd-muted">' + esc(p2().fmtTs(conf.createdTs)) + '</span>');
    h.push('</div>');
    h.push('<h3 class="rmd-item-title">' + esc(rec.title || conf.recordId || conf.reportId) + '</h3>');
    if (rec.year || rec.source) h.push('<p class="rmd-muted">' + (rec.year ? rec.year + " · " : "") + esc(rec.source || "") + '</p>');

    h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Both Votes (unblinded: both reviewers decided)</h4>');
    if (st.votesLoading) {
      h.push(p2().loadingHtml("Loading votes"));
    } else if (st.votes) {
      h.push('<div class="rmd-votes-box">');
      var votes = st.votes.votes || [];
      for (var i = 0; i < votes.length; i++) h.push(voteLineHtml(votes[i]));
      if (!votes.length) h.push('<p class="rmd-muted">No votes visible for your role.</p>');
      h.push('</div>');
    }
    h.push('</div>');

    if (conf.status === "resolved") {
      h.push('<div class="rmd-lock-box">');
      h.push('<strong>Resolved: ' + esc(conf.resolution) + '</strong>');
      if (conf.resolutionReason) h.push('<span>Reason: ' + esc(p2().reasonLabel(conf.resolutionReason, st.reasons)) + '</span>');
      h.push('<span class="rmd-muted">By ' + esc(conf.resolvedBy || "") + ' · ' + esc(p2().fmtTs(conf.resolvedTs)) + '</span>');
      h.push('</div>');
    }

    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
    if (st.resolveError) h.push(p2().errHtml(st.resolveError, null));

    if (canResolve) {
      if (selfVoted()) {
        h.push('<div class="rmd-banner rmd-banner-warn">You voted on this item. Resolve only if no non-voter owner or editor is available, and record that fact in the note.</div>');
      }
      if (st.reasonFor === "exclude") {
        h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Exclusion Reason (required)</h4>');
        h.push('<div class="rmd-reason-grid">');
        for (var r = 0; r < st.reasons.length; r++) {
          h.push('<button type="button" class="rmd-reason-chip" data-rmd-resolve-reason="' + esc(st.reasons[r].code) + '">' + esc(st.reasons[r].label || st.reasons[r].code) + '</button>');
        }
        h.push('</div>');
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="resolve-cancel-reason">Cancel</button>');
        h.push('</div>');
      } else {
        h.push('<div class="rmd-field"><label for="rmd_resolve_note">Resolution Note (optional' + (selfVoted() ? ", required for voters" : "") + ')</label>');
        h.push('<textarea id="rmd_resolve_note" rows="2" maxlength="2000" placeholder="Why this resolution is correct…">' + esc(st.note) + '</textarea></div>');
        h.push('<div class="rmd-vote-bar" style="grid-template-columns:1fr 1fr">');
        h.push('<button type="button" class="rmd-vote-btn rmd-vote-include" data-rmd-resolve="include"' + (st.busy ? " disabled" : "") + '>' + (st.busy ? "Resolving…" : "Resolve: Include") + '</button>');
        h.push('<button type="button" class="rmd-vote-btn rmd-vote-exclude" data-rmd-resolve="exclude"' + (st.busy ? " disabled" : "") + '>Resolve: Exclude</button>');
        h.push('</div>');
        h.push('<p class="rmd-muted">The resolution wins. Both votes stay stored for audit and become visible to the team.</p>');
      }
    } else if (conf.status === "open") {
      h.push('<p class="rmd-muted">Only an owner or editor can resolve conflicts. You can review both votes here.</p>');
    }

    h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-screening">Back to Screening</button></div>');
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to review its screening conflicts.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.conflicts = [];
      st.nextCursor = null;
      st.records = {};
      st.reports = {};
      st.reasons = [];
      st.currentId = null;
      st.votes = null;
      st.reasonFor = null;
      st.note = "";
      st.resolveError = null;
      st.announce = "";
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading conflicts") + '</div>';
      load(container);
      return;
    }

    var role = project.role || "owner";
    var conf = currentConflict();
    var openCount = 0;
    for (var o = 0; o < st.conflicts.length; o++) {
      if (st.conflicts[o].status === "open") openCount++;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar">');
    h.push('<div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Conflicts</h2>');
    h.push('<span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div>');
    h.push('<div class="rmd-topbar-actions"><span class="rmd-badge rmd-badge-neutral">' + openCount + ' open</span></div>');
    h.push('</div>');

    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "conf-retry") + '</div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "list" ? " rmd-seg-active" : "") + '" data-rmd-conf-view="list">Conflicts (' + st.conflicts.length + ')</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "detail" ? " rmd-seg-active" : "") + '" data-rmd-conf-view="detail">Resolve</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');

    h.push('<div class="rmd-pane-left' + (st.phoneView !== "list" ? " rmd-phone-hidden" : "") + '">');
    if (st.loading) h.push(p2().loadingHtml("Loading conflicts"));
    if (!st.conflicts.length && st.loaded && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>No conflicts</h3><p>Conflicts open automatically when both reviewers disagree or either votes uncertain. Nothing needs resolving right now.</p>');
      h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-screening">Back to Screening</button></div>');
    }
    h.push('<div role="list">');
    for (var i = 0; i < st.conflicts.length; i++) {
      var c = st.conflicts[i];
      var rec = conflictRecord(c) || {};
      var sel = conf && c.id === conf.id;
      h.push('<button type="button" class="rmd-row-btn' + (sel ? " rmd-row-selected" : "") + '" data-rmd-conf="' + esc(c.id) + '" role="listitem">');
      h.push('<span class="rmd-row-title">' + esc(rec.title || c.recordId || c.reportId) + '</span>');
      h.push('<span class="rmd-row-meta">' + (c.stage === "title_abstract" ? "Title &amp; abstract" : "Full text") + ' · ' + (c.status === "open" ? "Open" : "Resolved: " + esc(c.resolution || "")) + ' · ' + esc(p2().fmtTs(c.createdTs)) + '</span>');
      h.push('</button>');
    }
    h.push('</div>');
    if (st.nextCursor) h.push('<div style="padding:12px 16px"><button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="conf-more">Load More</button></div>');
    h.push('</div>');

    h.push('<div class="rmd-pane-right' + (st.phoneView !== "detail" ? " rmd-phone-hidden" : "") + '">');
    if (conf) {
      h.push(renderDetail(conf, role));
    } else if (st.loaded && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>Nothing to resolve</h3><p>When a conflict opens it appears here with both votes.</p></div>');
    }
    h.push('</div>');

    h.push('</div></div>');
    container.innerHTML = h.join("\n");
    bindEvents(container, project);
  }

  function bindEvents(container, project) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="to-screening"]', function () { SMD.navigate("screening", {}); });
    on('[data-rmd="conf-retry"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="conf-more"]', function () { load(container, st.nextCursor); });
    on('[data-rmd="resolve-cancel-reason"]', function () { st.reasonFor = null; render(container); });

    var viewBtns = container.querySelectorAll("[data-rmd-conf-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-conf-view");
        render(container);
      };
    }

    var confBtns = container.querySelectorAll("[data-rmd-conf]");
    for (var i = 0; i < confBtns.length; i++) {
      confBtns[i].onclick = function () {
        st.currentId = this.getAttribute("data-rmd-conf");
        st.reasonFor = null;
        st.resolveError = null;
        st.announce = "";
        st.note = "";
        st.phoneView = "detail";
        st.votes = null;
        st.votesLoading = true;
        render(container);
        var conf = currentConflict();
        if (conf) loadVotes(container, conf);
      };
    }

    var note = container.querySelector("#rmd_resolve_note");
    if (note) note.oninput = function () { st.note = this.value; };

    var resolveBtns = container.querySelectorAll("[data-rmd-resolve]");
    for (var b = 0; b < resolveBtns.length; b++) {
      resolveBtns[b].onclick = function () {
        var resolution = this.getAttribute("data-rmd-resolve");
        var conf = currentConflict();
        if (!conf) return;
        if (resolution === "exclude") {
          st.reasonFor = "exclude";
          render(container);
        } else {
          resolve(container, conf, "include", null);
        }
      };
    }

    var reasonBtns = container.querySelectorAll("[data-rmd-resolve-reason]");
    for (var r = 0; r < reasonBtns.length; r++) {
      reasonBtns[r].onclick = function () {
        var conf = currentConflict();
        if (conf) resolve(container, conf, "exclude", this.getAttribute("data-rmd-resolve-reason"));
      };
    }
  }

  SMD.screens.conflicts = {
    render: render
  };

})(typeof window !== "undefined" ? window : globalThis);