/* StewardMD - ResearchMD Risk of Bias screen (window.SMD_RESEARCH.screens.rob).
 * ES5 only, buildless, mobile-first. Phase 3.6 (module L): RoB 2, ROBINS-I,
 * QUADAS-2, Newcastle-Ottawa forms with their real domains and signalling
 * questions; judgment + quote + locator per domain; blinded dual assessment
 * (peer hidden until both submit, per phase-2/blinding.md); consensus; a
 * traffic-light summary. Routes per docs/research/contracts/phase-3/rob.md.
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

  var JUDGMENT_LABEL = {
    low: "Low", some_concerns: "Some concerns", high: "High",
    moderate: "Moderate", serious: "Serious", critical: "Critical",
    no_information: "No information", unclear: "Unclear"
  };
  /* Traffic-light class per judgment (full-border pills, no side stripes). */
  function lightClass(j) {
    if (j === "low") return "rmd-light-low";
    if (j === "some_concerns" || j === "moderate" || j === "unclear" || j === "no_information") return "rmd-light-mid";
    if (j === "high" || j === "serious" || j === "critical") return "rmd-light-high";
    return "rmd-light-mid";
  }
  function jLabel(j) { return JUDGMENT_LABEL[j] || j || ""; }

  var st = {
    projectId: null, loaded: false, loading: false, error: null,
    tools: [], tool: "rob2", studies: [], studyId: null,
    assessment: null, assessmentLoading: false,
    draft: {}, busy: false, actionError: null, announce: "",
    consensus: {}, note: "", phoneView: "assess", ai: null
  };
  var seq = 0;

  function toolDef() {
    for (var i = 0; i < st.tools.length; i++) if (st.tools[i].id === st.tool) return st.tools[i];
    return st.tools[0] || { id: st.tool, domains: [], overallRule: "worst_domain" };
  }
  function currentStudy() {
    for (var i = 0; i < st.studies.length; i++) if (st.studies[i].id === st.studyId) return st.studies[i];
    return null;
  }
  function draftFor(key) {
    if (!st.draft[key]) st.draft[key] = { judgment: "", quote: "", page: "", signallingAnswers: {}, stars: 0, applicability: "" };
    return st.draft[key];
  }
  function domainByKey(key) {
    var doms = toolDef().domains || [];
    for (var i = 0; i < doms.length; i++) if (doms[i].key === key) return doms[i];
    return null;
  }
  /* Source text a drafted quote must be a substring of, else the domain stays empty. */
  function studySourceText() {
    var s = currentStudy() || {};
    var loc = s.locator || {};
    var parts = [s.title, s.abstract, s.quote, loc.quote, loc.citation, s.label];
    var out = [];
    for (var i = 0; i < parts.length; i++) if (parts[i]) out.push(String(parts[i]));
    return out.join("\n");
  }

  function load(container) {
    var mySeq = ++seq;
    st.loading = true; st.error = null;
    Promise.all([
      SMD.api.request("GET", "/v1/rob-tools"),
      SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies?limit=100")
    ]).then(function (res) {
      if (mySeq !== seq) return;
      st.tools = (res[0] && res[0].tools) || [];
      st.studies = (res[1] && res[1].studies) || [];
      st.loading = false; st.loaded = true;
      if (st.tools.length) st.tool = st.tools[0].id;
      if (!st.studyId && st.studies.length) st.studyId = st.studies[0].id;
      render(container);
      if (st.studyId) loadAssessment(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false; st.loaded = true; st.error = err; render(container);
    });
  }

  function loadAssessment(container) {
    var mySeq = ++seq;
    st.assessmentLoading = true; st.assessment = null; st.actionError = null;
    render(container);
    var url = "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/rob?tool=" + encodeURIComponent(st.tool);
    SMD.api.request("GET", url).then(function (data) {
      if (mySeq !== seq) return;
      st.assessmentLoading = false; st.assessment = data.assessment;
      st.draft = {}; st.consensus = {}; st.ai = null;
      var self = st.assessment && st.assessment.self;
      if (self && self.domains) {
        for (var i = 0; i < self.domains.length; i++) {
          var d = self.domains[i];
          st.draft[d.key] = { judgment: d.judgment || "", quote: d.quote || "", page: (d.locator && d.locator.page) || "", signallingAnswers: d.signallingAnswers || {}, stars: d.stars || 0, applicability: d.applicability || "" };
        }
      }
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.assessmentLoading = false; st.actionError = err; render(container);
    });
  }

  function buildLocator(key, quote) {
    var s = currentStudy();
    var d = draftFor(key);
    return { kind: "manual", citation: (s && s.label) || "Study", page: d.page || "", quote: quote };
  }

  function submit(container) {
    if (st.busy) return;
    var def = toolDef();
    var domains = [];
    for (var i = 0; i < def.domains.length; i++) {
      var dom = def.domains[i];
      var d = draftFor(dom.key);
      if (!d.quote || !d.quote.trim()) { st.actionError = { message: "Every domain needs a supporting quote before you submit (" + dom.label + ").", code: "locator_required" }; render(container); return; }
      var judgment = def.id === "nos" ? (d.stars > 0 ? "yes" : "no") : d.judgment;
      if (def.id !== "nos" && !judgment) { st.actionError = { message: "Choose a judgment for " + dom.label + ".", code: "invalid_judgment" }; render(container); return; }
      var item = { key: dom.key, judgment: judgment, quote: d.quote, locator: buildLocator(dom.key, d.quote), signallingAnswers: d.signallingAnswers };
      if (def.id === "nos") item.stars = d.stars;
      if (dom.applicability) item.applicability = d.applicability || "low";
      domains.push(item);
    }
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(st.projectId) + "/studies/" + encodeURIComponent(st.studyId) + "/rob", { tool: st.tool, domains: domains }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false;
      if (data.outcome === "conflict") st.announce = "Both assessors have submitted. Judgments disagree, so a conflict is open and both assessments are now visible. Resolve it by consensus below.";
      else if (data.outcome === "agreed") st.announce = "Both assessors agree. The assessment is complete.";
      else st.announce = "Assessment submitted. Waiting for the second assessor.";
      loadAssessment(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  function resolve(container) {
    if (st.busy || !st.assessment || !st.assessment.conflictId) return;
    var def = toolDef();
    var domains = [];
    for (var i = 0; i < def.domains.length; i++) {
      var dom = def.domains[i];
      var c = st.consensus[dom.key] || {};
      var judgment = def.id === "nos" ? ((c.stars || 0) > 0 ? "yes" : "no") : c.judgment;
      var quote = c.quote || (draftFor(dom.key).quote || "");
      if (!judgment || !quote) { st.actionError = { message: "Consensus needs a judgment and quote for " + dom.label + ".", code: "invalid_judgment" }; render(container); return; }
      var item = { key: dom.key, judgment: judgment, quote: quote, locator: { kind: "manual", citation: (currentStudy() || {}).label || "Study", page: draftFor(dom.key).page || "", quote: quote } };
      if (def.id === "nos") item.stars = c.stars || 0;
      if (dom.applicability) item.applicability = c.applicability || "low";
      domains.push(item);
    }
    if (!st.note.trim()) { st.actionError = { message: "Add a consensus note.", code: "invalid_correction" }; render(container); return; }
    st.busy = true; st.actionError = null; render(container);
    var mySeq = ++seq;
    SMD.api.request("POST", "/v1/rob-conflicts/" + encodeURIComponent(st.assessment.conflictId) + "/resolve", { domains: domains, note: st.note }).then(function (data) {
      if (mySeq !== seq) return;
      st.busy = false; st.announce = "Consensus recorded. The overall judgment is recomputed from the agreed domains.";
      st.assessment = data.assessment; st.consensus = {}; st.note = "";
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.busy = false; st.actionError = err; render(container);
    });
  }

  /* ---------- render ---------- */

  function domainFormHtml(dom) {
    var def = toolDef();
    var d = draftFor(dom.key);
    var h = [];
    h.push('<div class="rmd-rob-domain" data-rmd-domain="' + esc(dom.key) + '">');
    h.push('<h4 class="rmd-rob-domain-label">' + esc(dom.label) + '</h4>');
    if (st.ai) h.push(SMD.ai.noteHtml(st.ai, dom.key));
    if (def.id === "nos") {
      var max = dom.maxStars || 1;
      h.push('<div class="rmd-rob-stars">');
      for (var s = 0; s <= max; s++) {
        h.push('<button type="button" class="rmd-chip' + (d.stars === s ? " rmd-chip-active" : "") + '" data-rmd-star="' + esc(dom.key) + ':' + s + '">' + s + ' star' + (s === 1 ? "" : "s") + '</button>');
      }
      h.push('</div>');
    } else {
      var sqs = dom.signallingQuestions || [];
      if (sqs.length) {
        h.push('<div class="rmd-rob-sq">');
        for (var q = 0; q < sqs.length; q++) {
          var sq = sqs[q];
          var ans = d.signallingAnswers[sq.key] || "";
          h.push('<div class="rmd-rob-sq-row"><span class="rmd-rob-sq-text">' + esc(sq.text) + '</span>');
          h.push('<select data-rmd-sq="' + esc(dom.key) + ':' + esc(sq.key) + '" aria-label="' + esc(sq.text) + '">');
          var opts = def.id === "quadas2" ? ["Y", "N", "Unclear"] : ["Y", "PY", "PN", "N", "NI"];
          h.push('<option value="">-</option>');
          for (var o = 0; o < opts.length; o++) h.push('<option value="' + opts[o] + '"' + (ans === opts[o] ? " selected" : "") + '>' + opts[o] + '</option>');
          h.push('</select></div>');
        }
        h.push('</div>');
      }
      h.push('<div class="rmd-field"><label for="rmdJudgment_' + esc(dom.key) + '">Judgment</label><select id="rmdJudgment_' + esc(dom.key) + '" data-rmd-judgment="' + esc(dom.key) + '">');
      h.push('<option value="">Choose</option>');
      var js = dom.judgments || [];
      for (var j = 0; j < js.length; j++) h.push('<option value="' + esc(js[j]) + '"' + (d.judgment === js[j] ? " selected" : "") + '>' + esc(jLabel(js[j])) + '</option>');
      h.push('</select></div>');
      if (dom.applicability) {
        h.push('<div class="rmd-field"><label for="rmdApp_' + esc(dom.key) + '">Applicability concern</label><select id="rmdApp_' + esc(dom.key) + '" data-rmd-app="' + esc(dom.key) + '">');
        var ap = ["low", "high", "unclear"];
        for (var a = 0; a < ap.length; a++) h.push('<option value="' + ap[a] + '"' + (d.applicability === ap[a] ? " selected" : "") + '>' + esc(jLabel(ap[a])) + '</option>');
        h.push('</select></div>');
      }
    }
    h.push('<div class="rmd-field"><label for="rmdQuote_' + esc(dom.key) + '">Supporting quote (required)</label><textarea id="rmdQuote_' + esc(dom.key) + '" data-rmd-quote="' + esc(dom.key) + '" rows="2">' + esc(d.quote) + '</textarea></div>');
    h.push('<div class="rmd-field"><label for="rmdPage_' + esc(dom.key) + '">Source page</label><input type="text" id="rmdPage_' + esc(dom.key) + '" data-rmd-page="' + esc(dom.key) + '" value="' + esc(d.page) + '" placeholder="e.g. 4"></div>');
    h.push('</div>');
    return h.join("\n");
  }

  function assessorLineHtml(who, assessor, hidden) {
    var h = '<div class="rmd-vote-line"><span class="rmd-vote-who">' + who + '</span>';
    if (hidden) {
      h += '<span class="rmd-peer-hidden">Hidden until both assessors submit</span>';
    } else if (!assessor || !assessor.submitted) {
      h += '<span class="rmd-muted">Not submitted yet</span>';
    } else {
      h += '<span class="rmd-light ' + lightClass(assessor.overall) + '">' + esc(jLabel(assessor.overall)) + '</span>';
      if (assessor.stars != null) h += '<span class="rmd-muted">' + assessor.stars + ' / 9 stars</span>';
    }
    h += '</div>';
    return h;
  }

  function summaryHtml() {
    var a = st.assessment;
    if (!a) return "";
    var def = toolDef();
    var source = a.consensus || a.self;
    var domains = (source && source.domains) || [];
    var byKey = {};
    for (var i = 0; i < domains.length; i++) byKey[domains[i].key] = domains[i];
    var h = ['<div class="rmd-section-block"><h4 class="rmd-section-label">Traffic-light summary</h4>'];
    if (a.consensus) h.push('<p class="rmd-muted">Showing consensus judgments.</p>');
    h.push('<div class="rmd-rob-summary">');
    for (var d = 0; d < def.domains.length; d++) {
      var dom = def.domains[d];
      var got = byKey[dom.key];
      var j = got ? got.judgment : "";
      var txt = def.id === "nos" ? (got ? (got.stars || 0) + " star" + ((got.stars || 0) === 1 ? "" : "s") : "not assessed") : jLabel(j);
      h.push('<div class="rmd-rob-summary-row"><span class="rmd-rob-summary-label">' + esc(dom.label) + '</span>');
      h.push('<span class="rmd-light ' + (got ? lightClass(j) : "rmd-light-none") + '">' + esc(got ? txt : "Not assessed") + '</span></div>');
    }
    h.push('</div>');
    var overall = (a.consensus && a.consensus.overall) || (a.self && a.self.overall);
    if (overall) h.push('<p class="rmd-rob-overall">Overall: <span class="rmd-light ' + lightClass(overall) + '">' + esc(jLabel(overall)) + '</span></p>');
    h.push('<p class="rmd-muted rmd-rob-source">Source: ' + esc(def.source) + '</p>');
    h.push('</div>');
    return h.join("\n");
  }

  function consensusHtml(role) {
    var a = st.assessment;
    if (!a || a.outcome !== "conflict" || !a.conflictId) return "";
    var canResolve = role === "owner" || role === "editor";
    var def = toolDef();
    var h = ['<div class="rmd-section-block rmd-rob-consensus"><h4 class="rmd-section-label">Consensus</h4>'];
    h.push('<div class="rmd-banner rmd-banner-warn">Judgments disagree. Both assessments are visible to the resolver.</div>');
    if (!canResolve) {
      h.push('<p class="rmd-muted">Only an owner or editor can resolve this conflict.</p></div>');
      return h.join("\n");
    }
    for (var i = 0; i < def.domains.length; i++) {
      var dom = def.domains[i];
      var c = st.consensus[dom.key] || {};
      h.push('<div class="rmd-rob-domain"><h4 class="rmd-rob-domain-label">' + esc(dom.label) + '</h4>');
      if (def.id !== "nos") {
        h.push('<select data-rmd-consensus="' + esc(dom.key) + '" aria-label="Consensus judgment for ' + esc(dom.label) + '"><option value="">Choose</option>');
        var js = dom.judgments || [];
        for (var j = 0; j < js.length; j++) h.push('<option value="' + esc(js[j]) + '"' + (c.judgment === js[j] ? " selected" : "") + '>' + esc(jLabel(js[j])) + '</option>');
        h.push('</select>');
      } else {
        h.push('<div class="rmd-rob-stars">');
        var max = dom.maxStars || 1;
        for (var s = 0; s <= max; s++) h.push('<button type="button" class="rmd-chip' + ((c.stars || 0) === s ? " rmd-chip-active" : "") + '" data-rmd-consensus-star="' + esc(dom.key) + ':' + s + '">' + s + '</button>');
        h.push('</div>');
      }
      h.push('<input type="text" data-rmd-consensus-quote="' + esc(dom.key) + '" value="' + esc(c.quote || "") + '" placeholder="Consensus quote" aria-label="Consensus quote for ' + esc(dom.label) + '">');
      h.push('</div>');
    }
    h.push('<div class="rmd-field"><label for="rmdRobNote">Consensus note (required)</label><textarea id="rmdRobNote" rows="2">' + esc(st.note) + '</textarea></div>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="rob-resolve"' + (st.busy ? " disabled" : "") + '>Record consensus</button>');
    h.push('</div>');
    return h.join("\n");
  }

  function render(container) {
    var store = SMD.store;
    var project = store ? store.getActiveProject() : null;
    if (!project) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to assess risk of bias.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var tp = container.querySelector('[data-rmd="to-projects"]');
      if (tp) tp.onclick = function () { SMD.navigate("projects"); };
      return;
    }
    if (st.projectId !== project.id) {
      st.projectId = project.id; st.loaded = false; st.loading = false; st.error = null;
      st.tools = []; st.studies = []; st.studyId = null; st.assessment = null; st.draft = {}; st.consensus = {}; st.announce = ""; st.actionError = null;
    }
    if (!st.loaded && !st.loading) {
      container.innerHTML = '<div class="rmd-p2-screen">' + p2().loadingHtml("Loading risk-of-bias tools") + '</div>';
      load(container);
      return;
    }
    var role = project.role || "owner";
    var canAssess = role === "owner" || role === "editor" || role === "analyst" || role === "reviewer";
    var def = toolDef();
    var a = st.assessment;
    var peerHidden = !a || !a.peer || a.peer.hidden === true;

    var h = [];
    h.push('<div class="rmd-studies-screen">');
    h.push('<div class="rmd-studies-topbar"><div class="rmd-topbar-left"><div class="rmd-topbar-proj-info">');
    h.push('<h2 class="rmd-topbar-proj-title">Risk of Bias</h2><span class="rmd-badge rmd-badge-soft">' + esc(project.title) + '</span>');
    h.push('</div></div><div class="rmd-topbar-actions"><select id="rmdRobStudy" aria-label="Study">');
    for (var i = 0; i < st.studies.length; i++) h.push('<option value="' + esc(st.studies[i].id) + '"' + (st.studies[i].id === st.studyId ? " selected" : "") + '>' + esc(st.studies[i].label || st.studies[i].id) + '</option>');
    h.push('</select></div></div>');

    h.push('<div class="rmd-rob-tools" role="tablist" aria-label="Risk-of-bias tool">');
    for (var t = 0; t < st.tools.length; t++) {
      h.push('<button type="button" class="rmd-chip' + (st.tools[t].id === st.tool ? " rmd-chip-active" : "") + '" data-rmd-tool="' + esc(st.tools[t].id) + '">' + esc(st.tools[t].name) + '</button>');
    }
    h.push('</div>');

    if (st.error) h.push('<div style="padding:12px 16px">' + p2().errHtml(st.error, "rob-retry") + '</div>');
    h.push('<div class="rmd-phone-seg" role="tablist">');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "assess" ? " rmd-seg-active" : "") + '" data-rmd-rob-view="assess">Assess</button>');
    h.push('<button type="button" class="rmd-seg-btn' + (st.phoneView === "summary" ? " rmd-seg-active" : "") + '" data-rmd-rob-view="summary">Summary</button>');
    h.push('</div>');

    h.push('<div class="rmd-split-layout">');
    // Assess pane
    h.push('<div class="rmd-pane-left rmd-rob-form' + (st.phoneView !== "assess" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-extract-form-body">');
    if (st.assessmentLoading) h.push(p2().loadingHtml("Loading assessment"));
    if (st.actionError) h.push(p2().errHtml(st.actionError, null));
    if (st.announce) h.push('<div class="rmd-banner rmd-banner-info" aria-live="polite">' + esc(st.announce) + '</div>');
    if (a && a.outcome === "conflict") h.push('<div class="rmd-banner rmd-banner-warn">A conflict is open. Resolve it by consensus on the Summary pane.</div>');
    if (canAssess && (!a || !a.self || !a.self.submitted || a.outcome === "conflict")) {
      if (!st.ai) st.ai = SMD.ai.state();
      h.push(SMD.ai.barHtml(st.ai, { task: "rob", label: "risk of bias assessment", cost: 2 }));
      for (var d = 0; d < def.domains.length; d++) h.push(domainFormHtml(def.domains[d]));
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-block" data-rmd="rob-submit"' + (st.busy ? " disabled" : "") + '>Submit assessment</button>');
      h.push('<p class="rmd-muted">Your assessment is independent. The other assessor cannot see it until you both submit.</p>');
    } else if (!canAssess) {
      h.push('<p class="rmd-muted">Viewers see the summary only, not individual assessments.</p>');
    } else {
      h.push('<p class="rmd-muted">Assessment submitted.</p>');
    }
    h.push('</div></div>');
    // Summary pane
    h.push('<div class="rmd-pane-right rmd-rob-summary-pane' + (st.phoneView !== "summary" ? " rmd-phone-hidden" : "") + '">');
    h.push('<div class="rmd-section-block"><h4 class="rmd-section-label">Dual assessment</h4><div class="rmd-votes-box" aria-live="polite">');
    h.push(assessorLineHtml("You", a && a.self, false));
    h.push(assessorLineHtml("Assessor 2", a && a.peer, peerHidden));
    h.push('</div>');
    if (a && a.outcome) h.push('<p class="rmd-muted">Outcome: <strong>' + esc(a.outcome) + '</strong></p>');
    h.push('</div>');
    h.push(summaryHtml());
    h.push(consensusHtml(role));
    h.push('</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("\n");
    bind(container, role);
  }

  function bind(container, role) {
    function on(sel, fn) { var els = container.querySelectorAll(sel); for (var i = 0; i < els.length; i++) els[i].onclick = fn; }
    on('[data-rmd="to-projects"]', function () { SMD.navigate("projects"); });
    on('[data-rmd="rob-retry"]', function () { st.loaded = false; render(container); });
    var viewBtns = container.querySelectorAll("[data-rmd-rob-view]");
    for (var v = 0; v < viewBtns.length; v++) viewBtns[v].onclick = function () { st.phoneView = this.getAttribute("data-rmd-rob-view"); render(container); };
    var toolBtns = container.querySelectorAll("[data-rmd-tool]");
    for (var t = 0; t < toolBtns.length; t++) toolBtns[t].onclick = function () { st.tool = this.getAttribute("data-rmd-tool"); st.draft = {}; st.consensus = {}; st.announce = ""; loadAssessment(container); };
    var studySel = container.querySelector("#rmdRobStudy");
    if (studySel) studySel.onchange = function () { st.studyId = this.value; st.draft = {}; st.consensus = {}; loadAssessment(container); };

    var jSels = container.querySelectorAll("[data-rmd-judgment]");
    for (var j = 0; j < jSels.length; j++) jSels[j].onchange = function () { var k = this.getAttribute("data-rmd-judgment"); draftFor(k).judgment = this.value; SMD.ai.clearNote(st.ai, k); };
    var appSels = container.querySelectorAll("[data-rmd-app]");
    for (var ap = 0; ap < appSels.length; ap++) appSels[ap].onchange = function () { draftFor(this.getAttribute("data-rmd-app")).applicability = this.value; };
    var sqSels = container.querySelectorAll("[data-rmd-sq]");
    for (var q = 0; q < sqSels.length; q++) sqSels[q].onchange = function () {
      var parts = this.getAttribute("data-rmd-sq").split(":");
      draftFor(parts[0]).signallingAnswers[parts[1]] = this.value;
    };
    var quotes = container.querySelectorAll("[data-rmd-quote]");
    for (var q2 = 0; q2 < quotes.length; q2++) quotes[q2].oninput = function () { var k = this.getAttribute("data-rmd-quote"); draftFor(k).quote = this.value; SMD.ai.clearNote(st.ai, k); };
    var pages = container.querySelectorAll("[data-rmd-page]");
    for (var p = 0; p < pages.length; p++) pages[p].oninput = function () { draftFor(this.getAttribute("data-rmd-page")).page = this.value; };
    var stars = container.querySelectorAll("[data-rmd-star]");
    for (var s = 0; s < stars.length; s++) stars[s].onclick = function () {
      var parts = this.getAttribute("data-rmd-star").split(":");
      draftFor(parts[0]).stars = parseInt(parts[1], 10); render(container);
    };
    on('[data-rmd="rob-submit"]', function () { submit(container); });

    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: st.projectId, task: "rob", label: "risk of bias assessment", cost: 2,
        input: function () {
          var s = currentStudy() || {};
          var def = toolDef();
          var doms = [];
          for (var i = 0; i < def.domains.length; i++) doms.push({ key: def.domains[i].key, label: def.domains[i].label });
          return { tool: st.tool, studyLabel: s.label || "", text: studySourceText(), domains: doms };
        },
        apply: function (draft) {
          var d = draft || {};
          var items = d.domains || [];
          if (!items.length && d.studies) {
            /* server shape: studies[{ studyId, domains }]; take the study on screen */
            for (var si = 0; si < d.studies.length; si++) if (d.studies[si] && d.studies[si].studyId === st.studyId) items = d.studies[si].domains || [];
          }
          var text = studySourceText();
          var keys = [];
          for (var i = 0; i < items.length; i++) {
            var item = items[i];
            if (!item || !item.key) continue;
            var quote = typeof item.quote === "string" ? item.quote : "";
            if (!quote || text.indexOf(quote) < 0) continue;
            var dom = domainByKey(item.key);
            if (!dom) continue;
            var df = draftFor(item.key);
            df.quote = quote;
            var judgement = item.judgement || item.judgment || "";
            var allowed = dom.judgments || [];
            for (var j = 0; j < allowed.length; j++) {
              if (allowed[j] === judgement) { df.judgment = judgement; break; }
            }
            keys.push(item.key);
          }
          return keys;
        },
        render: function () { render(container); }
      });
    }

    var cSels = container.querySelectorAll("[data-rmd-consensus]");
    for (var c = 0; c < cSels.length; c++) cSels[c].onchange = function () { var k = this.getAttribute("data-rmd-consensus"); if (!st.consensus[k]) st.consensus[k] = {}; st.consensus[k].judgment = this.value; };
    var cQuotes = container.querySelectorAll("[data-rmd-consensus-quote]");
    for (var cq = 0; cq < cQuotes.length; cq++) cQuotes[cq].oninput = function () { var k = this.getAttribute("data-rmd-consensus-quote"); if (!st.consensus[k]) st.consensus[k] = {}; st.consensus[k].quote = this.value; };
    var cStars = container.querySelectorAll("[data-rmd-consensus-star]");
    for (var cs = 0; cs < cStars.length; cs++) cStars[cs].onclick = function () { var parts = this.getAttribute("data-rmd-consensus-star").split(":"); if (!st.consensus[parts[0]]) st.consensus[parts[0]] = {}; st.consensus[parts[0]].stars = parseInt(parts[1], 10); render(container); };
    var note = container.querySelector("#rmdRobNote");
    if (note) note.oninput = function () { st.note = this.value; };
    on('[data-rmd="rob-resolve"]', function () { resolve(container); });
  }

  SMD.screens.rob = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
