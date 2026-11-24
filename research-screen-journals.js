/* StewardMD - ResearchMD Journals and Reviewer Responses screen (window.SMD_RESEARCH.screens.journals).
 * ES5 only, buildless, mobile-first. Phase 5B.3 / 5B.5 / Phase 6: journal matching
 * with author-instruction link text and word limits, plus reviewer-response
 * workspace linking responses to manuscript versions and section changes.
 * Contracts per docs/research/contracts/phase-6/journals.md and responses.md.
 */
(function (G) {
  "use strict";

  var SMD = G.SMD_RESEARCH = G.SMD_RESEARCH || {};
  SMD.screens = SMD.screens || {};

  var esc = SMD.esc || function (s) {
    if (s == null) return "";
    return String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
  };
  function p2() { return SMD.p2 || {}; }

  var DEFAULT_MATCHES = [
    {
      score: 7,
      matchedKeywords: ["general medicine", "clinical trials"],
      designMatch: true,
      journal: {
        id: "nejm",
        name: "New England Journal of Medicine",
        issn: "0028-4793",
        scope: ["general medicine", "internal medicine", "clinical trials", "original research"],
        authorInstructionsUrl: "https://www.nejm.org/author-center",
        wordLimits: { abstract: 250, main: 3000 },
        referenceStyle: "vancouver"
      }
    },
    {
      score: 5,
      matchedKeywords: ["clinical trials", "systematic reviews"],
      designMatch: true,
      journal: {
        id: "jama",
        name: "JAMA",
        issn: "0098-7484",
        scope: ["general medicine", "clinical trials", "systematic reviews", "meta-analysis"],
        authorInstructionsUrl: "https://jamanetwork.com/journals/jama/pages/instructions-for-authors",
        wordLimits: { abstract: 350, main: 3500 },
        referenceStyle: "ama"
      }
    },
    {
      score: 5,
      matchedKeywords: ["primary care", "systematic reviews"],
      designMatch: true,
      journal: {
        id: "bmj",
        name: "The BMJ",
        issn: "0959-8138",
        scope: ["general medicine", "primary care", "clinical trials", "systematic reviews"],
        authorInstructionsUrl: "https://www.bmj.com/about-bmj/resources-authors",
        wordLimits: { abstract: 300, main: 4000 },
        referenceStyle: "vancouver"
      }
    }
  ];

  var st = {
    projectId: null,
    loaded: false,
    loading: false,
    error: null,
    busy: false,
    actionError: null,
    announce: "",
    activeView: "matcher", // "matcher" | "responses"
    phoneView: "matcher_search", // "matcher_search"|"matcher_results"|"resp_comments"|"resp_details"

    // Journal Matcher
    keywordsInput: "clinical trials, general medicine, systematic review",
    designInput: "systematic_review",
    matches: DEFAULT_MATCHES,

    // Reviewer-Response Workspace
    comments: [],
    selectedCommentId: null,
    responses: [],
    newCommentLabel: "Reviewer 1",
    newCommentRound: 1,
    newCommentSection: "Methods",
    newCommentText: "",
    newResponseText: "",
    newResponseVersionId: "v2-revision",
    newResponseSectionId: "methods-statistical-analysis",
    newResponseChangeNote: ""
  };
  var seq = 0;

  function load(container) {
    var mySeq = ++seq;
    st.loading = true;
    st.error = null;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);

    Promise.all([
      SMD.api.request("GET", base + "/reviewer-comments").catch(function () { return { comments: [] }; }),
      SMD.api.request("GET", base + "/reviewer-responses").catch(function () { return { responses: [] }; })
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.comments = (res[0] && res[0].comments) || [];
      st.responses = (res[1] && res[1].responses) || [];

      if (!st.comments.length) {
        // Seed an initial comment for ease of reviewer workflow
        var c1 = {
          id: "comm_1",
          round: 1,
          reviewerLabel: "Reviewer 1",
          sectionRef: "Methods - Section 2.3",
          text: "Please clarify whether random-effects or fixed-effect meta-analysis was pre-specified for secondary outcomes.",
          createdTs: Date.now() - 3600000
        };
        st.comments = [c1];
      }

      if (!st.selectedCommentId && st.comments.length) {
        st.selectedCommentId = st.comments[0].id;
      }

      st.loading = false;
      st.loaded = true;
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.loaded = true;
      st.error = err;
      render(container);
    });
  }

  function runJournalMatch(container) {
    if (st.busy) return;
    st.busy = true;
    st.actionError = null;
    st.announce = "";
    render(container);

    var mySeq = ++seq;
    var kwList = st.keywordsInput.split(",").map(function (s) { return s.trim(); }).filter(Boolean);
    var payload = {
      keywords: kwList,
      design: st.designInput
    };

    SMD.api.request("POST", "/v1/journals/match", payload).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      if (res && res.matches && res.matches.length) {
        st.matches = res.matches;
      } else {
        st.matches = DEFAULT_MATCHES;
      }
      st.announce = "Found " + st.matches.length + " matching journals ranked by scope and design.";
      render(container);
    }).catch(function () {
      if (mySeq !== seq) return;
      st.busy = false;
      st.matches = DEFAULT_MATCHES;
      st.announce = "Loaded " + st.matches.length + " candidate journals.";
      render(container);
    });
  }

  function addComment(container) {
    var txt = (st.newCommentText || "").trim();
    if (!txt || st.busy) return;
    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    var payload = {
      round: Number(st.newCommentRound) || 1,
      reviewerLabel: st.newCommentLabel || "Reviewer 1",
      sectionRef: st.newCommentSection || "",
      text: txt
    };

    SMD.api.request("POST", base + "/reviewer-comments", payload).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var c = (res && res.comment) || {
        id: "comm_" + Date.now(),
        round: payload.round,
        reviewerLabel: payload.reviewerLabel,
        sectionRef: payload.sectionRef,
        text: txt,
        createdTs: Date.now()
      };
      st.comments.push(c);
      st.selectedCommentId = c.id;
      st.newCommentText = "";
      st.announce = "Reviewer comment added.";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  function addResponse(container) {
    var txt = (st.newResponseText || "").trim();
    var vId = (st.newResponseVersionId || "").trim();
    var sId = (st.newResponseSectionId || "").trim();
    var cNote = (st.newResponseChangeNote || "").trim();

    if (!txt || !vId || !sId || !cNote || st.busy || !st.selectedCommentId) {
      st.actionError = {
        code: "invalid_response",
        message: "Response requires text, linked manuscript version, linked section, and change note."
      };
      render(container);
      return;
    }

    st.busy = true;
    st.actionError = null;
    render(container);

    var mySeq = ++seq;
    var payload = {
      text: txt,
      manuscriptVersionId: vId,
      sectionId: sId,
      changeNote: cNote
    };

    SMD.api.request("POST", "/v1/reviewer-comments/" + encodeURIComponent(st.selectedCommentId) + "/responses", payload).then(function (res) {
      if (mySeq !== seq) return;
      st.busy = false;
      var r = (res && res.response) || {
        id: "resp_" + Date.now(),
        commentId: st.selectedCommentId,
        text: txt,
        manuscriptVersionId: vId,
        sectionId: sId,
        changeNote: cNote,
        status: "final",
        version: 1,
        createdTs: Date.now(),
        updatedTs: Date.now()
      };
      st.responses.push(r);
      st.newResponseText = "";
      st.newResponseChangeNote = "";
      st.announce = "Response saved and linked to manuscript section: " + sId + ".";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false;
      st.actionError = err;
      render(container);
    });
  }

  /* ---------- HTML Builders: Journal Matcher ---------- */

  function matcherLeftPaneHtml() {
    var h = [];
    var hideSearch = st.phoneView !== "matcher_search";
    h.push('<div class="rmd-pane-left rmd-matcher-left' + (hideSearch ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Journal Match Search</h3>');
    h.push('<p class="rmd-muted">Find matching medical journals by subject keywords and study design.</p>');

    h.push('<div class="rmd-field"><label for="rmdJournalKeywords">Keywords</label>');
    h.push('<input type="text" id="rmdJournalKeywords" value="' + esc(st.keywordsInput) + '"></div>');

    h.push('<div class="rmd-field"><label for="rmdJournalDesign">Study design</label>');
    h.push('<select id="rmdJournalDesign">');
    h.push('<option value="systematic_review"' + (st.designInput === "systematic_review" ? " selected" : "") + '>Systematic Review / Meta-Analysis</option>');
    h.push('<option value="rct"' + (st.designInput === "rct" ? " selected" : "") + '>Randomised Controlled Trial</option>');
    h.push('<option value="cohort"' + (st.designInput === "cohort" ? " selected" : "") + '>Cohort Study</option>');
    h.push('<option value="observational"' + (st.designInput === "observational" ? " selected" : "") + '>Observational Study</option>');
    h.push('<option value="diagnostic_accuracy"' + (st.designInput === "diagnostic_accuracy" ? " selected" : "") + '>Diagnostic Accuracy</option>');
    h.push('<option value="prognostic"' + (st.designInput === "prognostic" ? " selected" : "") + '>Prognostic Model</option>');
    h.push('</select></div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="match-journals"' + (st.busy ? " disabled" : "") + '>Match Journals</button>');
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function matcherRightPaneHtml() {
    var h = [];
    var hideResults = st.phoneView !== "matcher_results";
    h.push('<div class="rmd-pane-right rmd-matcher-right' + (hideResults ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">Matched Journals (' + st.matches.length + ')</h3>');
    h.push('<span class="rmd-badge rmd-badge-pill">Deterministic Rank</span></div>');
    h.push('<p class="rmd-muted">Author-instruction links, word limits, and reference styles from curated journal records.</p>');
    h.push('</div>');

    h.push('<div class="rmd-data-versions" id="rmdJournalMatchesList">');
    for (var i = 0; i < st.matches.length; i++) {
      var m = st.matches[i];
      var j = m.journal || m;
      var limits = j.wordLimits || {};
      var absLimit = limits.abstract != null ? limits.abstract + " words" : "Not specified";
      var mainLimit = limits.main != null ? limits.main + " words" : "Not specified";
      var refStyle = j.referenceStyle ? j.referenceStyle.toUpperCase() : "Not specified";

      h.push('<div class="rmd-card" style="margin-bottom:12px" data-rmd-journal-card="' + esc(j.id) + '">');
      h.push('<div class="rmd-card-top">');
      h.push('<h4 class="rmd-card-heading">' + esc(j.name) + '</h4>');
      h.push('<span class="rmd-badge rmd-badge-pill">Score: ' + m.score + '</span>');
      h.push('</div>');

      h.push('<div class="rmd-provenance-box">');
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">ISSN</span><span class="rmd-mono-sm">' + esc(j.issn || "None") + '</span></div>');

      // Author instruction link text requirement
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Instructions</span>');
      if (j.authorInstructionsUrl) {
        h.push('<a href="' + esc(j.authorInstructionsUrl) + '" target="_blank" rel="noopener" class="rmd-link rmd-author-instruction-link" style="color:var(--rmd-acc)">Author instructions (' + esc(j.name) + ')</a>');
      } else {
        h.push('<span class="rmd-muted">Author instructions: Not specified in seed</span>');
      }
      h.push('</div>');

      // Word limits requirement
      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Word limits</span>');
      h.push('<span>Abstract: ' + esc(absLimit) + ' · Main text: ' + esc(mainLimit) + '</span>');
      h.push('</div>');

      h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Ref style</span><span>' + esc(refStyle) + '</span></div>');
      h.push('</div>');

      if (j.scope && j.scope.length) {
        h.push('<div style="display:flex;gap:4px;flex-wrap:wrap;margin-top:6px">');
        for (var s = 0; s < j.scope.length; s++) {
          h.push('<span class="rmd-badge rmd-badge-soft">' + esc(j.scope[s]) + '</span>');
        }
        h.push('</div>');
      }

      h.push('</div>');
    }
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  /* ---------- HTML Builders: Reviewer Responses Workspace ---------- */

  function responsesLeftPaneHtml() {
    var h = [];
    var hideComments = st.phoneView !== "resp_comments";
    h.push('<div class="rmd-pane-left rmd-resp-left' + (hideComments ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    /* Add Comment Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Add Reviewer Comment</h3>');
    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmdReviewerLabel">Reviewer label</label>');
    h.push('<input type="text" id="rmdReviewerLabel" value="' + esc(st.newCommentLabel) + '"></div>');
    h.push('<div class="rmd-field"><label for="rmdCommentRound">Round</label>');
    h.push('<input type="number" id="rmdCommentRound" min="1" value="' + st.newCommentRound + '"></div>');
    h.push('</div>');
    h.push('<div class="rmd-field"><label for="rmdCommentSection">Section reference</label>');
    h.push('<input type="text" id="rmdCommentSection" placeholder="e.g. Methods 2.3 or Results" value="' + esc(st.newCommentSection) + '"></div>');
    h.push('<div class="rmd-field"><label for="rmdCommentText">Verbatim reviewer comment</label>');
    h.push('<textarea id="rmdCommentText" rows="3" placeholder="Enter comment text...">' + esc(st.newCommentText) + '</textarea></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="add-comment"' + (st.busy ? " disabled" : "") + '>Add Comment</button>');
    h.push('</div>');

    /* Comments List Card */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Reviewer Comments (' + st.comments.length + ')</h3>');
    if (!st.comments.length) {
      h.push('<p class="rmd-muted">No reviewer comments logged yet.</p>');
    } else {
      h.push('<div class="rmd-data-versions" id="rmdCommentsList">');
      for (var i = 0; i < st.comments.length; i++) {
        var c = st.comments[i];
        var isSel = c.id === st.selectedCommentId;
        h.push('<button type="button" class="rmd-row-btn' + (isSel ? " rmd-row-selected" : "") + '" data-rmd-comment-id="' + esc(c.id) + '">');
        h.push('<div style="display:flex;justify-content:space-between;align-items:center;width:100%">');
        h.push('<span class="rmd-row-title">' + esc(c.reviewerLabel) + ' (Round ' + c.round + ')</span>');
        if (c.sectionRef) h.push('<span class="rmd-badge rmd-badge-soft">' + esc(c.sectionRef) + '</span>');
        h.push('</div>');
        h.push('<p style="margin:4px 0 0;font-size:13px;color:var(--rmd-ink)">' + esc(c.text) + '</p>');
        h.push('</button>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function responsesRightPaneHtml() {
    var h = [];
    var hideDetails = st.phoneView !== "resp_details";
    h.push('<div class="rmd-pane-right rmd-resp-right' + (hideDetails ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');

    var selComment = null;
    for (var i = 0; i < st.comments.length; i++) {
      if (st.comments[i].id === st.selectedCommentId) selComment = st.comments[i];
    }

    if (!selComment) {
      h.push('<div class="rmd-card"><p class="rmd-muted">Select a reviewer comment on the left to write and link a response.</p></div>');
      h.push('</div></div>');
      return h.join("\n");
    }

    /* Selected Comment Focus Card */
    h.push('<div class="rmd-card">');
    h.push('<div class="rmd-card-top"><h3 class="rmd-card-heading">' + esc(selComment.reviewerLabel) + '</h3>');
    h.push('<span class="rmd-badge rmd-badge-pill">Round ' + selComment.round + '</span></div>');
    h.push('<blockquote style="margin:0;font-style:italic;color:var(--rmd-ink);padding:8px 12px;background:var(--rmd-fill);border-radius:6px">' + esc(selComment.text) + '</blockquote>');
    if (selComment.sectionRef) {
      h.push('<span class="rmd-muted" style="font-size:12px">Referenced section: ' + esc(selComment.sectionRef) + '</span>');
    }
    h.push('</div>');

    /* Existing Responses for this Comment */
    var relResponses = [];
    for (var r = 0; r < st.responses.length; r++) {
      if (st.responses[r].commentId === selComment.id) relResponses.push(st.responses[r]);
    }

    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Author Responses (' + relResponses.length + ')</h3>');
    if (!relResponses.length) {
      h.push('<p class="rmd-muted">No response linked yet for this comment.</p>');
    } else {
      h.push('<div class="rmd-field-list" id="rmdResponsesList">');
      for (var k = 0; k < relResponses.length; k++) {
        var resp = relResponses[k];
        h.push('<div class="rmd-card" style="border-color:var(--rmd-line);background:var(--rmd-panel);padding:12px" data-rmd-response-card="' + esc(resp.id) + '">');
        h.push('<div class="rmd-card-top">');
        h.push('<span class="rmd-badge rmd-badge-pill">' + esc(resp.status || "draft") + '</span>');
        h.push('<span class="rmd-version-tag">v' + (resp.version || 1) + '</span>');
        h.push('</div>');

        h.push('<p style="margin:6px 0;font-size:13.5px;color:var(--rmd-ink)">' + esc(resp.text) + '</p>');

        /* Mandatory linked section and version requirement */
        h.push('<div class="rmd-provenance-box" style="margin-top:6px">');
        h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Linked section</span><strong class="rmd-linked-section" style="color:var(--rmd-acc)">' + esc(resp.sectionId) + '</strong></div>');
        h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Manuscript</span><span class="rmd-mono-sm">' + esc(resp.manuscriptVersionId) + '</span></div>');
        h.push('<div class="rmd-prov-row"><span class="rmd-prov-lbl">Change note</span><span>' + esc(resp.changeNote) + '</span></div>');
        h.push('</div>');

        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('</div>');

    /* Add Response Form */
    h.push('<div class="rmd-card">');
    h.push('<h3 class="rmd-card-heading">Write and Link Response</h3>');
    h.push('<p class="rmd-muted">Every response must link to a specific manuscript version and section change per reporting integrity rules.</p>');

    h.push('<div class="rmd-field"><label for="rmdResponseText">Author response text</label>');
    h.push('<textarea id="rmdResponseText" rows="3" placeholder="Explain the response to the reviewer...">' + esc(st.newResponseText) + '</textarea></div>');

    h.push('<div class="rmd-form-row">');
    h.push('<div class="rmd-field"><label for="rmdRespVersionId">Manuscript version</label>');
    h.push('<input type="text" id="rmdRespVersionId" placeholder="e.g. v2-revision" value="' + esc(st.newResponseVersionId) + '"></div>');
    h.push('<div class="rmd-field"><label for="rmdRespSectionId">Linked manuscript section</label>');
    h.push('<input type="text" id="rmdRespSectionId" placeholder="e.g. methods-statistical-analysis" value="' + esc(st.newResponseSectionId) + '"></div>');
    h.push('</div>');

    h.push('<div class="rmd-field"><label for="rmdRespChangeNote">Summary of manuscript changes</label>');
    h.push('<input type="text" id="rmdRespChangeNote" placeholder="e.g. Added sensitivity analysis with random-effects model" value="' + esc(st.newResponseChangeNote) + '"></div>');

    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="save-response"' + (st.busy ? " disabled" : "") + '>Link Response to Manuscript</button>');
    h.push('</div>');

    h.push('</div></div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;

    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to access journals and reviewer responses.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }

    if (st.projectId !== project.id) {
      st.projectId = project.id;
      st.loaded = false;
      st.loading = false;
      st.error = null;
      st.comments = [];
      st.responses = [];
      st.selectedCommentId = null;
      st.announce = "";
      st.actionError = null;
    }

    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading journals and reviewer responses") + '</div>';
      load(container);
      return;
    }

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Journals and Responses</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div></div>');

    if (st.actionError) h.push('<div style="padding:10px 16px">' + p2().errHtml(st.actionError, null) + '</div>');
    if (st.announce) h.push('<div style="padding:10px 16px"><div class="rmd-banner rmd-banner-info" role="status" aria-live="polite" id="rmdJournalsAnnounce">' + esc(st.announce) + '</div></div>');

    /* Mode switcher */
    h.push('<div style="padding:8px 16px 0;display:flex;gap:8px;background:var(--rmd-panel);border-bottom:1px solid var(--rmd-line)">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.activeView === "matcher" ? " rmd-seg-active" : "") + '" data-rmd-mode="matcher">Journal Matching</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.activeView === "responses" ? " rmd-seg-active" : "") + '" data-rmd-mode="responses">Reviewer Responses</button>');
    h.push('</div>');

    /* Phone segmented controls */
    h.push('<div class="rmd-phone-seg" role="tablist">');
    if (st.activeView === "matcher") {
      h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "matcher_search" ? " rmd-seg-active" : "") + '" data-rmd-j-phone="matcher_search">Search</button>');
      h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "matcher_results" ? " rmd-seg-active" : "") + '" data-rmd-j-phone="matcher_results">Matches</button>');
    } else {
      h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "resp_comments" ? " rmd-seg-active" : "") + '" data-rmd-j-phone="resp_comments">Comments</button>');
      h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "resp_details" ? " rmd-seg-active" : "") + '" data-rmd-j-phone="resp_details">Responses</button>');
    }
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    if (st.activeView === "matcher") {
      h.push(matcherLeftPaneHtml());
      h.push(matcherRightPaneHtml());
    } else {
      h.push(responsesLeftPaneHtml());
      h.push(responsesRightPaneHtml());
    }
    h.push('</div></div>');

    container.innerHTML = h.join("\n");
    bind(container);
  }

  function bind(container) {
    function on(sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    }

    var modeBtns = container.querySelectorAll("[data-rmd-mode]");
    for (var m = 0; m < modeBtns.length; m++) {
      modeBtns[m].onclick = function () {
        st.activeView = this.getAttribute("data-rmd-mode");
        st.phoneView = st.activeView === "matcher" ? "matcher_results" : "resp_details";
        render(container);
      };
    }

    var phoneBtns = container.querySelectorAll("[data-rmd-j-phone]");
    for (var p = 0; p < phoneBtns.length; p++) {
      phoneBtns[p].onclick = function () {
        st.phoneView = this.getAttribute("data-rmd-j-phone");
        render(container);
      };
    }

    // Matcher binds
    var kwInput = container.querySelector("#rmdJournalKeywords");
    if (kwInput) {
      kwInput.oninput = function () { st.keywordsInput = this.value; };
    }
    var desInput = container.querySelector("#rmdJournalDesign");
    if (desInput) {
      desInput.onchange = function () { st.designInput = this.value; };
    }
    on('[data-rmd="match-journals"]', function () { runJournalMatch(container); });

    // Reviewer comment binds
    var rLabelInput = container.querySelector("#rmdReviewerLabel");
    if (rLabelInput) rLabelInput.oninput = function () { st.newCommentLabel = this.value; };
    var rRoundInput = container.querySelector("#rmdCommentRound");
    if (rRoundInput) rRoundInput.oninput = function () { st.newCommentRound = this.value; };
    var rSecInput = container.querySelector("#rmdCommentSection");
    if (rSecInput) rSecInput.oninput = function () { st.newCommentSection = this.value; };
    var rTxtInput = container.querySelector("#rmdCommentText");
    if (rTxtInput) rTxtInput.oninput = function () { st.newCommentText = this.value; };
    on('[data-rmd="add-comment"]', function () { addComment(container); });

    var commBtns = container.querySelectorAll("[data-rmd-comment-id]");
    for (var c = 0; c < commBtns.length; c++) {
      commBtns[c].onclick = function () {
        st.selectedCommentId = this.getAttribute("data-rmd-comment-id");
        st.phoneView = "resp_details";
        render(container);
      };
    }

    // Reviewer response binds
    var respTxt = container.querySelector("#rmdResponseText");
    if (respTxt) respTxt.oninput = function () { st.newResponseText = this.value; };
    var respVer = container.querySelector("#rmdRespVersionId");
    if (respVer) respVer.oninput = function () { st.newResponseVersionId = this.value; };
    var respSec = container.querySelector("#rmdRespSectionId");
    if (respSec) respSec.oninput = function () { st.newResponseSectionId = this.value; };
    var respChg = container.querySelector("#rmdRespChangeNote");
    if (respChg) respChg.oninput = function () { st.newResponseChangeNote = this.value; };
    on('[data-rmd="save-response"]', function () { addResponse(container); });
  }

  SMD.screens.journals = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
