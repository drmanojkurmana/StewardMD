/* StewardMD - ResearchMD Screening Screen (window.SMD_RESEARCH.screens.screening).
 * ES5 only, buildless, mobile-first. Phase 2.5: title/abstract then full-text
 * queue, include/exclude/uncertain with coded reasons, blinded dual review
 * (peer vote hidden until both decide, per contracts/phase-2/blinding.md),
 * one-hand phone flow and two-pane tablet layout.
 * Record/report list endpoints follow the Phase 1 pagination convention;
 * their response schemas are owned by the 2.5 API builder.
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
    stage: "title_abstract",
    records: [],
    reports: [],
    reasons: [],
    dupRemoved: {},
    currentId: null,
    votes: null,
    votesLoading: false,
    seen: {},
    filter: "all",
    phoneView: "current",
    reasonFor: null,
    busy: false,
    voteError: null,
    announce: "",
    ai: null,
    suggestion: null
  };
  var seq = 0;

  function p2() { return SMD.p2 || {}; }

  function itemKey(stage, id) { return stage + ":" + id; }

  function recordById(id) {
    for (var i = 0; i < st.records.length; i++) {
      if (st.records[i].id === id) return st.records[i];
    }
    return null;
  }

  function queueItems() {
    var items = [];
    var i;
    if (st.stage === "title_abstract") {
      for (i = 0; i < st.records.length; i++) {
        var rec = st.records[i];
        if (st.dupRemoved[rec.id]) continue;
        items.push({ id: rec.id, record: rec, report: null });
      }
    } else {
      for (i = 0; i < st.reports.length; i++) {
        var rep = st.reports[i];
        items.push({ id: rep.id, record: recordById(rep.recordId), report: rep });
      }
    }
    return items;
  }

  function filteredItems() {
    var items = queueItems();
    if (st.filter === "all") return items;
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var outcome = st.seen[itemKey(st.stage, items[i].id)];
      var done = outcome === "include" || outcome === "exclude";
      if (st.filter === "done" && done) out.push(items[i]);
      if (st.filter === "todo" && !done) out.push(items[i]);
    }
    return out;
  }

  function currentItem() {
    var items = queueItems();
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === st.currentId) return items[i];
    }
    return items.length ? items[0] : null;
  }

  /* The list routes cap a page at 100. A real review can identify hundreds of
   * records, so walk every page before screening; otherwise records after the
   * first 100 can never be seen or voted on. */
  function fetchAllPages(path, key) {
    var out = [];
    var cursor = null;
    var pages = 0;
    function next() {
      var url = path + "?limit=100" + (cursor ? "&cursor=" + encodeURIComponent(cursor) : "");
      return SMD.api.request("GET", url).then(function (data) {
        out = out.concat((data && data[key]) || []);
        cursor = data && data.nextCursor;
        pages++;
        if (cursor && pages < 100) return next();
        return out;
      });
    }
    return next();
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var pid = encodeURIComponent(st.projectId);
    var base = "/v1/projects/" + pid;
    Promise.all([
      fetchAllPages(base + "/records", "records"),
      fetchAllPages(base + "/reports", "reports"),
      SMD.api.request("GET", base + "/exclusion-reasons"),
      fetchAllPages(base + "/dedup-groups", "groups")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.records = res[0] || [];
      st.reports = res[1] || [];
      st.reasons = (res[2] && res[2].reasons) || [];
      st.dupRemoved = {};
      var groups = res[3] || [];
      for (var g = 0; g < groups.length; g++) {
        var members = groups[g].memberIds || [];
        for (var m = 0; m < members.length; m++) {
          if (members[m] !== groups[g].canonicalRecordId) st.dupRemoved[members[m]] = true;
        }
      }
      st.loaded = true;
      st.loading = false;
      if (!st.currentId) {
        var items = queueItems();
        st.currentId = items.length ? items[0].id : null;
      }
      st.votesLoading = !!st.currentId;
      render(container);
      if (st.currentId) loadVotes(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function decisionsPath(item) {
    if (st.stage === "title_abstract") return "/v1/records/" + encodeURIComponent(item.id) + "/decisions";
    return "/v1/reports/" + encodeURIComponent(item.id) + "/decisions";
  }

  function loadVotes(container) {
    var item = currentItem();
    if (!item) { st.votes = null; return; }
    var mySeq = ++seq;
    st.votesLoading = true;
    st.votes = null;
    SMD.api.request("GET", decisionsPath(item)).then(function (data) {
      if (mySeq !== seq) return;
      st.votesLoading = false;
      st.votes = data;
      st.seen[itemKey(st.stage, item.id)] = data.outcome;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.votesLoading = false;
      st.voteError = err;
      render(container);
    });
  }

  function selectItem(container, id) {
    st.currentId = id;
    st.reasonFor = null;
    st.voteError = null;
    st.suggestion = null;
    st.phoneView = "current";
    st.votes = null;
    st.votesLoading = true;
    render(container);
    loadVotes(container);
  }

  function advance(container) {
    var items = filteredItems();
    var idx = -1;
    for (var i = 0; i < items.length; i++) {
      if (items[i].id === st.currentId) { idx = i; break; }
    }
    var next = items[idx + 1];
    if (!next) {
      var all = queueItems();
      for (var j = 0; j < all.length; j++) {
        if (!st.seen[itemKey(st.stage, all[j].id)]) { next = all[j]; break; }
      }
    }
    if (next) {
      selectItem(container, next.id);
    } else {
      st.announce = "End of the queue. Every item in this stage has a vote.";
      render(container);
    }
  }

  function submitVote(container, decision, reasonCode) {
    var item = currentItem();
    if (!item || st.busy) return;
    st.busy = true;
    st.voteError = null;
    st.reasonFor = null;
    render(container);
    var mySeq = ++seq;
    var body = { decision: decision };
    if (reasonCode) body.reasonCode = reasonCode;
    var key = itemKey(st.stage, item.id);
    SMD.api.request("POST", decisionsPath(item), body).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.seen[key] = data.outcome;
      if (data.outcome === "conflict") {
        st.announce = "Conflict opened. Both reviewers have now voted, so both votes are visible to you. An owner or editor resolves it on the Conflicts screen.";
        render(container);
        loadVotes(container);
        return;
      }
      if (data.outcome === "include" || data.outcome === "exclude") {
        st.announce = "Vote saved. Both reviewers agree: " + data.outcome + "d.";
      } else {
        st.announce = "Vote saved. Waiting for the second reviewer.";
      }
      advance(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.voteError = err;
      render(container);
    });
  }

  function outcomeBadge(outcome) {
    if (outcome === "include") return '<span class="rmd-badge rmd-badge-pill">Included</span>';
    if (outcome === "exclude") return '<span class="rmd-badge rmd-badge-soft">Excluded</span>';
    if (outcome === "conflict") return '<span class="rmd-badge rmd-badge-neutral">Conflict</span>';
    return "";
  }

  function voteLineHtml(v) {
    var who = v.reviewer === "self" ? "You" : "Reviewer 2";
    var h = '<div class="rmd-vote-line"><span class="rmd-vote-who">' + who + '</span>';
    if (v.decision === "hidden" || v.visible === false) {
      h += '<span class="rmd-peer-hidden">Hidden until both reviewers decide</span>';
    } else {
      h += '<span class="rmd-decision-' + esc(v.decision) + '">' + esc(v.decision) + '</span>';
      if (v.reasonCode) h += '<span class="rmd-muted">' + esc(p2().reasonLabel(v.reasonCode, st.reasons)) + '</span>';
      if (v.createdTs) h += '<span class="rmd-muted">' + esc(p2().fmtTs(v.createdTs)) + '</span>';
    }
    h += '</div>';
    return h;
  }

  function renderVotesBox() {
    var h = [];
    h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Blinded Votes</h4>');
    if (st.votesLoading) {
      h.push(p2().loadingHtml("Loading votes"));
    } else if (st.votes) {
      h.push('<div class="rmd-votes-box" aria-live="polite">');
      var votes = st.votes.votes || [];
      var selfSeen = false;
      var peerSeen = false;
      for (var i = 0; i < votes.length; i++) {
        h.push(voteLineHtml(votes[i]));
        if (votes[i].reviewer === "self") selfSeen = true;
        if (votes[i].reviewer === "peer") peerSeen = true;
      }
      if (!selfSeen) h.push('<div class="rmd-vote-line"><span class="rmd-vote-who">You</span><span class="rmd-muted">No vote yet</span></div>');
      if (!peerSeen) h.push('<div class="rmd-vote-line"><span class="rmd-vote-who">Reviewer 2</span><span class="rmd-peer-hidden">Hidden until both reviewers decide</span></div>');
      h.push('</div>');
      if (st.votes.outcome) {
        h.push('<p class="rmd-muted">Outcome: <strong>' + esc(st.votes.outcome) + '</strong>' + (st.votes.outcome === "pending" ? " (waiting for both reviewers)" : "") + '</p>');
      }
    }
    h.push('</div>');
    return h.join("\n");
  }

  function suggestionHtml() {
    var sug = st.suggestion;
    if (!sug) return "";
    var h = [];
    h.push('<div class="rmd-section-block rmd-ai-suggestion">');
    h.push('<h4 class="rmd-section-label">MaiK suggestion</h4>');
    h.push(SMD.ai.noteHtml(st.ai, "suggestion"));
    h.push('<p class="rmd-muted">Suggested decision: <strong>' + esc(sug.decision || "") + '</strong>' + (sug.reasonCode ? ' &middot; ' + esc(p2().reasonLabel(sug.reasonCode, st.reasons)) : '') + '</p>');
    if (sug.rationale) h.push('<p class="rmd-muted">' + esc(sug.rationale) + '</p>');
    h.push('<p class="rmd-muted">This is a draft. Record your own vote below.</p>');
    h.push('</div>');
    return h.join("\n");
  }

  function renderItemDetail(item, role) {
    var rec = item.record || {};
    var rep = item.report;
    var canVote = role === "owner" || role === "editor" || role === "analyst" || role === "reviewer";
    var notRetrieved = rep && rep.status === "not_retrieved";
    var authors = rec.authors || [];
    var abstract = rec.abstract || (rec.metadata && rec.metadata.abstract) || "";
    var h = [];
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-item-meta">');
    h.push('<span class="rmd-badge rmd-badge-soft">' + esc(rec.source || "record") + '</span>');
    if (rec.year) h.push('<span>' + rec.year + '</span>');
    if (rep) h.push('<span class="rmd-badge rmd-badge-neutral">' + esc(rep.status) + '</span>');
    h.push(outcomeBadge(st.seen[itemKey(st.stage, item.id)]));
    h.push('</div>');
    h.push('<h3 class="rmd-item-title">' + esc(rec.title || "Untitled record") + '</h3>');
    if (authors.length) h.push('<p class="rmd-muted">' + esc(authors.join(", ")) + '</p>');
    var ids = [];
    if (rec.externalId) ids.push(rec.externalId);
    if (rec.doi) ids.push("DOI " + rec.doi);
    if (ids.length) h.push('<p class="rmd-mono-sm rmd-muted" translate="no">' + esc(ids.join(" · ")) + '</p>');

    if (st.stage === "title_abstract") {
      if (abstract) {
        h.push('<div class="rmd-abstract-box">' + esc(abstract) + '</div>');
      } else {
        h.push('<p class="rmd-muted">No abstract stored for this record. Screen on the title, or seek the full text before deciding.</p>');
      }
    } else if (notRetrieved) {
      h.push('<div class="rmd-banner rmd-banner-warn">Full text was not retrieved. This report counts under PRISMA "reports not retrieved" and cannot be assessed until retrieval.</div>');
    } else {
      h.push('<p class="rmd-muted">Full-text stage: assess eligibility against the locked protocol. The full text viewer arrives in Phase 3; record your vote from the retrieved document.</p>');
    }

    h.push(renderVotesBox());

    if (st.voteError) {
      h.push(p2().errHtml(st.voteError, null));
      if (st.voteError.code === "conflict_open") {
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-conflicts">Open Conflicts</button>');
      }
    }
    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');

    if (canVote && !notRetrieved) {
      if (st.reasonFor === "exclude") {
        h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Exclusion Reason (required)</h4>');
        h.push('<div class="rmd-reason-grid">');
        for (var r = 0; r < st.reasons.length; r++) {
          h.push('<button type="button" class="rmd-reason-chip" data-rmd-reason="' + esc(st.reasons[r].code) + '">' + esc(st.reasons[r].label || st.reasons[r].code) + '</button>');
        }
        h.push('</div>');
        if (!st.reasons.length) h.push('<p class="rmd-muted">No exclusion codes loaded. Retry the screen to load reasons.</p>');
        h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="vote-cancel-reason">Cancel</button>');
        h.push('</div>');
      } else {
        if (!st.ai) st.ai = SMD.ai.state();
        h.push(SMD.ai.barHtml(st.ai, { task: "screening", label: "screening suggestion" }));
        if (st.suggestion) h.push(suggestionHtml());
        h.push('<div class="rmd-vote-bar">');
        h.push('<button type="button" class="rmd-vote-btn rmd-vote-include" data-rmd-vote="include"' + (st.busy ? " disabled" : "") + '>Include</button>');
        h.push('<button type="button" class="rmd-vote-btn rmd-vote-uncertain" data-rmd-vote="uncertain"' + (st.busy ? " disabled" : "") + '>Uncertain</button>');
        h.push('<button type="button" class="rmd-vote-btn rmd-vote-exclude" data-rmd-vote="exclude"' + (st.busy ? " disabled" : "") + '>Exclude</button>');
        h.push('</div>');
        h.push('<p class="rmd-muted">Your vote is independent. The other reviewer cannot see it until you both decide.</p>');
      }
    } else if (!canVote) {
      h.push('<p class="rmd-muted">Viewers see outcomes only, not votes.</p>');
    }

    h.push('<div class="rmd-card-actions">');
    h.push('<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="screen-skip">Skip to Next</button>');
    h.push('</div>');
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to screen its records.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.records = [];
      st.reports = [];
      st.reasons = [];
      st.dupRemoved = {};
      st.currentId = null;
      st.votes = null;
      st.seen = {};
      st.filter = "all";
      st.reasonFor = null;
      st.voteError = null;
      st.announce = "";
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading screening queue") + '</div>';
      load(container);
      return;
    }

    var role = project.role || "owner";
    var items = filteredItems();
    var allItems = queueItems();
    var item = currentItem();
    var idx = -1;
    for (var i = 0; i < allItems.length; i++) {
      if (item && allItems[i].id === item.id) { idx = i; break; }
    }
    var todoCount = 0;
    for (var t = 0; t < allItems.length; t++) {
      var oc = st.seen[itemKey(st.stage, allItems[t].id)];
      if (oc !== "include" && oc !== "exclude") todoCount++;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar">');
    h.push('<div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Screening</h2>');
    h.push('<span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div>');
    h.push('<div class="rmd-topbar-actions">');
    h.push('<button type="button" class="rmd-chip' + (st.stage === "title_abstract" ? " rmd-chip-active" : "") + '" data-rmd-stage="title_abstract">Title &amp; Abstract</button>');
    h.push('<button type="button" class="rmd-chip' + (st.stage === "full_text" ? " rmd-chip-active" : "") + '" data-rmd-stage="full_text">Full Text</button>');
    h.push('</div></div>');

    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "screen-retry") + '</div>');

    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "queue" ? " rmd-seg-active" : "") + '" data-rmd-screen-view="queue">Queue (' + allItems.length + ')</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "current" ? " rmd-seg-active" : "") + '" data-rmd-screen-view="current">Screen Item</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');

    // Queue pane
    h.push('<div class="rmd-pane-left' + (st.phoneView !== "queue" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-pane-header"><div class="rmd-filter-tabs">');
    h.push('<button type="button" class="rmd-chip' + (st.filter === "all" ? " rmd-chip-active" : "") + '" data-rmd-screen-filter="all">All (' + allItems.length + ')</button>');
    h.push('<button type="button" class="rmd-chip' + (st.filter === "todo" ? " rmd-chip-active" : "") + '" data-rmd-screen-filter="todo">To Do (' + todoCount + ')</button>');
    h.push('<button type="button" class="rmd-chip' + (st.filter === "done" ? " rmd-chip-active" : "") + '" data-rmd-screen-filter="done">Decided (' + (allItems.length - todoCount) + ')</button>');
    h.push('</div></div>');
    if (st.loading) h.push(p2().loadingHtml("Loading screening queue"));
    if (!items.length && st.loaded && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>' + (allItems.length ? "Nothing matches this filter" : "Queue is empty") + '</h3>');
      h.push('<p>' + (allItems.length ? "Switch the filter to see the rest of the queue." : (st.stage === "title_abstract" ? "Run a search or import references first." : "No reports sought yet. Include records at title/abstract to seek their full text.")) + '</p>');
      if (!allItems.length && st.stage === "title_abstract") h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="to-search">Go to Search</button>');
      h.push('</div>');
    }
    h.push('<div role="list">');
    for (var q = 0; q < items.length; q++) {
      var it = items[q];
      var rec = it.record || {};
      var sel = item && it.id === item.id;
      var outcome = st.seen[itemKey(st.stage, it.id)];
      h.push('<button type="button" class="rmd-row-btn' + (sel ? " rmd-row-selected" : "") + '" data-rmd-item="' + esc(it.id) + '" role="listitem">');
      h.push('<span class="rmd-row-title">' + esc(rec.title || "Untitled record") + '</span>');
      h.push('<span class="rmd-row-meta">' + (rec.year ? rec.year + " · " : "") + esc(rec.source || "") + (it.report ? " · " + esc(it.report.status) : "") + " " + outcomeBadge(outcome) + '</span>');
      h.push('</button>');
    }
    h.push('</div></div>');

    // Detail pane
    h.push('<div class="rmd-pane-right' + (st.phoneView !== "current" ? " rmd-phone-hidden" : "") + '">');
    if (item) {
      h.push('<p class="rmd-progress-line"><span>Item ' + (idx + 1) + ' of ' + allItems.length + '</span><span>' + (st.stage === "title_abstract" ? "Title &amp; abstract stage" : "Full-text stage") + '</span></p>');
      h.push(renderItemDetail(item, role));
    } else if (st.loaded && !st.loading) {
      h.push('<div class="rmd-empty-state"><h3>Nothing to screen</h3><p>The queue for this stage is empty.</p></div>');
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
    on('[data-rmd="to-search"]', function () { SMD.navigate("search", {}); });
    on('[data-rmd="to-conflicts"]', function () { SMD.navigate("conflicts", {}); });
    on('[data-rmd="screen-retry"]', function () { st.loaded = false; render(container); });
    on('[data-rmd="screen-skip"]', function () { advance(container); });
    on('[data-rmd="vote-cancel-reason"]', function () { st.reasonFor = null; render(container); });

    var stageBtns = container.querySelectorAll("[data-rmd-stage]");
    for (var s = 0; s < stageBtns.length; s++) {
      stageBtns[s].onclick = function () {
        var stage = this.getAttribute("data-rmd-stage");
        if (stage === st.stage) return;
        st.stage = stage;
        st.currentId = null;
        st.votes = null;
        st.reasonFor = null;
        st.voteError = null;
        st.suggestion = null;
        st.announce = "";
        var items = queueItems();
        st.currentId = items.length ? items[0].id : null;
        st.votesLoading = !!st.currentId;
        render(container);
        if (st.currentId) loadVotes(container);
      };
    }

    var viewBtns = container.querySelectorAll("[data-rmd-screen-view]");
    for (var v = 0; v < viewBtns.length; v++) {
      viewBtns[v].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-screen-view");
        render(container);
      };
    }

    var filterBtns = container.querySelectorAll("[data-rmd-screen-filter]");
    for (var f = 0; f < filterBtns.length; f++) {
      filterBtns[f].onclick = function () {
        st.filter = this.getAttribute("data-rmd-screen-filter");
        render(container);
      };
    }

    var itemBtns = container.querySelectorAll("[data-rmd-item]");
    for (var i = 0; i < itemBtns.length; i++) {
      itemBtns[i].onclick = function () {
        st.announce = "";
        selectItem(container, this.getAttribute("data-rmd-item"));
      };
    }

    var voteBtns = container.querySelectorAll("[data-rmd-vote]");
    for (var b = 0; b < voteBtns.length; b++) {
      voteBtns[b].onclick = function () {
        var decision = this.getAttribute("data-rmd-vote");
        if (decision === "exclude") {
          st.reasonFor = "exclude";
          render(container);
        } else {
          submitVote(container, decision, null);
        }
      };
    }

    var reasonBtns = container.querySelectorAll("[data-rmd-reason]");
    for (var r = 0; r < reasonBtns.length; r++) {
      reasonBtns[r].onclick = function () {
        submitVote(container, "exclude", this.getAttribute("data-rmd-reason"));
      };
    }

    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: project.id, task: "screening", label: "screening suggestion",
        request: function () {
          var it = currentItem();
          var rid = (it && it.record && it.record.id) || (it && it.id) || "";
          return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(project.id) + "/records/" + encodeURIComponent(rid) + "/screening-suggestions", {});
        },
        apply: function (draft) {
          var sug = (draft && draft.suggestion) || draft;
          if (sug && sug.decision) { st.suggestion = sug; return ["suggestion"]; }
          return [];
        },
        render: function () { render(container); }
      });
    }
  }

  SMD.screens.screening = {
    render: render,
    fetchAllPages: fetchAllPages
  };

})(typeof window !== "undefined" ? window : globalThis);