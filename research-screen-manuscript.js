/* StewardMD - ResearchMD Manuscript Editor Screen
 * (window.SMD_RESEARCH.screens.manuscript). ES5 only, buildless.
 * Tablet-first: full editor at >= 768px (section list beside editor);
 * on phone (< 768px) this screen is view and approve only.
 *
 * The editor shows plain prose. Analysis results appear as inline number
 * spans; the {{run:<id>.<field>}} source tokens live only in data attributes
 * and in the stored section text (docs/research/contracts/phase-5/tokens.md).
 * Save serialises the editor DOM back to the exact original token text.
 */
(function (G) {
  "use strict";

  var D = G.document;
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

  var TOKEN_RE = /\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}/g;

  function extractTokens(text) {
    var re = /\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}/g;
    var tokens = [];
    var m;
    while ((m = re.exec(text || "")) !== null) {
      tokens.push(m[0]);
    }
    return tokens;
  }

  function p2() { return SMD.p2 || {}; }

  var POLISH_REASONS = {
    grammar: "Grammar (sentence structure)",
    clarity: "Clarity (clear expression)",
    concision: "Concision (concise phrasing)",
    "academic tone": "Academic tone (formal scientific style)",
    academic_tone: "Academic tone (formal scientific style)",
    "tense consistency": "Tense consistency (matching verb tenses)",
    tense_consistency: "Tense consistency (matching verb tenses)",
    "british/american spelling": "Spelling (journal-preferred spelling)",
    "british spelling": "Spelling (British English)",
    "american spelling": "Spelling (American English)",
    spelling: "Spelling (journal-preferred spelling)"
  };

  function polishReasonLabel(r) {
    var k = String(r || "").toLowerCase();
    return POLISH_REASONS[k] || (r ? String(r) : "Refinement");
  }

  var IMRAD_SECTIONS = [
    { id: "abstract", label: "Abstract", hint: "A short summary: why, how, what you found, what it means." },
    { id: "introduction", label: "Introduction", hint: "Why this question matters and what is already known." },
    { id: "methods", label: "Methods", hint: "How you found the studies and combined their results." },
    { id: "results", label: "Results", hint: "What the combined analysis showed." },
    { id: "discussion", label: "Discussion", hint: "What the findings mean, their strengths and limits." }
  ];

  var EXTRA_SECTION_META = {
    title: { label: "Title Page", hint: "Concise title with study design or 'a case report'." },
    casePresentation: { label: "Case Presentation", hint: "De-identified patient story, examination, labs, imaging, and course." },
    timeline: { label: "Timeline", hint: "Chronological events from presentation to follow-up." },
    conclusion: { label: "Conclusion", hint: "Main clinical takeaway." },
    patientPerspective: { label: "Patient Perspective", hint: "Patient's own view on treatment and recovery." },
    learningPoints: { label: "Learning Points", hint: "3-5 clear clinical lessons for readers." }
  };

  function isPrimaryStudyType(proj) {
    var t = String((proj && (proj.studyType || proj.study_type)) || "").toLowerCase();
    if (!t) return false;
    return t.indexOf("case-report") >= 0 || t.indexOf("case report") >= 0 ||
      t.indexOf("case-series") >= 0 || t.indexOf("case series") >= 0 ||
      t.indexOf("case-control") >= 0 || t.indexOf("case control") >= 0 ||
      t.indexOf("cohort") >= 0 && t.indexOf("synthesis") < 0 ||
      t.indexOf("rct") >= 0 || t.indexOf("randomized controlled") >= 0 || t.indexOf("randomised controlled") >= 0 ||
      t.indexOf("trial") >= 0 && t.indexOf("trials") < 0 ||
      t.indexOf("master") >= 0 || t.indexOf("observational") >= 0 ||
      t.indexOf("cross-sectional") >= 0 || t.indexOf("cross sectional") >= 0 ||
      t.indexOf("thesis") >= 0;
  }

  function isCaseProject(proj) {
    var t = String((proj && (proj.studyType || proj.study_type)) || "").toLowerCase();
    return t.indexOf("case-report") >= 0 || t.indexOf("case report") >= 0 ||
      t.indexOf("case-series") >= 0 || t.indexOf("case series") >= 0;
  }

  /* Only the built-in BCG demo carries the seeded BCG manuscript. A new
   * project starts from an empty draft with its own title. */
  function isDemoProject(proj) {
    if (!proj) return false;
    if (proj.id === "prj_bcg_1994" || proj.serverId === "prj_bcg_1994") return true;
    if (!proj.tutorial) return false;
    var key = String(proj.tutorialKey || "");
    if (key === "sr") return true;
    var t = String(proj.studyType || "").toLowerCase();
    return t.indexOf("systematic review") >= 0 || t.indexOf("meta-analysis") >= 0 || t.indexOf("meta analysis") >= 0;
  }

  function sectionSidebarItems(man, proj) {
    var items = [];
    var seen = {};
    var secs = (man && man.sections) || [];
    var useOnlyMan = isCaseProject(proj);
    var i;
    if (!useOnlyMan) {
      for (i = 0; i < IMRAD_SECTIONS.length; i++) {
        seen[IMRAD_SECTIONS[i].id] = true;
        items.push(IMRAD_SECTIONS[i]);
      }
    }
    for (i = 0; i < secs.length; i++) {
      var s = secs[i];
      if (!s || !s.id || seen[s.id]) continue;
      seen[s.id] = true;
      var meta = EXTRA_SECTION_META[s.id];
      if (!meta) {
        for (var j = 0; j < IMRAD_SECTIONS.length; j++) {
          if (IMRAD_SECTIONS[j].id === s.id) { meta = IMRAD_SECTIONS[j]; break; }
        }
      }
      items.push({
        id: s.id,
        label: (meta && meta.label) || s.heading || s.id,
        hint: (meta && meta.hint) || "Manuscript section."
      });
    }
    return items.length ? items : IMRAD_SECTIONS;
  }

  var RULE_TABLE = {
    estimate: formatEffect,
    effect: formatEffect,
    yi: formatEffect,
    or: formatEffect,
    rr: formatEffect,
    rd: formatEffect,
    md: formatEffect,
    smd: formatEffect,
    hr: formatEffect,
    hedges_g: formatEffect,
    ciLower: formatEffect,
    ciUpper: formatEffect,
    ci_lower: formatEffect,
    ci_upper: formatEffect,
    tau2: formatEffect,
    tau: formatEffect,
    se: formatEffect,
    se_yi: formatEffect,
    q: formatEffect,
    p: formatApaP,
    pValue: formatApaP,
    p_value: formatApaP,
    pval: formatApaP,
    k: formatCount,
    n: formatCount,
    total: formatCount,
    sample_size: formatCount,
    count: formatCount,
    studies: formatCount,
    participants: formatCount,
    events: formatCount,
    events_intervention: formatCount,
    events_control: formatCount,
    df: formatCount,
    i2: formatHeterogeneity,
    i_squared: formatHeterogeneity
  };

  function formatEffect(v) {
    var n = Number(v);
    return isNaN(n) ? String(v) : n.toFixed(2);
  }

  function formatApaP(v) {
    var n = Number(v);
    if (isNaN(n)) return String(v);
    if (n < 0.001) return "< .001";
    if (n > 0.999) return "> .999";
    var s = n.toFixed(3);
    if (s.indexOf("0.") === 0) s = s.substring(1);
    return s;
  }

  function formatCount(v) {
    var n = Number(v);
    return isNaN(n) ? String(v) : String(Math.round(n));
  }

  function formatHeterogeneity(v) {
    var n = Number(v);
    return isNaN(n) ? String(v) : n.toFixed(1) + "%";
  }

  function formatCi(lo, hi, level) {
    var lvl = level || 95;
    return "(" + lvl + "% CI " + formatEffect(lo) + " to " + formatEffect(hi) + ")";
  }

  function formatTokenValue(fieldPath, value) {
    if (value == null) return "";
    var parts = String(fieldPath).split(".");
    var last = parts[parts.length - 1];
    if (RULE_TABLE[fieldPath]) return RULE_TABLE[fieldPath](value);
    if (RULE_TABLE[last]) return RULE_TABLE[last](value);
    if (typeof value === "number") return value.toFixed(2);
    return String(value);
  }

  /* Plain names: scientific term first, plain meaning in brackets. */
  var MEASURE_NAMES = {
    RR: "Risk ratio (RR)",
    OR: "Odds ratio (OR)",
    HR: "Hazard ratio (HR)",
    RD: "Risk difference (RD)",
    MD: "Mean difference (MD)",
    SMD: "Standardised mean difference (SMD)"
  };

  function fieldLabel(fieldPath, measure) {
    var parts = String(fieldPath).split(".");
    var f = parts[parts.length - 1];
    switch (f) {
      case "estimate": case "effect": case "yi": case "or": case "rr": case "rd":
      case "md": case "smd": case "hr": case "hedges_g":
        return (MEASURE_NAMES[measure] || "Pooled estimate") + " (combined result of all studies)";
      case "ciLower": case "ci_lower":
        return "95% CI lower limit (lower end of the range)";
      case "ciUpper": case "ci_upper":
        return "95% CI upper limit (upper end of the range)";
      case "p": case "pValue": case "p_value": case "pval":
        return "P value (how likely a result this extreme is due to chance)";
      case "i2": case "i_squared":
        return "I2 (how much the studies disagree)";
      case "tau2":
        return "Tau2 (between-study spread)";
      case "tau":
        return "Tau (between-study spread, in the same units as the effect)";
      case "k": case "studies":
        return "k (number of studies)";
      case "n": case "total": case "sample_size": case "participants":
        return "n (number of patients)";
      case "q":
        return "Cochran Q (test for whether the studies disagree)";
      case "df":
        return "Degrees of freedom (number of studies minus one)";
      case "se": case "se_yi":
        return "Standard error (precision of the estimate)";
      case "events": case "events_intervention": case "events_control":
        return "Event count (patients with the outcome)";
    }
    return "Result from your analysis";
  }

  /* State */
  var st = {
    projectId: null,
    loading: false,
    error: null,
    manuscript: null,
    versions: [],
    selectedSectionId: "results",
    viewMode: "editor", /* "editor" | "versions" | "diff" */
    diffBaseVersion: 1,
    diffTargetVersion: 2,
    diffSectionId: "results",
    gateFailures: [],
    exporting: false,
    exportNotice: null,
    exportNoticeKind: "warn",
    saveNotice: null,
    phoneTab: "sections", /* "sections" | "detail" | "approve" */
    lastRange: null,
    ai: null,
    polishBusy: false,
    polishError: null,
    polishDraft: null,
    poJobId: null,
    poStatus: null,
    poError: null,
    poCreating: false,
    poConfirm: null,
    poQuoteMicroUsd: null,
    poQuoteSource: ""
  };

  var seq = 0;
  var lastContainer = null;
  var mqlBound = false;
  var poTimer = null;
  var manuscriptMissing = {};
  var loadError = null;

  function bindBreakpoint() {
    if (mqlBound || !G.matchMedia) return;
    try {
      var mql = G.matchMedia("(max-width: 767px)");
      var fn = function () {
        if (lastContainer && D.body && D.body.contains(lastContainer)) render(lastContainer);
      };
      if (mql.addEventListener) mql.addEventListener("change", fn);
      else if (mql.addListener) mql.addListener(fn);
      if (G.addEventListener) G.addEventListener("resize", fn);
      mqlBound = true;
    } catch (e) {}
  }

  function isPhone() {
    try {
      if (G.matchMedia) return G.matchMedia("(max-width: 767px)").matches;
    } catch (e) {}
    return (G.innerWidth || 1024) < 768;
  }

  function activeProjectId() {
    var store = SMD.store;
    var ap = store ? store.getActiveProject() : null;
    return (ap && ap.id) || st.projectId || "prj_bcg_1994";
  }

  function apiProjectId() {
    var store = SMD.store;
    var ap = store ? store.getActiveProject() : null;
    return (ap && (ap.serverId || ap.id)) || st.projectId || "prj_bcg_1994";
  }

  /* Default seed manuscript when API initializes fresh draft */
  function defaultManuscript(pid) {
    var store = SMD.store;
    var proj = (store && store.getProject) ? (store.getProject(pid) || store.getActiveProject()) : null;
    if (isCaseProject(proj)) {
      return {
        id: "man_v1",
        projectId: pid,
        version: 1,
        title: (proj && proj.title) || "Clinical Case Report",
        authors: [],
        affiliations: "",
        status: "draft",
        sections: [
          { id: "abstract", heading: "Abstract", level: 1, text: "" },
          { id: "introduction", heading: "Introduction", level: 1, text: "" },
          { id: "casePresentation", heading: "Case Presentation", level: 1, text: "" },
          { id: "timeline", heading: "Timeline", level: 1, text: "" },
          { id: "discussion", heading: "Discussion", level: 1, text: "" },
          { id: "conclusion", heading: "Conclusion", level: 1, text: "" }
        ],
        tokens: {},
        references: [],
        approval: null,
        lock: null
      };
    }
    if (isPrimaryStudyType(proj)) {
      return {
        id: "man_v1",
        projectId: pid,
        version: 1,
        title: (proj && proj.title) || "Clinical Research Manuscript",
        authors: [],
        affiliations: "",
        status: "draft",
        sections: [
          { id: "abstract", heading: "Abstract", level: 1, text: "" },
          { id: "introduction", heading: "Introduction", level: 1, text: "" },
          { id: "methods", heading: "Methods", level: 1, text: "" },
          { id: "results", heading: "Results", level: 1, text: "" },
          { id: "discussion", heading: "Discussion", level: 1, text: "" }
        ],
        tokens: {},
        references: [],
        approval: null,
        lock: null
      };
    }
    if (!isDemoProject(proj)) {
      return {
        id: "man_v1",
        projectId: pid,
        version: 1,
        title: (proj && proj.title) || "Research manuscript",
        authors: [],
        affiliations: "",
        status: "draft",
        sections: [
          { id: "abstract", heading: "Abstract", level: 1, text: "" },
          { id: "introduction", heading: "Introduction", level: 1, text: "" },
          { id: "methods", heading: "Methods", level: 1, text: "" },
          { id: "results", heading: "Results", level: 1, text: "" },
          { id: "discussion", heading: "Discussion", level: 1, text: "" }
        ],
        tokens: {},
        references: [],
        approval: null,
        lock: null
      };
    }
    return {
      id: "man_v2",
      projectId: pid,
      version: 2,
      title: "BCG vaccination against tuberculosis: systematic review and meta-analysis",
      authors: ["A. Clinician", "B. Statistician"],
      affiliations: "StewardMD Clinical Research Collaborative",
      status: "draft",
      sections: [
        {
          id: "abstract",
          heading: "Abstract",
          level: 1,
          text: "Objective: Evaluate BCG efficacy against tuberculosis.\nMethods: Systematic review of randomized trials.\nResults: BCG reduced tuberculosis risk (RR {{run:run_1.estimate}}, 95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Heterogeneity was moderate (I2 {{run:run_1.i2}}).\nConclusion: BCG vaccination demonstrates significant protective efficacy."
        },
        {
          id: "introduction",
          heading: "Introduction",
          level: 1,
          text: "Tuberculosis remains a major public health challenge worldwide [@who2023]. The Bacillus Calmette-Guerin vaccine has been evaluated across multiple distinct populations [@colditz1994]."
        },
        {
          id: "methods",
          heading: "Methods",
          level: 1,
          text: "We conducted a systematic review following PRISMA 2020 guidelines. Eligible studies included randomized controlled trials reporting tuberculosis incidence in vaccinated and control cohorts."
        },
        {
          id: "results",
          heading: "Results",
          level: 1,
          text: "A total of {{run:run_1.k}} trials were included. The pooled relative risk was {{run:run_1.estimate}} (95% CI {{run:run_1.ciLower}} to {{run:run_1.ciUpper}}, p {{run:run_1.p}}). Between-study heterogeneity was observed (I2 {{run:run_1.i2}}, tau2 {{run:run_1.tau2}})."
        },
        {
          id: "discussion",
          heading: "Discussion",
          level: 1,
          text: "Our findings confirm substantial protective efficacy of BCG vaccination against clinical tuberculosis. These results support current WHO recommendations for infant vaccination in high-incidence settings [@who2023]."
        }
      ],
      tokens: {
        "run_1:estimate": { value: 0.49, formatted: "0.49" },
        "run_1:ciLower": { value: 0.34, formatted: "0.34" },
        "run_1:ciUpper": { value: 0.70, formatted: "0.70" },
        "run_1:p": { value: 0.0001, formatted: "< .001" },
        "run_1:k": { value: 13, formatted: "13" },
        "run_1:i2": { value: 72.8, formatted: "72.8%" },
        "run_1:tau2": { value: 0.36, formatted: "0.36" }
      },
      references: [
        { key: "colditz1994", title: "Efficacy of BCG vaccine in the prevention of tuberculosis", doi: "10.1001/jama.1994.03510370074034", pmid: "8309034" },
        { key: "who2023", title: "Global Tuberculosis Report 2023", doi: "10.1016/S0140-6736(23)02145-X" }
      ],
      approval: null,
      lock: null
    };
  }

  function defaultVersions(proj) {
    if (!isDemoProject(proj)) return [];
    return [
      {
        id: "man_v1",
        version: 1,
        title: "BCG vaccination against tuberculosis: systematic review and meta-analysis",
        status: "locked",
        sectionCount: 5,
        referenceCount: 2,
        versionHash: "9b1c7849e8a5b28d051e948f21915f02bc34220fa1689255a01bc89fb13632ef",
        createdAt: "2026-11-20T10:00:00Z",
        createdBy: "researcher",
        lockedAt: "2026-11-20T10:30:00Z",
        lockedBy: "clinician"
      },
      {
        id: "man_v2",
        version: 2,
        title: "BCG vaccination against tuberculosis: systematic review and meta-analysis",
        status: "draft",
        sectionCount: 5,
        referenceCount: 2,
        createdAt: "2026-11-21T09:00:00Z",
        createdBy: "researcher"
      }
    ];
  }

  /* PaperOrchestra feature flag (Task 1) */
  function isPoEnabled() {
    try {
      if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
        return localStorage.getItem("smd_rmd_po") !== "0";
      }
    } catch (e) {}
    return false;
  }

  /* On-device drafting flag: DEFAULT ON. Off per device with localStorage.smd_rmd_ondevice_draft = "0" */
  function isOnDeviceDraftEnabled() {
    try {
      if (typeof localStorage !== "undefined" && localStorage && typeof localStorage.getItem === "function") {
        return localStorage.getItem("smd_rmd_ondevice_draft") !== "0";
      }
    } catch (e) {}
    return true;
  }

  function useOnDeviceDraft() {
    return isOnDeviceDraftEnabled() && !!(G && G.SMD_RMD_ONDEVICE_DRAFT && typeof G.SMD_RMD_ONDEVICE_DRAFT.run === "function");
  }

  var PO_ERROR_MESSAGES = {
    not_systematic_review: "Full drafts are only available for systematic review projects.",
    protocol_unlocked: "Lock the research protocol before drafting the manuscript.",
    no_saved_run: "Run and save at least one analysis before drafting the manuscript.",
    job_active: "A draft job is already running for this project.",
    cap_po_project_daily: "Daily draft limit reached for this project. Try again tomorrow.",
    cap_po_user_daily: "Daily draft limit reached for your account. Try again tomorrow.",
    insufficient_credits: "Not enough research credits for this draft. Top up your wallet to continue.",
    phi_blocked: "Patient identifiers were detected. Remove personal identifiers and try again.",
    gate_failed: "Draft failed integrity checks for numbers, citations, or claim links.",
    ceiling_calls: "Draft reached the 64-call limit before completing.",
    ceiling_seconds: "Draft exceeded the step time limit.",
    invalid_snapshot: "Project snapshot is incomplete or contains unverified data.",
    device_failed: "Could not complete draft on this device. Try again.",
    not_found: "Feature not available yet."
  };

  function mapPoError(err) {
    if (!err) return "Could not complete draft. Try again.";
    var code = "";
    if (typeof err === "string") {
      code = err;
    } else if (err.error && typeof err.error === "object") {
      code = err.error.code || "";
    } else if (err.error_code) {
      code = err.error_code;
    } else if (err.errorCode) {
      code = err.errorCode;
    } else if (err.code) {
      code = err.code;
    }
    if (err.status === 404 || code === "not_found") {
      return PO_ERROR_MESSAGES.not_found;
    }
    if (code && PO_ERROR_MESSAGES[code]) {
      return PO_ERROR_MESSAGES[code];
    }
    if (err.status === 402) {
      return PO_ERROR_MESSAGES.insufficient_credits;
    }
    var msg = (err.error && err.error.message) || err.message || "";
    if (msg) return String(msg).replace(/[\u2014\u2013]/g, "-");
    return "Could not complete draft. Try again.";
  }

  function getPoStatusText() {
    if (st.poStatus === "cancelled") return "Cancelled";
    if (st.poCancelError) return st.poCancelError;
    if (st.poStatus === "paused") return "Saved on this device. Try again later.";
    if (st.poStatus === "queued") return st.poProgress || "Queued";
    if (st.poStatus === "running") return st.poRetryText || st.poProgress || "Writing the draft";
    if (st.poStatus === "succeeded") return "Done";
    if (st.poStatus === "failed") return "Failed: " + (st.poError || "Draft failed.");
    return "";
  }

  function poStatusHtml() {
    if (!isPoEnabled()) return "";
    var isJobActive = st.poCreating || st.poStatus === "queued" || st.poStatus === "running";
    var statusText = getPoStatusText();
    var inner = "";
    if (statusText) {
      var stateClass = "";
      if (st.poStatus === "succeeded") {
        stateClass = " rmd-po-status-ok rmd-verify-ok";
      } else if (st.poStatus === "failed") {
        stateClass = " rmd-po-status-err";
      } else if (st.poStatus === "cancelled" || st.poStatus === "paused" || st.poCancelError) {
        stateClass = " rmd-po-status-warn rmd-verify-warn";
      }
      inner = '<span class="rmd-po-status-text' + stateClass + '">' + esc(statusText) + '</span>';
      if (isJobActive && st.poJobId) {
        inner += ' <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="po-cancel">Cancel</button>';
      }
    }
    var privLine = useOnDeviceDraft()
      ? '<div class="rmd-muted rmd-device-privacy" style="font-size:12px;margin-top:4px;">' + esc((G && G.SMD_RMD_JOBS && G.SMD_RMD_JOBS.DEVICE_PRIVACY_LINE) || "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.") + '</div>'
      : "";
    return '<div class="rmd-po-status" aria-live="polite">' + inner + privLine + '</div>';
  }

  function clearPoPoll() {
    if (poTimer) {
      clearInterval(poTimer);
      poTimer = null;
    }
  }

  function reloadVersions(container) {
    var base = "/v1/projects/" + encodeURIComponent(apiProjectId());
    var pMan = SMD.api ? SMD.api.request("GET", base + "/manuscript") : Promise.resolve(null);
    var pVers = SMD.api ? SMD.api.request("GET", base + "/manuscript/versions") : Promise.resolve(null);
    var target = container || lastContainer;
    return Promise.all([pMan, pVers]).then(function (res) {
      if (res[0] && res[0].manuscript) {
        st.manuscript = res[0].manuscript;
        manuscriptMissing[apiProjectId()] = false;
      }
      if (res[1] && res[1].versions) {
        st.versions = res[1].versions;
      }
      if (target) render(target);
    }).catch(function () {
      if (target) render(target);
    });
  }

  function pollPoJob(container, jobId) {
    var target = container || lastContainer;
    if (!target || (D.body && !D.body.contains(target))) {
      clearPoPoll();
      return Promise.resolve(null);
    }
    if (!SMD.api || typeof SMD.api.request !== "function") return Promise.resolve(null);
    return SMD.api.request("GET", "/v1/jobs/" + encodeURIComponent(jobId)).then(function (res) {
      st.poFailures = 0;
      var job = (res && res.job) || res;
      var status = job && job.status;
      if (status === "succeeded" || status === "done") {
        clearPoPoll();
        st.poStatus = "succeeded";
        st.poError = null;
        st.poCancelError = null;
        reloadVersions(target);
      } else if (status === "failed") {
        clearPoPoll();
        st.poStatus = "failed";
        st.poError = mapPoError(job);
        st.poCancelError = null;
        if (target) render(target);
      } else if (status === "running") {
        if (st.poStatus !== "running") {
          st.poStatus = "running";
          if (target) render(target);
        }
      } else if (status === "queued") {
        if (st.poStatus !== "queued") {
          st.poStatus = "queued";
          if (target) render(target);
        }
      }
      return job;
    }).catch(function (err) {
      var status = (err && (err.status || err.statusCode || (err.error && err.error.status))) || 0;
      var code = (err && (err.code || (err.error && err.error.code))) || "";
      if (status === 404 || status === 403 || code === "not_found" || code === "forbidden") {
        clearPoPoll();
        st.poStatus = "failed";
        st.poError = mapPoError(err);
        st.poCancelError = null;
        if (target) render(target);
        return;
      }
      st.poFailures = (st.poFailures || 0) + 1;
      if (st.poFailures >= 3) {
        clearPoPoll();
        st.poStatus = "failed";
        st.poError = mapPoError(err);
        st.poCancelError = null;
        if (target) render(target);
      }
    });
  }

  function startPoPoll(container, jobId) {
    clearPoPoll();
    if (!jobId) return;
    st.poFailures = 0;
    poTimer = setInterval(function () {
      pollPoJob(container, jobId);
    }, 10000);
  }

  function quoteUsdText(micro) {
    var usd = Number(micro) / 1000000;
    if (!isFinite(usd) || usd <= 0) return "";
    return "$" + (usd >= 0.01 ? usd.toFixed(2) : usd.toFixed(4));
  }

  function poQuoteNote() {
    if (st.poQuoteMicroUsd != null) {
      return "Server quote: " + quoteUsdText(st.poQuoteMicroUsd) + " for up to 64 model calls.";
    }
    return "Cost shown before the draft starts. The server quotes this job separately from Ask MaiK.";
  }

  function poConfirmHtml() {
    if (!st.poConfirm) return "";
    var q = st.poConfirm.quote;
    var sentence = (q != null)
      ? "The server quotes " + esc(quoteUsdText(q)) + " for up to 64 model calls."
      : "Cost shown before the draft starts. The server quotes the exact cost when the job is created, and you can cancel while it is queued.";
    var h = [];
    h.push('<div class="rmd-po-confirm" role="group" aria-label="Confirm the full draft">');
    h.push('  <p><strong>Start a full draft?</strong> PaperOrchestra writes every section from your locked protocol, verified studies and saved analysis. You review and approve the result.</p>');
    h.push('  <p class="rmd-po-cost-note" data-rmd-po-quote>' + sentence + '</p>');
    h.push('  <div class="rmd-po-confirm-actions">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="po-start">Start draft</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="po-dismiss">Cancel</button>');
    h.push('  </div>');
    h.push('</div>');
    return h.join("\n");
  }

  function poBlockHtml() {
    if (!isPoEnabled()) return "";
    var isPoActive = st.poCreating || st.poStatus === "queued" || st.poStatus === "running";
    var h = [];
    h.push('<div class="rmd-po-block">');
    h.push('  <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="full-draft-po"' + (isPoActive ? ' disabled="disabled"' : '') + '>Full draft (PaperOrchestra)</button>');
    if (!isPoActive && st.poResumeCheckpoint && isOnDeviceDraftEnabled()) {
      h.push('  <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="po-continue">Continue draft</button>');
    }
    h.push('  <p class="rmd-po-cost-note" data-rmd-po-cost>' + esc(poQuoteNote()) + '</p>');
    h.push(poConfirmHtml());
    h.push(poStatusHtml());
    h.push('</div>');
    return h.join("\n");
  }

  /* Confirm the job and, when the server exposes a quote endpoint, show its
   * number before anything is reserved. A missing endpoint falls back to the
   * honest label instead of borrowing the Ask MaiK token estimate. */
  function openPoConfirm(container) {
    if (st.poCreating || st.poStatus === "queued" || st.poStatus === "running") return;
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    st.poConfirm = { quote: st.poQuoteMicroUsd };
    render(container);
    if (!SMD.api || !proj || !proj.serverId || proj.tutorial || proj.practice) return;
    SMD.api.request("GET", "/v1/projects/" + encodeURIComponent(proj.serverId) + "/jobs/quote?kind=manuscript_draft").then(function (res) {
      var micro = res && (res.quoteMicroUsd != null ? res.quoteMicroUsd : (res.quote && res.quote.quoteMicroUsd));
      if (micro == null) return;
      st.poQuoteMicroUsd = micro;
      st.poQuoteSource = "server";
      if (st.poConfirm) st.poConfirm.quote = micro;
      render(container);
    }, function () {
      /* No quote endpoint yet: keep the honest fallback sentence. */
    });
  }

  function draftJobsRunner() {
    var j = G && G.SMD_RMD_JOBS;
    return (j && typeof j.runWithFallback === "function") ? j : null;
  }

  function runOnDeviceDraft(target, jobBundle, resume) {
    st.poStatus = "running";
    st.poProgress = "Drafting on this device: outline";
    st.poRetryText = null;
    st.poError = null;
    st.poCancelError = null;
    st.poCancelled = false;
    st.poResumeCheckpoint = null;
    if (target) render(target);

    var jobId = jobBundle && jobBundle.job && jobBundle.job.id;
    var pid = apiProjectId();
    var JR = draftJobsRunner();

    if (!JR) {
      return G.SMD_RMD_ONDEVICE_DRAFT.run(jobBundle, {
        resume: !!resume,
        onProgress: function (info) {
          if (st.poCancelled) return;
          if (info && info.label) {
            st.poProgress = info.label;
            if (target) render(target);
          }
        },
        isCancelled: function () {
          return !!st.poCancelled;
        }
      }).then(function () {
        if (st.poCancelled) return;
        st.poStatus = "succeeded";
        st.poProgress = null;
        st.poError = null;
        st.poResumeCheckpoint = null;
        reloadVersions(target);
      }).catch(function (err) {
        if (st.poCancelled || (err && err.code === "cancelled")) return;
        st.poStatus = "failed";
        st.poProgress = null;
        st.poError = mapPoError(err);
        st.poResumeCheckpoint = null;
        if (target) render(target);
      });
    }

    var deferredFail = null;
    function wrappedApiRequest(method, url, body) {
      if (method === "POST" && /\/v1\/jobs\/[^/]+\/device-fail$/.test(String(url || ""))) {
        deferredFail = { url: url, body: body };
        return Promise.resolve({ deferred: true });
      }
      return SMD.api.request(method, url, body);
    }

    return JR.runWithFallback("draft", function (resumeCtx) {
      deferredFail = null;
      return G.SMD_RMD_ONDEVICE_DRAFT.run(jobBundle, {
        resume: !!(resume || (resumeCtx && resumeCtx.resume)),
        signal: resumeCtx && resumeCtx.signal,
        apiRequest: wrappedApiRequest,
        onProgress: function (info) {
          if (resumeCtx && resumeCtx.touchStep && info && info.step) {
            resumeCtx.touchStep(info.step);
          }
          if (st.poCancelled) return;
          if (info && info.label) {
            st.poProgress = info.label;
            if (target) render(target);
          }
        },
        isCancelled: function () {
          return !!st.poCancelled;
        }
      });
    }, function (latestCp, fallbackMeta) {
      if (!jobId || !SMD.api || typeof SMD.api.request !== "function") {
        return Promise.reject(new Error("Missing job ID for cloud continuation"));
      }
      return SMD.api.request("POST", "/v1/jobs/" + encodeURIComponent(jobId) + "/to-cloud", {
        fallback: fallbackMeta
      }).then(function (cloudRes) {
        st.poStatus = "queued";
        st.poRetryText = null;
        st.poProgress = "Continuing draft in StewardMD cloud...";
        st.poError = null;
        if (target) render(target);
        startPoPoll(target, jobId);
        return cloudRes;
      });
    }, {
      jobKey: "draft:" + (jobId || pid),
      projectId: pid,
      targetId: jobId || "draft",
      engine: "ondevice:draft",
      onStatus: function (info) {
        if (st.poCancelled) return;
        if (info && info.state === "retrying" && info.message) {
          st.poRetryText = info.message;
          st.poProgress = info.message;
          if (target) render(target);
        }
      }
    }).then(function (out) {
      if (st.poCancelled) return;
      st.poRetryText = null;
      if (out && out.ok && out.source === "device") {
        st.poStatus = "succeeded";
        st.poProgress = null;
        st.poError = null;
        st.poResumeCheckpoint = null;
        reloadVersions(target);
        return;
      }
      if (out && out.ok && out.source === "cloud") {
        return;
      }
      st.poProgress = null;
      if (out && out.state === "cancelled_to_device") {
        st.poStatus = "paused";
        st.poError = null;
        checkResumeCheckpoint(target, pid);
        if (target) render(target);
        return;
      }
      st.poStatus = "failed";
      st.poError = (out && out.message) || "Could not continue to cloud.";
      checkResumeCheckpoint(target, pid);
      if (target) render(target);
    }).catch(function (err) {
      st.poRetryText = null;
      if (st.poCancelled || (err && err.code === "cancelled")) return;
      if (deferredFail && err && err.rmdState === "data_problem" && SMD.api && typeof SMD.api.request === "function") {
        SMD.api.request("POST", deferredFail.url, deferredFail.body).catch(function () {});
      }
      st.poProgress = null;
      if (err && err.rmdState === "offline") {
        st.poStatus = "paused";
        st.poError = "Offline. Saved on this device where it stopped.";
        checkResumeCheckpoint(target, pid);
        if (target) render(target);
        return;
      }
      st.poStatus = "failed";
      st.poError = mapPoError(err);
      st.poResumeCheckpoint = null;
      if (target) render(target);
    });
  }

  function checkResumeCheckpoint(container, pid) {
    var cp = G && G.SMD_RMD_CHECKPOINT;
    if (!isOnDeviceDraftEnabled() || !cp || typeof cp.list !== "function") {
      st.poResumeCheckpoint = null;
      return Promise.resolve(null);
    }
    return cp.list("draft:").then(function (items) {
      var found = null;
      for (var i = 0; i < (items || []).length; i++) {
        var rec = items[i] && items[i].value;
        if (!rec || rec.projectId !== pid) continue;
        if (rec.status === "succeeded" || rec.status === "failed") continue;
        if (!found || (rec.updatedAt || "") > (found.updatedAt || "")) {
          found = rec;
        }
      }
      st.poResumeCheckpoint = found;
      if (found && container && st.projectId === activeProjectId()) render(container);
      return found;
    }).catch(function () {
      return null;
    });
  }

  function continuePoDraft(container) {
    var cp = st.poResumeCheckpoint;
    var target = container || lastContainer;
    if (!cp || !cp.jobId || !SMD.api || typeof SMD.api.request !== "function") return;
    if (!useOnDeviceDraft()) return;
    if (st.poCreating || st.poStatus === "queued" || st.poStatus === "running") return;

    st.poCreating = true;
    st.poStatus = "running";
    st.poProgress = "Drafting on this device: resuming";
    st.poJobId = cp.jobId;
    st.poError = null;
    if (target) render(target);

    SMD.api.request("GET", "/v1/jobs/" + encodeURIComponent(cp.jobId)).then(function (res) {
      var job = (res && res.job) || res;
      if (!job || (job.status !== "queued" && job.status !== "running")) {
        st.poCreating = false;
        st.poProgress = null;
        st.poResumeCheckpoint = null;
        if (G.SMD_RMD_CHECKPOINT && typeof G.SMD_RMD_CHECKPOINT.remove === "function") {
          G.SMD_RMD_CHECKPOINT.remove("draft:" + cp.jobId).catch(function () {});
        }
        if (job && job.status === "succeeded") {
          st.poStatus = "succeeded";
          reloadVersions(target);
        } else if (job && job.status === "cancelled") {
          st.poStatus = "cancelled";
          if (target) render(target);
        } else {
          st.poStatus = "failed";
          st.poError = mapPoError(job);
          if (target) render(target);
        }
        return;
      }
      return SMD.api.request("POST", "/v1/jobs/" + encodeURIComponent(cp.jobId) + "/token").then(function (tokRes) {
        st.poCreating = false;
        return runOnDeviceDraft(target, {
          job: job,
          manifest: cp.manifest,
          token: tokRes && tokRes.token
        }, true);
      });
    }).catch(function (err) {
      st.poCreating = false;
      st.poProgress = null;
      st.poStatus = "failed";
      st.poError = mapPoError(err);
      if (target) render(target);
    });
  }

  function startPoDraft(container) {
    if (st.poCreating || st.poStatus === "queued" || st.poStatus === "running") return;
    var target = container || lastContainer;
    if (!SMD.api || typeof SMD.api.request !== "function") {
      st.poStatus = "failed";
      st.poError = "API not available";
      if (target) render(target);
      return;
    }
    clearPoPoll();
    st.poCreating = true;
    st.poStatus = "queued";
    st.poProgress = null;
    st.poCancelled = false;
    st.poError = null;
    st.poJobId = null;
    st.poCancelling = false;
    st.poCancelError = null;
    st.poFailures = 0;
    st.poConfirm = null;
    if (target) render(target);

    var pid = encodeURIComponent(apiProjectId());
    var randKey = "po_" + Date.now() + "_" + Math.random().toString(36).slice(2, 10);
    var onDevice = useOnDeviceDraft();
    var body = {
      kind: "manuscript_draft",
      idempotencyKey: randKey
    };
    if (onDevice) body.runner = "device";
    var store = SMD.store;
    /* The job reads studies and runs on the server. Let the immediate study
     * and run writes land first so a fresh Calculate is included. */
    var ready = (store && typeof store.pendingSync === "function") ? store.pendingSync() : Promise.resolve(true);

    ready.then(function () {
      return SMD.api.request("POST", "/v1/projects/" + pid + "/jobs", body);
    }).then(function (res) {
      st.poCreating = false;
      var job = (res && res.job) || (res && res.jobs && res.jobs[0]) || res;
      var jid = (job && job.id) || (res && res.jobId) || (res && res.id);
      var jStatus = (job && job.status) || "queued";
      st.poJobId = jid;
      st.poStatus = jStatus;
      var ceilings = job && job.ceilings;
      if (ceilings && ceilings.quoteMicroUsd != null) {
        st.poQuoteMicroUsd = ceilings.quoteMicroUsd;
        st.poQuoteSource = "server";
      }

      if (jStatus === "succeeded" || jStatus === "done") {
        st.poStatus = "succeeded";
        reloadVersions(target);
      } else if (jStatus === "failed") {
        st.poStatus = "failed";
        st.poError = mapPoError(job);
        if (target) render(target);
      } else if (onDevice && res && res.manifest && res.token) {
        runOnDeviceDraft(target, { job: job, manifest: res.manifest, token: res.token }, false);
      } else {
        if (target) render(target);
        if (jid) {
          startPoPoll(target, jid);
        }
      }
    }).catch(function (err) {
      st.poCreating = false;
      st.poStatus = "failed";
      st.poProgress = null;
      st.poError = mapPoError(err);
      clearPoPoll();
      if (target) render(target);
    });
  }

  function cancelPoJob(container) {
    var jid = st.poJobId;
    var target = container || lastContainer;
    if (!jid || !SMD.api || typeof SMD.api.request !== "function") return;
    st.poCancelling = true;
    st.poCancelError = null;
    st.poCancelled = true;

    SMD.api.request("POST", "/v1/jobs/" + encodeURIComponent(jid) + "/cancel").then(function () {
      clearPoPoll();
      st.poCancelling = false;
      st.poStatus = "cancelled";
      st.poProgress = null;
      st.poCancelError = null;
      st.poResumeCheckpoint = null;
      if (G.SMD_RMD_CHECKPOINT && typeof G.SMD_RMD_CHECKPOINT.remove === "function") {
        G.SMD_RMD_CHECKPOINT.remove("draft:" + jid).catch(function () {});
      }
      if (target) render(target);
    }).catch(function () {
      st.poCancelling = false;
      st.poCancelError = "Could not cancel. Try again.";
      if (target) render(target);
    });
  }

  /* Load manuscript and version data */
  function load(container, params) {
    var mySeq = ++seq;
    var newPid = activeProjectId();
    if (st.projectId !== newPid) {
      st.ai = null;
      st.polishBusy = false;
      st.polishError = null;
      st.polishDraft = null;
      clearPoPoll();
      st.poJobId = null;
      st.poStatus = null;
      st.poProgress = null;
      st.poCancelled = false;
      st.poResumeCheckpoint = null;
      st.poError = null;
      st.poCreating = false;
      st.poCancelling = false;
      st.poCancelError = null;
      st.poFailures = 0;
      st.poConfirm = null;
      st.poQuoteMicroUsd = null;
      st.poQuoteSource = "";
    }
    st.projectId = newPid;
    if (params && params.sectionId) {
      st.selectedSectionId = params.sectionId;
      st.viewMode = "editor";
      if (isPhone()) st.phoneTab = "detail";
    }
    st.loading = true;
    st.error = null;
    st.saveNotice = null;
    loadError = null;

    var mpid = apiProjectId();
    var base = "/v1/projects/" + encodeURIComponent(mpid);
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    /* A new project has no manuscript yet. After one 404 the screen knows
     * there is nothing to fetch, so later tab opens stay quiet. */
    var knownMissing = !!manuscriptMissing[mpid];
    var pMan = (SMD.api && !knownMissing) ? SMD.api.request("GET", base + "/manuscript") : Promise.resolve(null);
    var pVers = (SMD.api && !knownMissing) ? SMD.api.request("GET", base + "/manuscript/versions") : Promise.resolve(null);

    Promise.all([pMan, pVers]).then(function (res) {
      if (mySeq !== seq) return;
      st.loading = false;
      if (res[0] && res[0].manuscript) manuscriptMissing[mpid] = false;
      st.manuscript = (res[0] && res[0].manuscript) || localManuscript(st.projectId) || defaultManuscript(st.projectId);
      st.versions = (res[1] && res[1].versions) || defaultVersions(proj);
      if (!params || !params.sectionId) {
        var foundSel = false;
        var mSecs = (st.manuscript && st.manuscript.sections) || [];
        for (var si = 0; si < mSecs.length; si++) {
          if (mSecs[si].id === st.selectedSectionId) { foundSel = true; break; }
        }
        if (!foundSel && mSecs.length) st.selectedSectionId = mSecs[0].id;
      }
      render(container);
      checkResumeCheckpoint(container, mpid);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      if (err && (err.status === 404 || err.code === "manuscript_not_found" || err.code === "not_found")) {
        manuscriptMissing[mpid] = true;
      } else {
        loadError = String((err && (err.message || (err.error && err.error.message))) || "Could not load the manuscript.")
          .replace(/[\u2014\u2013]/g, "-");
      }
      /* Fallback to local default if API unmocked or offline */
      st.manuscript = localManuscript(st.projectId) || defaultManuscript(st.projectId);
      st.versions = defaultVersions(proj);
      if (!params || !params.sectionId) {
        var foundSelC = false;
        var mSecsC = (st.manuscript && st.manuscript.sections) || [];
        for (var sj = 0; sj < mSecsC.length; sj++) {
          if (mSecsC[sj].id === st.selectedSectionId) { foundSelC = true; break; }
        }
        if (!foundSelC && mSecsC.length) st.selectedSectionId = mSecsC[0].id;
      }
      render(container);
      checkResumeCheckpoint(container, mpid);
    });
  }

  function manuscriptAiError(err, fallbackMsg) {
    if (!err) return { message: fallbackMsg || "MaiK could not complete this request. Try again." };
    var code = err.code || "";
    var msg = String(err.message || "");
    if (code === "invalid_body") {
      if (/5000|character/i.test(msg)) {
        return { message: "This section is over the 5,000-character limit for one polish pass. Shorten it and try again." };
      }
      if (/section text is required|write a few lines/i.test(msg)) {
        return { message: "Write a few lines first before asking MaiK to polish the wording." };
      }
      if (/thesis text is required/i.test(msg)) {
        return { message: "Upload or paste your thesis text first before drafting from a thesis." };
      }
      return { message: msg || fallbackMsg || "Check the section text and try again." };
    }
    if (code === "manuscript_not_found" || code === "section_not_found") {
      return { message: "Write a few lines first or save this section before asking MaiK." };
    }
    if (code === "invalid_draft") {
      return { message: msg || "MaiK's draft did not pass safety checks. Try again." };
    }
    return err;
  }

  function runPolish(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var editor = container ? container.querySelector("#rmdSectionEditor") : null;
    if (editor && editor.getAttribute("contenteditable") === "true") {
      syncEditorText(editor);
    }
    var curSec = getSection(st.selectedSectionId);
    if (!curSec) return;
    var secText = String(curSec.text || "");
    if (!secText.trim()) {
      st.polishBusy = false;
      st.polishError = { message: "Write a few lines first before asking MaiK to polish the wording." };
      render(container);
      return;
    }
    if (secText.length > 5000) {
      st.polishBusy = false;
      st.polishError = { message: "This section is over the 5,000-character limit for one polish pass. Shorten it and try again." };
      render(container);
      return;
    }
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    var pid = encodeURIComponent(apiProjectId());
    var targetJournal = (proj && (proj.targetJournal || proj.journal)) || undefined;
    var inputPayload = {
      sectionId: curSec.id,
      text: secText
    };
    if (targetJournal) inputPayload.journalId = targetJournal;

    st.polishBusy = true;
    st.polishError = null;
    st.polishDraft = null;
    render(container);

    var reqBody = {
      task: "polish",
      input: inputPayload
    };

    var p = SMD.api ? SMD.api.request("POST", "/v1/projects/" + pid + "/ai-draft", reqBody) : Promise.reject({ message: "API not available" });
    p.then(function (res) {
      st.polishBusy = false;
      var draft = res && res.draft ? res.draft : (res || {});
      var changes = [];
      if (draft.changes && draft.changes.length) {
        for (var i = 0; i < draft.changes.length; i++) {
          var c = draft.changes[i];
          changes.push({
            before: c.before || "",
            after: c.after || "",
            reason: c.reason || "clarity",
            status: "pending"
          });
        }
      }
      var polished = typeof draft.polished === "string" ? draft.polished : curSec.text;

      // HARD RULE: token preservation
      var origTokens = extractTokens(curSec.text);
      var polishedTokens = extractTokens(polished);
      if (origTokens.length !== polishedTokens.length) {
        st.polishError = {
          code: "token_mismatch",
          message: "Token preservation failure (values changed or missing)"
        };
        render(container);
        return;
      }
      var pTokensCopy = polishedTokens.slice();
      for (var k = 0; k < origTokens.length; k++) {
        var idx = pTokensCopy.indexOf(origTokens[k]);
        if (idx < 0) {
          st.polishError = {
            code: "token_missing",
            message: "Token preservation failure (values changed or missing)"
          };
          render(container);
          return;
        }
        pTokensCopy.splice(idx, 1);
      }

      st.polishDraft = {
        sectionId: curSec.id,
        polished: polished,
        changes: changes
      };
      render(container);
      checkResumeCheckpoint(container, mpid);
    }).catch(function (err) {
      st.polishBusy = false;
      st.polishError = manuscriptAiError(err, "MaiK could not polish the wording.");
      render(container);
    });
  }

  function loadCasePromise(id) {
    if (!G.RMDStore) return Promise.resolve(null);
    if (typeof G.RMDStore.list === "function") {
      return G.RMDStore.list(id, "casefile").then(function (items) {
        if (items && items.length) {
          for (var i = 0; i < items.length; i++) {
            if (items[i] && (items[i].id === "case" || items[i].id === "1" || items[i].id === "main")) {
              return items[i].value || items[i];
            }
          }
          return (items[0] && (items[0].value || items[0])) || null;
        }
        if (typeof G.RMDStore.get === "function") {
          return G.RMDStore.get(id, "casefile", "case").then(function (r) {
            return r || G.RMDStore.get(id, "casefile", "main");
          });
        }
        return null;
      });
    }
    if (typeof G.RMDStore.get === "function") {
      return G.RMDStore.get(id, "casefile", "case").then(function (r) {
        return r || G.RMDStore.get(id, "casefile", "main");
      });
    }
    return Promise.resolve(null);
  }

  function openCaseReportDraftModal(container) {
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    var pid = (proj && proj.id) || activeProjectId();
    var apiPid = (proj && (proj.serverId || proj.id)) || pid;

    var getPromise = loadCasePromise(pid).then(function (cf) {
      if (cf || apiPid === pid) return cf;
      return loadCasePromise(apiPid);
    });

    getPromise.then(function (casefile) {
      if (!casefile) {
        casefile = {
          age: (proj && proj.patientAge) || 45,
          sex: (proj && proj.patientSex) || "Female",
          presentingComplaint: (proj && proj.researchQuestion) || (proj && proj.title) || "Acute symptoms requiring clinical evaluation.",
          history: "Patient presented with acute clinical symptoms.",
          examination: "Physical examination was completed and documented.",
          investigations: [
            { date: "Day 0", test: "Diagnostic workup", value: "abnormal", unit: "" }
          ],
          diagnosis: (proj && proj.title) || "Clinical case report",
          treatment: "Supportive care and guideline-directed therapy.",
          outcome: "Patient improved and was discharged in stable condition.",
          unusual: "Unusual clinical features and therapeutic response."
        };
      } else {
        casefile = {
          age: casefile.age,
          sex: casefile.sex,
          presentingComplaint: casefile.presentingComplaint || casefile.presenting || "",
          history: casefile.history || "",
          examination: casefile.examination || casefile.exam || "",
          investigations: casefile.investigations || casefile.labs || [],
          diagnosis: casefile.diagnosis || "",
          treatment: casefile.treatment || "",
          outcome: casefile.outcome || "",
          unusual: casefile.unusual || casefile.uniquePoint || "",
          patientPerspective: casefile.patientPerspective || "",
          learningPoints: casefile.learningPoints || ""
        };
      }

      var prep = (G.RMDPhi && G.RMDPhi.prepareCaseText)
        ? G.RMDPhi.prepareCaseText(casefile, {})
        : { text: "", blocked: true, findings: ["The privacy check did not load. Close and reopen the app, then try again."] }; // never send an unchecked case file

      showDraftPreviewModal(container, apiPid, prep.text, prep.findings, prep.blocked, pid);
    }).catch(function () {
      showDraftPreviewModal(container, apiPid, "Error loading case file.", ["Error loading case file."], true, pid);
    });
  }

  function showDraftPreviewModal(container, pid, initialText, initialFindings, initialBlocked, localPid) {
    var modal = D.getElementById("rmdCaseReportDraftModal");
    if (modal && modal.parentNode) modal.parentNode.removeChild(modal);

    var currentText = initialText || "";
    var currentFindings = initialFindings || [];
    var currentBlocked = true;

    modal = D.createElement("div");
    modal.id = "rmdCaseReportDraftModal";
    modal.className = "rmd-modal-backdrop rmd-modal-overlay";
    modal.style.cssText = "position:fixed; top:0; left:0; right:0; bottom:0; background:rgba(0,0,0,0.7); display:flex; align-items:center; justify-content:center; z-index:10060; padding:16px;";

    var box = D.createElement("div");
    box.className = "rmd-modal-card rmd-modal-wide";
    box.style.cssText = "background:var(--rmd-panel); border:1px solid var(--rmd-line); border-radius:8px; max-width:680px; width:100%; max-height:90vh; overflow-y:auto; padding:20px; color:var(--rmd-ink);";

    function updateView() {
      if (G.RMDPhi && G.RMDPhi.prepareCaseText) {
        var res = G.RMDPhi.prepareCaseText(currentText, {});
        currentFindings = res.findings || [];
        currentBlocked = res.blocked || currentFindings.length > 0;
      } else {
        currentBlocked = true;
        currentFindings = ["The privacy check did not load. Close and reopen the app, then try again."];
      }

      var findingsHtml = "";
      if (currentBlocked && currentFindings.length) {
        findingsHtml = '<div id="rmd-cr-findings" style="margin-top:10px; padding:10px; background:var(--rmd-bad-soft); border:1px solid var(--rmd-bad); border-radius:4px;">' +
          '<strong style="color:var(--rmd-bad); font-size:13px;">De-identification findings (must fix before sending):</strong>' +
          '<ul style="margin:6px 0 0 16px; padding:0; font-size:12px; color:var(--rmd-bad);">' +
          currentFindings.map(function (f) {
            var fix = f.indexOf("phone") >= 0 ? "Remove phone number." :
                      f.indexOf("date") >= 0 ? "Convert dates to Day N." :
                      f.indexOf("email") >= 0 ? "Remove email address." :
                      f.indexOf("aadhaar") >= 0 ? "Remove Aadhaar number." :
                      f.indexOf("uhid") >= 0 ? "Remove hospital identification number." : "Remove personal identifier.";
            return '<li><span class="rmd-finding-match">' + esc(f) + '</span>: ' + esc(fix) + '</li>';
          }).join("") +
          '</ul></div>';
      }

      var tickEl = box.querySelector("#rmd-cr-tick-noid");
      var isTicked = tickEl ? tickEl.checked : false;

      var sendBtn = box.querySelector("#rmd-cr-send-btn");
      if (sendBtn) {
        sendBtn.disabled = currentBlocked || !isTicked;
      }

      var fContainer = box.querySelector("#rmd-cr-findings-container");
      if (fContainer) {
        fContainer.innerHTML = findingsHtml;
      }
    }

    var h = [];
    h.push('<div style="display:flex; justify-content:space-between; align-items:center; margin-bottom:12px;">');
    h.push('  <h3 style="margin:0; font-size:18px;">Draft Case Report with MaiK</h3>');
    h.push('  <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" id="rmd-cr-close-modal">Cancel</button>');
    h.push('</div>');
    h.push('<p style="font-size:13px; color:var(--rmd-mut); margin-bottom:12px;">Preview of the exact text that will be sent to MaiK. Ensure all personal identifiers are removed.</p>');

    h.push('<div>');
    h.push('  <label style="display:block; font-size:13px; font-weight:600; margin-bottom:4px;">De-identified Case Text:</label>');
    h.push('  <textarea id="rmd-cr-preview-text" rows="10" style="width:100%; padding:10px; background:var(--rmd-fill); border:1px solid var(--rmd-line); color:var(--rmd-ink); border-radius:4px; font-family:inherit; font-size:13px; line-height:1.4;">' + esc(currentText) + '</textarea>');
    h.push('</div>');

    h.push('<div id="rmd-cr-findings-container"></div>');

    h.push('<div style="margin:14px 0 16px 0;">');
    h.push('  <label style="display:flex; align-items:center; gap:8px; font-size:13px; cursor:pointer;">');
    h.push('    <input type="checkbox" id="rmd-cr-tick-noid" />');
    h.push('    <strong>This text has no name, hospital number, address or phone number</strong>');
    h.push('  </label>');
    h.push('</div>');

    h.push('<div style="display:flex; justify-content:flex-end; gap:8px;">');
    h.push('  <button type="button" class="rmd-btn rmd-btn-subtle" id="rmd-cr-cancel-btn">Cancel</button>');
    h.push('  <button type="button" class="rmd-btn rmd-btn-primary" id="rmd-cr-send-btn" disabled>Send to MaiK</button>');
    h.push('</div>');
    h.push('<div id="rmd-cr-status-msg" style="margin-top:10px; font-size:13px;"></div>');

    box.innerHTML = h.join("\n");
    modal.appendChild(box);
    var mount = D.getElementById("researchMD") || D.body;
    mount.appendChild(modal);

    var txtArea = box.querySelector("#rmd-cr-preview-text");
    var tickBox = box.querySelector("#rmd-cr-tick-noid");
    var closeBtn = box.querySelector("#rmd-cr-close-modal");
    var cancelBtn = box.querySelector("#rmd-cr-cancel-btn");
    var sendBtn = box.querySelector("#rmd-cr-send-btn");
    var statusMsg = box.querySelector("#rmd-cr-status-msg");

    function closeModal() {
      if (modal && modal.parentNode) modal.parentNode.removeChild(modal);
    }
    if (closeBtn) closeBtn.onclick = closeModal;
    if (cancelBtn) cancelBtn.onclick = closeModal;

    txtArea.oninput = function () {
      currentText = txtArea.value;
      updateView();
    };

    tickBox.onchange = function () {
      updateView();
    };

    updateView();

    sendBtn.onclick = function () {
      if (currentBlocked || !tickBox.checked) return;
      sendBtn.disabled = true;
      if (statusMsg) statusMsg.innerHTML = '<span style="color:var(--rmd-acc);">Drafting case report sections with MaiK...</span>';

      var body = {
        task: "case_report_draft",
        input: { caseText: currentText }
      };

      var draftPromise;
      if (SMD.api && typeof SMD.api.request === "function") {
        draftPromise = SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(pid) + "/ai-draft", body)
          .then(function (data) { return { status: 200, data: data }; });
      } else {
        draftPromise = fetch("/api/research/v1/projects/" + encodeURIComponent(pid) + "/ai-draft", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        }).then(function (res) {
          return res.json().then(function (data) {
            return { status: res.status, data: data };
          });
        });
      }
      draftPromise.then(function (resp) {
        if (resp.status >= 200 && resp.status < 300 && resp.data && resp.data.draft && resp.data.draft.sections) {
          var secMap = resp.data.draft.sections;
          var fullDraftText = "";

          if (!st.manuscript) st.manuscript = defaultManuscript(pid);
          if (!st.manuscript.sections) st.manuscript.sections = [];

          var keys = ["title", "abstract", "introduction", "casePresentation", "timeline", "discussion", "conclusion", "patientPerspective", "learningPoints"];
          for (var k = 0; k < keys.length; k++) {
            var key = keys[k];
            var val = secMap[key];
            if (!val) continue;
            var textVal = Array.isArray(val) ? val.join("\n- ") : String(val);
            if (Array.isArray(val)) textVal = "- " + textVal;
            fullDraftText += " " + textVal;

            var existingSec = getSection(key);
            var markPrefix = "Drafted by MaiK, check it:\n";
            if (existingSec) {
              if (existingSec.text && existingSec.text.trim()) {
                existingSec.text = existingSec.text + "\n\n" + markPrefix + textVal;
              } else {
                existingSec.text = markPrefix + textVal;
              }
            } else {
              var heading = key === "casePresentation" ? "Case Presentation" :
                            key === "patientPerspective" ? "Patient Perspective" :
                            key === "learningPoints" ? "Learning Points" :
                            key.charAt(0).toUpperCase() + key.slice(1);
              st.manuscript.sections.push({
                id: key,
                heading: heading,
                text: markPrefix + textVal
              });
            }
          }

          if (G.RMDPhi && G.RMDPhi.numbersNotIn) {
            st.caseReportMissingNumbers = G.RMDPhi.numbersNotIn(fullDraftText, currentText);
          } else {
            st.caseReportMissingNumbers = [];
          }

          saveLocalManuscript(localPid || st.projectId || pid, st.manuscript);
          if (getSection("casePresentation")) st.selectedSectionId = "casePresentation";
          st.saveNotice = "Drafted by MaiK. Review and verify every clinical detail before approving.";
          closeModal();
          render(container);
        } else {
          sendBtn.disabled = false;
          var msg = (resp.data && resp.data.error && resp.data.error.message) || "Draft request failed";
          if (statusMsg) statusMsg.innerHTML = '<span style="color:var(--rmd-bad);">' + esc(msg) + '</span>';
        }
      }).catch(function (err) {
        sendBtn.disabled = false;
        if (statusMsg) statusMsg.innerHTML = '<span style="color:var(--rmd-bad);">Error: ' + esc(err.message || String(err)) + '</span>';
      });
    };
  }

  /* Ask MaiK to draft a manuscript for review / primary projects via the
   * synchronous /ai-draft endpoint so it never triggers an unimplemented /jobs kind. */
  function startManuscriptDraft() {
    if (!SMD.api) return Promise.reject({ message: "API not available" });
    var pid = apiProjectId();
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    var man = st.manuscript;
    var input = {
      title: (man && man.title) || (proj && proj.title) || "",
      studyType: (proj && (proj.studyType || proj.study_type)) || "",
      researchQuestion: (proj && proj.researchQuestion) || ""
    };
    var targetJournal = proj && (proj.targetJournal || proj.journal);
    if (targetJournal) input.journalId = targetJournal;
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(pid) + "/ai-draft", {
      task: "manuscript_draft",
      input: input
    }).catch(function (err) {
      throw manuscriptAiError(err, "MaiK could not draft the manuscript. Try again.");
    });
  }

  function applyManuscriptDraft(container, draft) {
    var d = draft || {};
    if (d.status === "failed" || d.status === "error") {
      throw { message: "MaiK could not draft the manuscript. Try again." };
    }
    var secs = d.sections;
    if (!secs || (Array.isArray(secs) && !secs.length)) {
      load(container);
      return ["manuscript"];
    }
    if (!st.manuscript) st.manuscript = defaultManuscript(st.projectId);
    if (!st.manuscript.sections) st.manuscript.sections = [];
    if (typeof d.title === "string" && d.title.trim()) {
      st.manuscript.title = d.title.trim();
    }
    var list = [];
    if (Array.isArray(secs)) {
      list = secs;
    } else if (typeof secs === "object") {
      var keys = Object.keys(secs);
      for (var k = 0; k < keys.length; k++) {
        list.push({ id: keys[k], heading: keys[k].charAt(0).toUpperCase() + keys[k].slice(1), text: secs[keys[k]] });
      }
    }
    for (var i = 0; i < list.length; i++) {
      var item = list[i];
      if (!item || !item.id || typeof item.text !== "string") continue;
      var existing = null;
      for (var j = 0; j < st.manuscript.sections.length; j++) {
        if (st.manuscript.sections[j].id === item.id) { existing = st.manuscript.sections[j]; break; }
      }
      if (existing) {
        existing.text = item.text;
        if (item.heading) existing.heading = item.heading;
      } else {
        st.manuscript.sections.push({
          id: item.id,
          heading: item.heading || item.id,
          level: 1,
          text: item.text
        });
      }
    }
    saveLocalManuscript(st.projectId, st.manuscript);
    st.saveNotice = "Drafted by MaiK. Review each section and save when ready.";
    return ["manuscript"];
  }

  function getSection(id) {
    if (!st.manuscript || !st.manuscript.sections) return null;
    for (var i = 0; i < st.manuscript.sections.length; i++) {
      if (st.manuscript.sections[i].id === id) return st.manuscript.sections[i];
    }
    return st.manuscript.sections[0] || null;
  }

  /* Saved runs from the local store */
  function findRun(runId) {
    var store = SMD.store;
    var state = store ? store.getState() : null;
    var runs = (state && state.runs && state.runs[st.projectId]) || [];
    for (var i = 0; i < runs.length; i++) {
      if (runs[i].id === runId) return runs[i];
    }
    return null;
  }

  function latestRun() {
    var store = SMD.store;
    var state = store ? store.getState() : null;
    var runs = (state && state.runs && state.runs[st.projectId]) || [];
    return runs.length ? runs[0] : null;
  }

  /* Normal CDF (Zelen & Severo approximation) for the pooled two-sided p. */
  function normCdf(x) {
    var t = 1 / (1 + 0.2316419 * Math.abs(x));
    var d = 0.3989422804014327 * Math.exp(-x * x / 2);
    var p = d * t * (0.31938153 + t * (-0.356563782 + t * (1.781477937 + t * (-1.821255978 + t * 1.330274429))));
    return x >= 0 ? 1 - p : p;
  }

  /* Derive a display field from a saved engine run. Ratio measures are
   * pooled on the log scale, so exponentiate back for display. */
  function runFieldValue(run, field) {
    var res = run && run.result;
    if (!res) return undefined;
    if (res[field] !== undefined && res[field] !== null) return res[field];
    var measure = run.measure || (run.manifest && run.manifest.measure) || "";
    var ratio = measure === "RR" || measure === "OR" || measure === "HR";
    var pooled = res.pooled || {};
    var het = res.heterogeneity || {};
    var v;
    switch (field) {
      case "estimate": case "effect":
        v = pooled.effect; return v == null ? undefined : (ratio ? Math.exp(v) : v);
      case "ciLower":
        v = pooled.ciLower; return v == null ? undefined : (ratio ? Math.exp(v) : v);
      case "ciUpper":
        v = pooled.ciUpper; return v == null ? undefined : (ratio ? Math.exp(v) : v);
      case "p": case "pValue": case "p_value": case "pval":
        if (pooled.effect == null || !pooled.se) return undefined;
        return 2 * (1 - normCdf(Math.abs(pooled.effect / pooled.se)));
      case "se": case "se_yi":
        return pooled.se == null ? undefined : pooled.se;
      case "i2": case "i_squared":
        return het.i2 == null ? undefined : het.i2;
      case "tau2":
        return het.tau2 == null ? undefined : het.tau2;
      case "tau":
        return het.tau2 == null ? undefined : Math.sqrt(het.tau2);
      case "q":
        return het.q == null ? undefined : het.q;
      case "df":
        return het.df == null ? undefined : het.df;
      case "k": case "studies":
        return res.weights ? res.weights.length : undefined;
      case "n": case "total": case "sample_size": case "participants":
        var inputs = (run.manifest && run.manifest.inputs) || [];
        var sum = 0, found = false;
        for (var i = 0; i < inputs.length; i++) {
          var vals = inputs[i] && inputs[i].values;
          if (vals && vals.n1 != null && vals.n2 != null) {
            sum += Number(vals.n1) + Number(vals.n2);
            found = true;
          }
        }
        return found ? sum : undefined;
    }
    return undefined;
  }

  /* Token resolver: manuscript map first, then saved runs. */
  function resolveToken(runId, fieldPath, tokensMap) {
    var keyColon = runId + ":" + fieldPath;
    var keyDot = runId + "." + fieldPath;
    var map = tokensMap || (st.manuscript && st.manuscript.tokens) || {};

    if (map[keyColon]) {
      var entryC = map[keyColon];
      return {
        resolved: true,
        value: typeof entryC === "object" ? entryC.value : entryC,
        formatted: typeof entryC === "object" && entryC.formatted ? entryC.formatted : formatTokenValue(fieldPath, typeof entryC === "object" ? entryC.value : entryC)
      };
    }
    if (map[keyDot]) {
      var entryD = map[keyDot];
      return {
        resolved: true,
        value: typeof entryD === "object" ? entryD.value : entryD,
        formatted: typeof entryD === "object" && entryD.formatted ? entryD.formatted : formatTokenValue(fieldPath, typeof entryD === "object" ? entryD.value : entryD)
      };
    }

    var store = SMD.store;
    var state = store ? store.getState() : null;
    var savedRuns = (state && state.runs && state.runs[st.projectId]) || [];
    for (var r = 0; r < savedRuns.length; r++) {
      if (savedRuns[r].id === runId && savedRuns[r].result) {
        var run = savedRuns[r];
        if (fieldPath === "ci" || fieldPath === "ci95") {
          var lo = runFieldValue(run, "ciLower");
          var hi = runFieldValue(run, "ciUpper");
          if (lo != null && hi != null) {
            return { resolved: true, value: [lo, hi], formatted: formatCi(lo, hi) };
          }
        }
        var v = runFieldValue(run, fieldPath);
        if (v !== undefined && v !== null) {
          return { resolved: true, value: v, formatted: formatTokenValue(fieldPath, v) };
        }
      }
    }

    return { resolved: false, value: null, formatted: "[result pending]" };
  }

  /* Section text with every token replaced by its resolved value. */
  function plainText(text) {
    return String(text || "").replace(TOKEN_RE, function (m, runId, field) {
      var r = resolveToken(runId, field);
      return r.resolved ? r.formatted : "[result pending]";
    });
  }

  function wordCount(text) {
    var t = plainText(text).trim();
    return t ? t.split(/\s+/).length : 0;
  }

  /* ---------- Editor DOM ---------- */

  function numSpanHtml(tokenStr, runId, fieldPath) {
    var resolved = resolveToken(runId, fieldPath);
    var run = findRun(runId);
    var label = fieldLabel(fieldPath, run ? run.measure : "");
    var text = resolved.resolved ? resolved.formatted : "[result pending]";
    return '<span class="rmd-num' + (resolved.resolved ? "" : " rmd-num-pending") +
      '" contenteditable="false" role="button" tabindex="0"' +
      ' data-token="' + esc(tokenStr) + '" data-run="' + esc(runId) + '" data-field="' + esc(fieldPath) + '"' +
      ' aria-label="' + esc(label + ": " + text) + '">' + esc(text) + '</span>';
  }

  /* Newlines stay literal text nodes (white-space: pre-wrap) so the
   * serialiser can reproduce the source text byte for byte. */
  function buildEditorHtml(rawText) {
    if (!rawText) return "";
    var re = /\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}/g;
    var last = 0;
    var parts = [];
    var m;
    while ((m = re.exec(rawText)) !== null) {
      if (m.index > last) parts.push(esc(rawText.substring(last, m.index)));
      parts.push(numSpanHtml(m[0], m[1], m[2]));
      last = re.lastIndex;
    }
    if (last < rawText.length) parts.push(esc(rawText.substring(last)));
    return parts.join("");
  }

  function serializeEditor(el) {
    var out = "";
    function walk(node) {
      var children = node.childNodes;
      for (var i = 0; i < children.length; i++) {
        var c = children[i];
        if (c.nodeType === 3) {
          out += c.nodeValue;
        } else if (c.nodeType === 1) {
          if (c.getAttribute("data-token")) {
            out += c.getAttribute("data-token");
          } else if (c.tagName === "BR") {
            if (!c.getAttribute("data-rmd-pad")) out += "\n";
          } else if (c.tagName === "DIV" || c.tagName === "P") {
            if (out.length && out.charAt(out.length - 1) !== "\n") out += "\n";
            walk(c);
          } else {
            walk(c);
          }
        }
      }
    }
    walk(el);
    return out;
  }

  /* A trailing newline only renders if a padding <br> follows it. The pad
   * carries data-rmd-pad so the serialiser ignores it. */
  function ensurePad(editor) {
    var last = editor.lastChild;
    if (last && last.nodeType === 1 && last.getAttribute("data-rmd-pad")) last = last.previousSibling;
    var needs = !!(last && last.nodeType === 3 && /\n$/.test(last.nodeValue));
    var pad = editor.querySelector("br[data-rmd-pad]");
    if (needs) {
      if (!pad || pad !== editor.lastChild) {
        if (pad && pad.parentNode) pad.parentNode.removeChild(pad);
        var br = D.createElement("br");
        br.setAttribute("data-rmd-pad", "1");
        editor.appendChild(br);
      }
    } else if (pad && pad.parentNode) {
      pad.parentNode.removeChild(pad);
    }
  }

  function caretRange(editor) {
    var sel = G.getSelection();
    if (sel && sel.rangeCount) {
      var r = sel.getRangeAt(0);
      if (editor.contains(r.startContainer)) return r;
    }
    return null;
  }

  function saveCaret(editor) {
    var r = caretRange(editor);
    st.lastRange = r ? r.cloneRange() : null;
  }

  function placeCaretAfter(node) {
    var sel = G.getSelection();
    if (!sel) return;
    var r = D.createRange();
    r.setStartAfter(node);
    r.collapse(true);
    sel.removeAllRanges();
    sel.addRange(r);
  }

  function insertNewlineAtCaret(editor) {
    var r = caretRange(editor);
    var tn = D.createTextNode("\n");
    if (r) {
      r.deleteContents();
      r.insertNode(tn);
      placeCaretAfter(tn);
    } else {
      editor.appendChild(tn);
    }
    ensurePad(editor);
  }

  /* Number spans delete as one unit: find the span adjacent to the caret. */
  function adjacentSpan(editor, forward) {
    var sel = G.getSelection();
    if (!sel || !sel.rangeCount) return null;
    var r = sel.getRangeAt(0);
    if (!r.collapsed || !editor.contains(r.startContainer)) return null;
    var node = r.startContainer;
    var off = r.startOffset;
    var cand = null;
    if (node.nodeType === 3) {
      if (!forward && off === 0) cand = node.previousSibling;
      else if (forward && off === node.nodeValue.length) cand = node.nextSibling;
    } else {
      cand = node.childNodes[forward ? off : off - 1] || null;
    }
    while (cand && cand.nodeType === 3 && cand.nodeValue === "") {
      cand = forward ? cand.nextSibling : cand.previousSibling;
    }
    if (cand && cand.nodeType === 1 && cand.getAttribute("data-token")) return cand;
    return null;
  }

  function insertResultToken(editor, tokenStr, runId, field) {
    var tmp = D.createElement("div");
    tmp.innerHTML = numSpanHtml(tokenStr, runId, field);
    var span = tmp.firstChild;
    var r = (st.lastRange && editor.contains(st.lastRange.startContainer)) ? st.lastRange : caretRange(editor);
    if (r) {
      r.deleteContents();
      r.insertNode(span);
      placeCaretAfter(span);
    } else {
      editor.appendChild(span);
    }
    ensurePad(editor);
    st.lastRange = null;
  }

  function syncEditorText(editor) {
    var sec = getSection(st.selectedSectionId);
    if (sec) sec.text = serializeEditor(editor);
  }

  /* ---------- Number popover ---------- */

  var popEl = null;
  var popBound = false;

  function closeNumPopover() {
    if (popEl && popEl.parentNode) popEl.parentNode.removeChild(popEl);
    popEl = null;
  }

  function bindPopoverGlobals() {
    if (popBound) return;
    popBound = true;
    D.addEventListener("click", function (e) {
      if (!popEl) return;
      var t = e.target;
      if (popEl.contains(t)) return;
      if (t && t.closest && t.closest(".rmd-num")) return;
      closeNumPopover();
    }, true);
    D.addEventListener("keydown", function (e) {
      if (popEl && (e.key === "Escape" || e.keyCode === 27)) {
        e.stopPropagation();
        e.preventDefault();
        closeNumPopover();
      }
    }, true);
  }

  /* Deterministic "What this means" line for a tapped number, from the
   * shared explain helper. Standard statistic first, plain meaning after. */
  function popoverMeaning(run, field) {
    var explain = G.SMD_RESEARCH_EXPLAIN;
    if (!explain || !run) return "";
    var measure = run.measure || (run.manifest && run.manifest.measure) || "";
    try {
      if (field === "estimate" || field === "effect" || field === "ciLower" || field === "ciUpper" || field === "ci" || field === "ci95") {
        if (measure !== "RR" && measure !== "OR" && measure !== "HR" && measure !== "MD" && measure !== "SMD") return "";
        var est = runFieldValue(run, "estimate");
        var lo = runFieldValue(run, "ciLower");
        var hi = runFieldValue(run, "ciUpper");
        if (est == null || lo == null || hi == null || !isFinite(est) || !isFinite(lo) || !isFinite(hi)) return "";
        var opts = { measure: measure, estimate: est, ciLower: lo, ciUpper: hi };
        var pv = runFieldValue(run, "p");
        if (pv != null && isFinite(pv) && pv >= 0 && pv <= 1) opts.p = pv;
        return explain.effect(opts);
      }
      if (field === "p" || field === "pValue" || field === "p_value" || field === "pval") {
        var p = runFieldValue(run, "p");
        return (p != null && isFinite(p) && p >= 0 && p <= 1) ? explain.pValue(p) : "";
      }
      if (field === "i2" || field === "i_squared" || field === "tau2" || field === "tau") {
        var i2 = runFieldValue(run, "i2");
        if (i2 == null || !isFinite(i2) || i2 < 0) return "";
        var t2 = runFieldValue(run, "tau2");
        return explain.heterogeneity(i2, (t2 != null && isFinite(t2) && t2 >= 0) ? t2 : undefined);
      }
    } catch (e) {}
    return "";
  }

  function openNumPopover(span) {
    closeNumPopover();
    bindPopoverGlobals();
    var runId = span.getAttribute("data-run");
    var field = span.getAttribute("data-field");
    var run = findRun(runId);
    var label = fieldLabel(field, run ? run.measure : "");
    var when = (run && run.createdAt && SMD.p2) ? SMD.p2.fmtTs(run.createdAt) : "";
    var text = label + ", from your analysis run" + (when ? " on " + when : "") +
      ". It updates by itself if you re-run the analysis.";
    var meaning = popoverMeaning(run, field);

    popEl = D.createElement("div");
    popEl.className = "rmd-num-popover";
    popEl.setAttribute("role", "dialog");
    popEl.setAttribute("aria-label", "About this number");
    popEl.innerHTML = '<div class="rmd-num-pop-text">' + esc(text) + '</div>' +
      (meaning ? '<div class="rmd-num-pop-text rmd-num-pop-meaning"><strong>What this means:</strong> ' + esc(meaning) + '</div>' : '') +
      '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-pop-close>Close</button>';
    D.body.appendChild(popEl);

    var rect = span.getBoundingClientRect();
    var pw = popEl.offsetWidth;
    var ph = popEl.offsetHeight;
    var left = Math.max(8, Math.min(rect.left, (G.innerWidth || 1024) - pw - 8));
    var top = rect.bottom + 8;
    if (top + ph > (G.innerHeight || 768) - 8) top = Math.max(8, rect.top - ph - 8);
    popEl.style.left = left + "px";
    popEl.style.top = top + "px";
    popEl.querySelector("[data-rmd-pop-close]").onclick = closeNumPopover;
  }

  /* ---------- Insert a result panel ---------- */

  function runFields(run) {
    var order = ["estimate", "ciLower", "ciUpper", "p", "i2", "tau2", "k", "n"];
    var out = [];
    for (var i = 0; i < order.length; i++) {
      var v = runFieldValue(run, order[i]);
      if (v === undefined || v === null) continue;
      out.push({
        field: order[i],
        label: fieldLabel(order[i], run.measure || ""),
        formatted: formatTokenValue(order[i], v)
      });
    }
    return out;
  }

  function toggleInsertPanel(container) {
    var card = container.querySelector(".rmd-editor-card");
    var editor = container.querySelector("#rmdSectionEditor");
    if (!card || !editor) return;
    var existing = card.querySelector(".rmd-insert-panel");
    if (existing) {
      existing.parentNode.removeChild(existing);
      return;
    }

    var run = latestRun();
    var panel = D.createElement("div");
    panel.className = "rmd-insert-panel";
    var h = [];
    if (!run) {
      h.push('<div class="rmd-insert-empty">Run your analysis first, then its results can be inserted here.</div>');
      h.push('<button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd-insert-goto-run>Go to analysis</button>');
    } else {
      var when = (run.createdAt && SMD.p2) ? SMD.p2.fmtTs(run.createdAt) : "";
      h.push('<div class="rmd-insert-title">Results from your latest analysis' + (when ? " (" + esc(when) + ")" : "") + '</div>');
      var fields = runFields(run);
      for (var i = 0; i < fields.length; i++) {
        h.push('<button type="button" class="rmd-insert-item" data-rmd-insert-field="' + esc(fields[i].field) + '">');
        h.push('  <span class="rmd-insert-label">' + esc(fields[i].label) + '</span>');
        h.push('  <span class="rmd-insert-val">' + esc(fields[i].formatted) + '</span>');
        h.push('</button>');
      }
    }
    panel.innerHTML = h.join("");
    editor.parentNode.insertBefore(panel, editor);

    var goto = panel.querySelector("[data-rmd-insert-goto-run]");
    if (goto) {
      goto.onclick = function () {
        SMD.navigate("run", { projectId: st.projectId });
      };
    }
    var items = panel.querySelectorAll("[data-rmd-insert-field]");
    for (var j = 0; j < items.length; j++) {
      items[j].onclick = function () {
        var field = this.getAttribute("data-rmd-insert-field");
        var tokenStr = "{{run:" + run.id + "." + field + "}}";
        insertResultToken(editor, tokenStr, run.id, field);
        syncEditorText(editor);
        panel.parentNode.removeChild(panel);
        render(container);
      };
    }
  }

  /* ---------- Diff ---------- */

  function computeDiff(textA, textB) {
    if (textA === textB) {
      return '<span class="rmd-diff-same">' + esc(textA || "(Empty)") + '</span>';
    }
    var a = (textA || "").split(/(\s+)/);
    var b = (textB || "").split(/(\s+)/);

    if (!a.length || !a[0]) {
      return '<ins class="rmd-diff-ins">' + esc(textB) + '</ins>';
    }
    if (!b.length || !b[0]) {
      return '<del class="rmd-diff-del">' + esc(textA) + '</del>';
    }

    var maxLen = 300;
    var trimA = a.slice(0, maxLen);
    var trimB = b.slice(0, maxLen);
    var n = trimA.length;
    var m = trimB.length;
    var dp = [];
    var i, j;

    for (i = 0; i <= n; i++) {
      dp[i] = [];
      for (j = 0; j <= m; j++) {
        dp[i][j] = 0;
      }
    }
    for (i = 1; i <= n; i++) {
      for (j = 1; j <= m; j++) {
        if (trimA[i - 1] === trimB[j - 1]) {
          dp[i][j] = dp[i - 1][j - 1] + 1;
        } else {
          dp[i][j] = dp[i - 1][j] > dp[i][j - 1] ? dp[i - 1][j] : dp[i][j - 1];
        }
      }
    }

    i = n; j = m;
    var chunks = [];
    while (i > 0 || j > 0) {
      if (i > 0 && j > 0 && trimA[i - 1] === trimB[j - 1]) {
        chunks.unshift({ type: "same", text: trimA[i - 1] });
        i--; j--;
      } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
        chunks.unshift({ type: "ins", text: trimB[j - 1] });
        j--;
      } else if (i > 0) {
        chunks.unshift({ type: "del", text: trimA[i - 1] });
        i--;
      }
    }

    var html = [];
    var currType = null;
    var currBuf = "";
    function flush() {
      if (!currBuf) return;
      if (currType === "same") {
        html.push(esc(currBuf));
      } else if (currType === "ins") {
        html.push('<ins class="rmd-diff-ins">' + esc(currBuf) + '</ins>');
      } else if (currType === "del") {
        html.push('<del class="rmd-diff-del">' + esc(currBuf) + '</del>');
      }
      currBuf = "";
    }
    for (var c = 0; c < chunks.length; c++) {
      if (chunks[c].type !== currType) {
        flush();
        currType = chunks[c].type;
      }
      currBuf += chunks[c].text;
    }
    flush();
    return html.join("").replace(/\n/g, "<br>");
  }

  function getVersionText(verNum, secId) {
    if (verNum === 1) {
      if (secId === "results") {
        return "A total of 10 trials were included in the preliminary analysis. The pooled relative risk was 0.55. Heterogeneity was substantial.";
      }
      if (secId === "abstract") {
        return "Objective: Preliminary evaluation of BCG efficacy against tuberculosis.\nMethods: Systematic review of trials.\nResults: BCG showed reduction in tuberculosis incidence.\nConclusion: Protective effect observed.";
      }
    }
    var cur = getSection(secId);
    return cur ? cur.text : "";
  }

  /* ---------- Gate failures (plain copy, never raw codes) ---------- */

  var GATE_COPY = {
    unresolved_token: {
      label: "Missing result",
      message: "A number in this section has no saved analysis result yet. Run the analysis again, or use Insert a result."
    },
    unresolved_citation: {
      label: "Reference needs details",
      message: "A reference is missing its DOI or PMID. Add one so readers can find the paper."
    },
    unlinked_claim: {
      label: "Claim needs a result",
      message: "A claim about the findings is not backed by a result from your analysis. Insert the result next to the claim."
    },
    direction_mismatch: {
      label: "Direction does not match",
      message: "A word like reduced or increased does not match the saved result. Check the number and reword the sentence."
    },
    significance_mismatch: {
      label: "Significance does not match",
      message: "The sentence says significant or not significant, but the saved range says otherwise. Check the number and reword."
    }
  };

  function gateCopy(fail) {
    return GATE_COPY[fail.type] || {
      label: "Needs a fix",
      message: "This section needs a fix before the paper can be downloaded."
    };
  }

  /* ---------- Actions ---------- */

  function saveCurrentSection(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var editor = container.querySelector("#rmdSectionEditor");
    if (!editor) return;

    var sec = getSection(st.selectedSectionId);
    if (!sec) return;

    var newText = serializeEditor(editor);
    sec.text = newText;
    st.saveNotice = "Saving...";
    render(container);

    var pid = encodeURIComponent(apiProjectId());
    var sid = encodeURIComponent(sec.id);
    var payload = {
      version: st.manuscript.version,
      heading: sec.heading,
      text: newText
    };

    saveLocalManuscript(st.projectId, st.manuscript);
    if (SMD.api) {
      SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sid, payload)
        .then(function (res) {
          st.saveNotice = "Saved.";
          manuscriptMissing[apiProjectId()] = false;
          if (res && typeof res.version === "number") st.manuscript.version = res.version;
          if (res && res.tokens) st.manuscript.tokens = res.tokens;
          render(container);
        })
        .catch(function (err) {
          st.saveNotice = "Saved on this device.";
          render(container);
        });
    } else {
      st.saveNotice = "Saved on this device.";
      render(container);
    }
  }

  function approveManuscript(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var pid = encodeURIComponent(apiProjectId());
    var payload = { version: st.manuscript.version, decision: "approved" };

    function done() {
      st.manuscript.status = "approved";
      st.manuscript.approval = { status: "approved", approvedBy: "clinician", approvedAt: new Date().toISOString() };
      st.saveNotice = "Marked as final.";
      render(container);
    }

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/approval/approve", payload)
        .then(function () { manuscriptMissing[apiProjectId()] = false; done(); }, done);
    } else {
      done();
    }
  }

  function lockManuscript(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var pid = encodeURIComponent(apiProjectId());
    var payload = { version: st.manuscript.version };

    function done(res) {
      st.manuscript.status = "locked";
      st.manuscript.lock = (res && res.lock) || {
        version_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        locked_at: new Date().toISOString(),
        locked_by: "clinician",
        status: "locked"
      };
      st.saveNotice = "Version locked. It can be read but not changed.";
      render(container);
    }

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/lock", payload)
        .then(done, function () { done(null); });
    } else {
      done(null);
    }
  }

  /* ---------- DOCX (built on device after server gates pass) ---------- */

  function xmlEsc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function utf8Bytes(str) {
    var bin = unescape(encodeURIComponent(str));
    var out = new Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  var CRC_TABLE = (function () {
    var t = [];
    for (var n = 0; n < 256; n++) {
      var c = n;
      for (var k = 0; k < 8; k++) {
        c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1);
      }
      t[n] = c >>> 0;
    }
    return t;
  })();

  function crc32(bytes) {
    var c = 0xFFFFFFFF;
    for (var i = 0; i < bytes.length; i++) {
      c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8);
    }
    return (c ^ 0xFFFFFFFF) >>> 0;
  }

  function push16(arr, v) { arr.push(v & 255, (v >>> 8) & 255); }
  function push32(arr, v) { arr.push(v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255); }

  /* Minimal ZIP with stored (uncompressed) entries: enough for a .docx. */
  function zipStore(files) {
    var out = [];
    var central = [];
    var i, f, nameB, data, crc, headStart;
    for (i = 0; i < files.length; i++) {
      f = files[i];
      nameB = utf8Bytes(f.name);
      data = f.data;
      crc = crc32(data);
      headStart = out.length;
      push32(out, 0x04034b50);
      push16(out, 20); push16(out, 0x0800); push16(out, 0);
      push16(out, 0); push16(out, 0x5021);
      push32(out, crc); push32(out, data.length); push32(out, data.length);
      push16(out, nameB.length); push16(out, 0);
      out = out.concat(nameB);
      out = out.concat(data);

      push32(central, 0x02014b50);
      push16(central, 20); push16(central, 20); push16(central, 0x0800); push16(central, 0);
      push16(central, 0); push16(central, 0x5021);
      push32(central, crc); push32(central, data.length); push32(central, data.length);
      push16(central, nameB.length); push16(central, 0); push16(central, 0);
      push16(central, 0); push16(central, 0);
      push32(central, 0); push32(central, headStart);
      central = central.concat(nameB);
    }
    var cdStart = out.length;
    out = out.concat(central);
    push32(out, 0x06054b50);
    push16(out, 0); push16(out, 0);
    push16(out, files.length); push16(out, files.length);
    push32(out, central.length); push32(out, cdStart);
    push16(out, 0);
    return new Uint8Array(out);
  }

  function docxParagraph(text, bold, size) {
    if (!text) return "<w:p/>";
    var rpr = "";
    if (bold || size) {
      rpr = "<w:rPr>" + (bold ? "<w:b/>" : "") +
        (size ? '<w:sz w:val="' + size + '"/><w:szCs w:val="' + size + '"/>' : "") + "</w:rPr>";
    }
    return "<w:p><w:r>" + rpr + '<w:t xml:space="preserve">' + xmlEsc(text) + "</w:t></w:r></w:p>";
  }

  function buildDocxBytes(man) {
    var parts = [];
    parts.push(docxParagraph(man.title || "Manuscript", true, 32));
    if (man.authors && man.authors.length) parts.push(docxParagraph(man.authors.join(", "), false, 0));
    if (man.affiliations) parts.push(docxParagraph(man.affiliations, false, 0));
    for (var i = 0; i < man.sections.length; i++) {
      var sec = man.sections[i];
      parts.push(docxParagraph(sec.heading || sec.id, true, 28));
      var lines = plainText(sec.text).split("\n");
      for (var j = 0; j < lines.length; j++) {
        parts.push(docxParagraph(lines[j], false, 0));
      }
    }
    var doc = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>' +
      parts.join("") +
      '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>' +
      '<w:pgMar w:top="1440" w:right="1440" w:bottom="1440" w:left="1440"/></w:sectPr>' +
      "</w:body></w:document>";
    var contentTypes = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
      '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
      '<Default Extension="xml" ContentType="application/xml"/>' +
      '<Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>' +
      "</Types>";
    var rels = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
      '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
      '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>' +
      "</Relationships>";
    return zipStore([
      { name: "[Content_Types].xml", data: utf8Bytes(contentTypes) },
      { name: "_rels/.rels", data: utf8Bytes(rels) },
      { name: "word/document.xml", data: utf8Bytes(doc) }
    ]);
  }

  function exportDocx(container) {
    if (st.exporting) return;

    var store = SMD.store;
    var proj = store ? store.getProject(st.projectId) : null;
    if (proj && !proj.serverId) {
      st.exportNotice = "This project is saved on this phone only. Save it to your account to download the Word file.";
      st.exportNoticeKind = "warn";
      render(container);
      return;
    }

    st.exporting = true;
    st.exportNotice = "Checking the paper before download...";
    st.exportNoticeKind = "info";
    st.gateFailures = [];
    render(container);

    var pid = encodeURIComponent(apiProjectId());
    var payload = { version: st.manuscript ? st.manuscript.version : 1, format: "docx" };

    function showGates(failures) {
      st.exporting = false;
      st.gateFailures = failures;
      st.exportNotice = "Fix the items below, then try again.";
      st.exportNoticeKind = "warn";
      render(container);
    }

    function deliverDocx() {
      var man = st.manuscript || defaultManuscript(st.projectId);
      var bytes = buildDocxBytes(man);
      var name = SMD.p2.fileSlug(man.title, "manuscript") + "-draft.docx";
      return SMD.p2.downloadBytes(name, bytes,
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document", man.title)
        .then(function () {
          st.exporting = false;
          st.exportNotice = "Your file is ready to save or share.";
          st.exportNoticeKind = "info";
          render(container);
        }, function (err) {
          st.exporting = false;
          st.exportNotice = SMD.p2.friendlyError(err).message;
          st.exportNoticeKind = "error";
          render(container);
        });
    }

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/export", payload)
        .then(function (res) {
          if (res && (res.gatesPassed === false || (res.gateFailures && res.gateFailures.length > 0))) {
            showGates(res.gateFailures || []);
            return null;
          }
          return deliverDocx();
        })
        .catch(function (err) {
          var fails = (err && err.body && err.body.gateFailures) ||
            (err && err.current && err.current.gateFailures);
          if (fails && fails.length) {
            showGates(fails);
          } else {
            st.exporting = false;
            st.exportNotice = SMD.p2.friendlyError(err).message;
            st.exportNoticeKind = "error";
            render(container);
          }
        });
    } else {
      showGates([
        { type: "unresolved_token", sectionId: "results" },
        { type: "unresolved_citation", sectionId: "introduction" },
        { type: "unlinked_claim", sectionId: "results" }
      ]);
    }
  }

  function jumpToSection(container, secId) {
    st.selectedSectionId = secId;
    st.viewMode = "editor";
    render(container);
    setTimeout(function () {
      var editor = container.querySelector("#rmdSectionEditor");
      if (editor) {
        editor.focus();
        var reduceMotion = G.matchMedia && G.matchMedia("(prefers-reduced-motion: reduce)").matches;
        editor.scrollIntoView({ behavior: reduceMotion ? "auto" : "smooth", block: "center" });
      }
    }, 50);
  }

  /* CSS Injection */
  function injectCss() {
    if (!D || D.getElementById("rmdManuscriptCss")) return;
    var s = D.createElement("style");
    s.id = "rmdManuscriptCss";
    s.textContent = [
      "/* ResearchMD Manuscript Screen Styles */",
      "#researchMD .rmd-manuscript-screen { display: flex; flex-direction: column; flex: 1; height: 100%; min-height: 0; }",
      "#researchMD .rmd-man-topbar { display: flex; align-items: center; justify-content: space-between; flex-wrap: wrap; flex-shrink: 0; gap: 10px 12px; padding: 12px 18px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); min-width: 0; }",
      "#researchMD .rmd-man-topbar-info { display: flex; align-items: center; gap: 8px; flex: 1 1 260px; min-width: 0; }",
      "#researchMD .rmd-man-title { margin: 0; font: 600 16px/1.3 var(--rmd-f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--rmd-ink); min-width: 0; }",
      "#researchMD .rmd-man-topbar-info .rmd-version-tag, #researchMD .rmd-man-topbar-info .rmd-badge { flex: 0 0 auto; white-space: nowrap; line-height: 1.35; }",
      "#researchMD .rmd-man-actions { display: flex; align-items: center; gap: 8px; flex: 0 1 auto; flex-wrap: wrap; min-width: 0; max-width: 100%; }",
      "#researchMD .rmd-man-actions .rmd-btn { white-space: nowrap; flex-shrink: 0; }",
      "#researchMD .rmd-man-ai-wrap { margin: 12px 18px 0; flex-shrink: 0; }",
      "#researchMD .rmd-po-status { margin-top: 6px; display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
      "#researchMD .rmd-po-status-text { font: 500 13px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-po-status-ok { color: var(--rmd-acc); }",
      "#researchMD .rmd-po-status-warn { color: var(--rmd-warn); }",
      "#researchMD .rmd-po-status-err { color: var(--rmd-bad); }",
      "#researchMD .rmd-po-block { margin-top: 8px; display: flex; flex-direction: column; gap: 6px; align-items: flex-start; max-width: 100%; }",
      "#researchMD .rmd-po-block .rmd-btn { max-width: 100%; white-space: normal; text-align: left; }",
      "#researchMD .rmd-po-cost-note { margin: 0; font: 400 12.5px/1.45 var(--rmd-f); color: var(--rmd-mut); max-width: 60ch; }",
      "#researchMD .rmd-po-confirm { border: 1px solid var(--rmd-line); background: var(--rmd-fill); border-radius: 10px; padding: 12px 14px; display: flex; flex-direction: column; gap: 8px; width: 100%; }",
      "#researchMD .rmd-po-confirm p { margin: 0; font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-po-confirm .rmd-po-cost-note { color: var(--rmd-mut); }",
      "#researchMD .rmd-po-confirm-actions { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-po-confirm-actions .rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-man-phone-bar { display: none; flex-shrink: 0; background: var(--rmd-fill); padding: 4px; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-man-phone-btn { flex: 1; border: 0; background: none; font: 500 13px var(--rmd-f); color: var(--rmd-mut); padding: 7px; border-radius: 6px; cursor: pointer; }",
      "#researchMD .rmd-man-phone-btn.rmd-seg-active { background: var(--rmd-panel); color: var(--rmd-ink); font-weight: 600; box-shadow: 0 1px 3px rgba(0,0,0,0.1); }",
      "#researchMD .rmd-man-split { display: flex; flex: 1; min-height: 0; overflow: hidden; }",
      "#researchMD .rmd-man-left { flex: 0 0 340px; border-right: 1px solid var(--rmd-line); display: flex; flex-direction: column; overflow-y: auto; background: var(--rmd-panel); }",
      "#researchMD .rmd-man-right { flex: 1; overflow-y: auto; padding: 18px 22px 40px; background: var(--rmd-bg); display: flex; flex-direction: column; gap: 16px; }",
      "#researchMD .rmd-section-list { display: flex; flex-direction: column; }",
      "#researchMD .rmd-section-item { display: flex; flex-direction: column; gap: 4px; padding: 12px 16px; border-bottom: 1px solid var(--rmd-line); cursor: pointer; background: var(--rmd-panel); text-align: left; width: 100%; border-right: 0; border-top: 0; border-left: 0; font: 400 14px var(--rmd-f); color: var(--rmd-ink); touch-action: manipulation; }",
      "#researchMD .rmd-section-item:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-section-item-active { background: var(--rmd-acc-soft); outline: 2px solid var(--rmd-acc); outline-offset: -2px; }",
      "#researchMD .rmd-section-item-head { display: flex; align-items: center; justify-content: space-between; width: 100%; }",
      "#researchMD .rmd-section-item-label { font-weight: 600; font-size: 14.5px; }",
      "#researchMD .rmd-section-item-meta { font-size: 11.5px; color: var(--rmd-mut); display: flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-section-item-desc { font-size: 12px; color: var(--rmd-mut); line-height: 1.35; }",
      "#researchMD .rmd-editor-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }",
      "#researchMD .rmd-editor-title { margin: 0; font: 600 17px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-editor-sub { font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-editor-actions { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; }",
      "#researchMD .rmd-man-editor { width: 100%; min-height: 180px; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 12px; font: 400 14px/1.65 var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); white-space: pre-wrap; overflow-wrap: anywhere; outline: none; }",
      "#researchMD .rmd-man-editor:focus { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-man-editor[contenteditable=\"false\"] { background: var(--rmd-fill); cursor: default; }",
      "#researchMD .rmd-num { border-bottom: 2px dotted var(--rmd-acc); font-weight: 600; cursor: pointer; padding: 0 1px; border-radius: 2px; }",
      "#researchMD .rmd-num:hover, #researchMD .rmd-num:focus { background: var(--rmd-acc-soft); outline: none; }",
      "#researchMD .rmd-num-pending { color: var(--rmd-warn); border-bottom-color: var(--rmd-warn); font-weight: 500; }",
      ".rmd-num-popover { position: fixed; z-index: 100000; max-width: 300px; background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); border-radius: 10px; padding: 12px 14px; box-shadow: 0 6px 24px rgba(0,0,0,0.18); display: flex; flex-direction: column; gap: 10px; font: 400 13px/1.5 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); }",
      ".rmd-num-pop-meaning { border-top: 1px solid var(--rmd-line, #e5ddce); padding-top: 8px; }",
      "#researchMD .rmd-insert-panel { border: 1px solid var(--rmd-line); border-radius: 8px; background: var(--rmd-fill); padding: 10px 12px; display: flex; flex-direction: column; gap: 6px; }",
      "#researchMD .rmd-insert-title { font: 600 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-insert-empty { font-size: 13px; color: var(--rmd-mut); }",
      "#researchMD .rmd-insert-item { display: flex; align-items: center; justify-content: space-between; gap: 10px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); border-radius: 6px; padding: 8px 10px; cursor: pointer; font: 400 13px var(--rmd-f); color: var(--rmd-ink); text-align: left; width: 100%; }",
      "#researchMD .rmd-insert-item:hover { background: var(--rmd-acc-soft); }",
      "#researchMD .rmd-insert-label { flex: 1; min-width: 0; }",
      "#researchMD .rmd-insert-val { font-weight: 700; color: var(--rmd-acc); white-space: nowrap; }",
      "#researchMD .rmd-gate-card { background: var(--rmd-bad-soft); border: 1px solid var(--rmd-bad); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-gate-title { margin: 0; font: 600 14px var(--rmd-f); color: var(--rmd-bad); }",
      "#researchMD .rmd-gate-failure-list { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-gate-failure-item { background: var(--rmd-panel); border: 1px solid var(--rmd-bad); border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-gate-item-info { display: flex; flex-direction: column; gap: 2px; }",
      "#researchMD .rmd-gate-type { font: 600 11.5px var(--rmd-f); color: var(--rmd-bad); }",
      "#researchMD .rmd-gate-msg { font-size: 12.5px; color: var(--rmd-ink); }",
      "#researchMD .rmd-diff-view { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-diff-ins { background: var(--rmd-acc-soft); color: var(--rmd-acc); text-decoration: none; border-bottom: 2px solid var(--rmd-acc); padding: 1px 3px; border-radius: 2px; font-weight: 600; }",
      "#researchMD .rmd-diff-del { background: var(--rmd-bad-soft); color: var(--rmd-bad); text-decoration: line-through; padding: 1px 3px; border-radius: 2px; }",
      "#researchMD .rmd-diff-same { color: var(--rmd-ink); }",
      "#researchMD .rmd-diff-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px; background: var(--rmd-fill); border-radius: 8px; }",
      "#researchMD .rmd-diff-select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); font-size: 13px; }",
      "#researchMD .rmd-locked-banner { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--rmd-acc); }",
      "#researchMD .rmd-phone-notice { flex-shrink: 0; background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--rmd-mut); }",
      "#researchMD .rmd-polish-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }",
      "#researchMD .rmd-polish-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }",
      "#researchMD .rmd-polish-head-actions { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-polish-list { display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-polish-change-item { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-polish-change-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-polish-change-actions { display: flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-polish-diff { font-size: 13.5px; line-height: 1.5; color: var(--rmd-ink); }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-man-topbar { flex-direction: column; align-items: stretch; gap: 10px; padding: 10px 14px; }",
      "  #researchMD .rmd-man-topbar-info { flex: 0 0 auto; width: 100%; gap: 8px; }",
      "  #researchMD .rmd-man-actions { width: 100%; flex-wrap: wrap; overflow: visible; padding: 2px 2px 4px; row-gap: 6px; }",
      "  #researchMD .rmd-man-actions .rmd-btn { flex: 0 1 auto; white-space: nowrap; min-height: 44px; padding: 8px 12px; max-width: 100%; }",
      "  #researchMD .rmd-man-actions .rmd-btn:focus-visible { outline-offset: -2px; }",
      "  #researchMD .rmd-man-ai-wrap { margin: 10px 14px 0; }",
      "  #researchMD .rmd-man-phone-btn { min-height: 44px; }",
      "  #researchMD .rmd-man-split { flex-direction: column; }",
      "  #researchMD .rmd-man-left { flex: 1; border-right: 0; min-width: 0; }",
      "  #researchMD .rmd-man-right { flex: 1; padding: 12px; }",
      "  #researchMD .rmd-man-phone-bar { display: flex; }",
      "  #researchMD .rmd-phone-hide { display: none !important; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* Main render */
  function render(container) {
    if (!container) return;
    lastContainer = container;
    st.lastRange = null;
    closeNumPopover();
    bindBreakpoint();
    injectCss();

    if (st.loading) {
      container.innerHTML = '<div class="rmd-loading" aria-live="polite">Loading manuscript...</div>';
      return;
    }

    var man = st.manuscript || defaultManuscript(st.projectId);
    var isLocked = man.status === "locked";
    var isApproved = man.status === "approved" || isLocked;
    var phone = isPhone();

    var h = [];
    h.push('<div class="rmd-manuscript-screen">');
    if (loadError) {
      h.push('<div class="rmd-banner rmd-banner-error" role="alert" style="margin:10px 14px 0;"><strong>' + esc(loadError) + '</strong></div>');
    }

    /* Top bar */
    h.push('<div class="rmd-man-topbar">');
    h.push('  <div class="rmd-man-topbar-info">');
    h.push('    <h3 class="rmd-man-title">' + esc(man.title || "ResearchMD Manuscript") + '</h3>');
    h.push('    <span class="rmd-version-tag">v' + esc(man.version) + '</span>');
    if (isLocked) {
      h.push('    <span class="rmd-badge rmd-badge-pill">Locked</span>');
    } else if (isApproved) {
      h.push('    <span class="rmd-badge rmd-badge-pill">Approved</span>');
    } else {
      h.push('    <span class="rmd-badge rmd-badge-soft">Draft (not final yet)</span>');
    }
    h.push('  </div>');

    /* Action buttons */
    h.push('  <div class="rmd-man-actions">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Editor</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-versions-toggle">Earlier versions (' + st.versions.length + ')</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-diff-toggle">See what changed</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="to-format-check">Journal format check</button>');

    if (!isApproved) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="manuscript-approve">Mark as final</button>');
    } else if (!isLocked) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="manuscript-lock">Lock this version</button>');
    }
    var proj = (SMD.store && SMD.store.getActiveProject) ? SMD.store.getActiveProject() : null;
    var isCaseReport = proj && isCaseProject(proj);
    if (isCaseReport && !isLocked) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="ask-maik-case-report">Ask MaiK to draft it</button>');
    }
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-export">Download Word file</button>');
    h.push('  </div>');
    h.push('</div>');

    if (!isLocked) {
      if (!isCaseReport) {
        if (!st.ai) st.ai = SMD.ai.state();
        h.push('<div class="rmd-man-ai-wrap">');
        h.push(SMD.ai.barHtml(st.ai, { task: "manuscript_draft", label: "manuscript draft", cost: 2 }));
        h.push(SMD.ai.noteHtml(st.ai, "manuscript"));
        h.push(poBlockHtml());
        h.push('</div>');
      }
    }

    /* Phone segmented bar */
    if (phone) {
      h.push('<div class="rmd-man-phone-bar">');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "sections" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="sections">Sections</button>');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "detail" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="detail">Read section</button>');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "approve" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="approve">Approve</button>');
      h.push('</div>');
      h.push('<div class="rmd-phone-notice" style="margin: 8px 14px 0;">');
      h.push('  On a phone you can read sections and mark them as final. Editing needs a tablet.');
      h.push('</div>');
    }

    /* Main split layout */
    h.push('<div class="rmd-man-split">');

    /* Left pane: section list */
    var leftHideClass = (phone && st.phoneTab !== "sections") ? " rmd-phone-hide" : "";
    h.push('<div class="rmd-man-left' + leftHideClass + '">');
    h.push('  <div class="rmd-pane-header">');
    h.push('    <span class="rmd-role-tag">Sections of your paper</span>');
    h.push('  </div>');
    h.push('  <div class="rmd-section-list">');

    var navSections = sectionSidebarItems(man, proj);
    var activeCurSec = getSection(st.selectedSectionId);
    for (var i = 0; i < navSections.length; i++) {
      var item = navSections[i];
      var secObj = null;
      if (man && man.sections) {
        for (var si = 0; si < man.sections.length; si++) {
          if (man.sections[si].id === item.id) { secObj = man.sections[si]; break; }
        }
      }
      var words = wordCount(secObj ? secObj.text : "");
      var isActive = activeCurSec ? (activeCurSec.id === item.id) : (st.selectedSectionId === item.id);

      h.push('    <button type="button" class="rmd-section-item' + (isActive ? ' rmd-section-item-active' : '') + '" data-section-id="' + esc(item.id) + '">');
      h.push('      <div class="rmd-section-item-head">');
      h.push('        <span class="rmd-section-item-label">' + esc(item.label) + '</span>');
      h.push('        <span class="rmd-section-item-meta">' + words + ' words</span>');
      h.push('      </div>');
      if (secObj && secObj.text && secObj.text.indexOf("Drafted by MaiK") >= 0) {
        h.push('      <span class="rmd-drafted-by-maik" style="display:block; font-size:11px; color:var(--rmd-acc); margin-top:2px;">Drafted by MaiK, check it</span>');
      }
      h.push('      <span class="rmd-section-item-desc">' + esc(item.hint) + '</span>');
      h.push('    </button>');
    }
    h.push('  </div>');

    /* Gate failures list (if any) */
    if (st.gateFailures && st.gateFailures.length > 0) {
      h.push('  <div style="padding:14px;">');
      h.push('    <div class="rmd-gate-card">');
      h.push('      <h4 class="rmd-gate-title">Fix these before downloading (' + st.gateFailures.length + ')</h4>');
      h.push('      <div class="rmd-gate-failure-list">');
      for (var g = 0; g < st.gateFailures.length; g++) {
        var fail = st.gateFailures[g];
        var copy = gateCopy(fail);
        h.push('        <div class="rmd-gate-failure-item" data-section="' + esc(fail.sectionId || "results") + '" data-gate-type="' + esc(fail.type) + '">');
        h.push('          <div class="rmd-gate-item-info">');
        h.push('            <span class="rmd-gate-type">' + esc(copy.label) + '</span>');
        h.push('            <span class="rmd-gate-msg">' + esc(copy.message) + '</span>');
        h.push('          </div>');
        h.push('          <button type="button" class="rmd-btn rmd-btn-sm rmd-btn-subtle" data-rmd-jump="' + esc(fail.sectionId || "results") + '">Go to section</button>');
        h.push('        </div>');
      }
      h.push('      </div>');
      h.push('    </div>');
      h.push('  </div>');
    }
    h.push('</div>');

    /* Right pane: editor, versions or diff */
    var rightHideClass = (phone && st.phoneTab === "sections") ? " rmd-phone-hide" : "";
    h.push('<div class="rmd-man-right' + rightHideClass + '">');

    /* Phone notice */
    if (phone) {
      h.push('<div class="rmd-phone-notice">');
      h.push('  On a phone you can read sections and mark them as final. Editing needs a tablet.');
      h.push('</div>');
    }

    /* Save/export notice */
    if (st.saveNotice) {
      h.push('<div class="rmd-banner rmd-banner-info" role="status"><span>' + esc(st.saveNotice) + '</span></div>');
    }
    if (st.exportNotice) {
      var noticeClass = st.exportNoticeKind === "info" ? "rmd-banner-info" :
        (st.exportNoticeKind === "error" ? "rmd-banner-error" : "rmd-banner-warn");
      h.push('<div class="rmd-banner ' + noticeClass + '" role="' + (st.exportNoticeKind === "info" ? "status" : "alert") + '"><span>' + esc(st.exportNotice) + '</span></div>');
    }

    if (isLocked) {
      h.push('<div class="rmd-locked-banner">');
      h.push('  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>');
      h.push('  <div>');
      h.push('    <strong>This version is locked. It can be read but not changed.</strong>');
      h.push('  </div>');
      h.push('</div>');
    }

    /* Sub-view: versions list */
    if (st.viewMode === "versions") {
      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <h4 class="rmd-editor-title">Earlier versions</h4>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Back to editor</button>');
      h.push('  </div>');
      h.push('  <div class="rmd-section-list">');
      for (var v = 0; v < st.versions.length; v++) {
        var ver = st.versions[v];
        var verStatus = ver.status === "locked" ? "locked (final)" :
          (ver.status === "approved" ? "approved" : "draft (not final yet)");
        h.push('    <div class="rmd-section-item" style="cursor:default;">');
        h.push('      <div class="rmd-section-item-head">');
        h.push('        <strong>Version ' + esc(ver.version) + ' (' + esc(verStatus) + ')</strong>');
        h.push('        <span class="rmd-section-item-meta">' + esc(ver.createdAt ? ver.createdAt.substring(0, 10) : "") + '</span>');
        h.push('      </div>');
        h.push('    </div>');
      }
      h.push('  </div>');
      h.push('</div>');
    }
    /* Sub-view: what changed */
    else if (st.viewMode === "diff") {
      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <h4 class="rmd-editor-title">What changed</h4>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Back to editor</button>');
      h.push('  </div>');

      h.push('  <div class="rmd-diff-controls">');
      h.push('    <label>Older version:');
      h.push('      <select class="rmd-diff-select" id="rmdDiffBase">');
      for (var vb = 0; vb < st.versions.length; vb++) {
        var vnumB = st.versions[vb].version;
        h.push('        <option value="' + vnumB + '"' + (st.diffBaseVersion === vnumB ? ' selected' : '') + '>v' + vnumB + '</option>');
      }
      h.push('      </select>');
      h.push('    </label>');

      h.push('    <label>Newer version:');
      h.push('      <select class="rmd-diff-select" id="rmdDiffTarget">');
      for (var vt = 0; vt < st.versions.length; vt++) {
        var vnumT = st.versions[vt].version;
        h.push('        <option value="' + vnumT + '"' + (st.diffTargetVersion === vnumT ? ' selected' : '') + '>v' + vnumT + '</option>');
      }
      h.push('      </select>');
      h.push('    </label>');

      h.push('    <label>Section:');
      h.push('      <select class="rmd-diff-select" id="rmdDiffSection">');
      for (var ds = 0; ds < IMRAD_SECTIONS.length; ds++) {
        var sid = IMRAD_SECTIONS[ds].id;
        h.push('        <option value="' + sid + '"' + (st.diffSectionId === sid ? ' selected' : '') + '>' + esc(IMRAD_SECTIONS[ds].label) + '</option>');
      }
      h.push('      </select>');
      h.push('    </label>');
      h.push('  </div>');

      var textA = plainText(getVersionText(st.diffBaseVersion, st.diffSectionId));
      var textB = plainText(getVersionText(st.diffTargetVersion, st.diffSectionId));
      var diffHtml = computeDiff(textA, textB);

      h.push('  <div class="rmd-diff-view">');
      h.push(diffHtml);
      h.push('  </div>');
      h.push('</div>');
    }
    /* Sub-view: active section editor */
    else {
      var curSec = getSection(st.selectedSectionId);
      var secText = curSec ? curSec.text : "";
      var isReadOnly = isLocked || phone;

      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <div>');
      h.push('      <h4 class="rmd-editor-title">' + esc(curSec ? curSec.heading : "Section") + '</h4>');
      h.push('      <span class="rmd-editor-sub">Numbers come straight from your analysis, so they are always correct.</span>');
      h.push('    </div>');

      if (!isLocked && !phone) {
        h.push('    <div class="rmd-editor-actions">');
        h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="polish-wording">Ask MaiK: polish the wording</button>');
        h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="insert-result">Insert a result</button>');
        h.push('      <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="section-save">Save</button>');
        h.push('    </div>');
      } else if (!isLocked && phone) {
        h.push('    <div class="rmd-editor-actions" style="margin-top:8px;">');
        h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="polish-wording">Ask MaiK: polish the wording</button>');
        h.push('    </div>');
      }
      h.push('  </div>');

      if (st.caseReportMissingNumbers && st.caseReportMissingNumbers.length) {
        h.push('  <div class="rmd-numbers-warning rmd-missing-number-flag" style="margin: 8px 0; padding: 10px; background: rgba(245,159,0,0.1); border: 1px solid #f59f00; border-radius: 4px; color: #fcc419; font-size: 13px;">');
        h.push('    <strong>Verification warning:</strong> This number is not in your case file. Check it: ' + esc(st.caseReportMissingNumbers.join(", ")));
        h.push('  </div>');
      }

      if (st.polishBusy) {
        h.push('  <div class="rmd-banner rmd-banner-info" role="status"><span>MaiK is polishing the wording...</span></div>');
      }
      if (st.polishError) {
        h.push('  ' + p2().errHtml(st.polishError, "polish-retry"));
      }
      if (st.polishDraft && st.polishDraft.sectionId === st.selectedSectionId) {
        var pDraft = st.polishDraft;
        var pendingChanges = pDraft.changes.filter(function (c) { return c.status === "pending"; });
        h.push('  <div class="rmd-polish-card" data-rmd="polish-panel">');
        h.push('    <div class="rmd-polish-head">');
        h.push('      <div>');
        h.push('        <h4 class="rmd-card-heading">Tracked changes (MaiK wording polish)</h4>');
        h.push('        <span class="rmd-muted">' + (pendingChanges.length ? pendingChanges.length + ' suggested improvement' + (pendingChanges.length === 1 ? '' : 's') + ' to review' : 'All changes reviewed') + '</span>');
        h.push('      </div>');
        h.push('      <div class="rmd-polish-head-actions">');
        if (pendingChanges.length > 0) {
          h.push('        <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="polish-accept-all">Accept all</button>');
        }
        h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="polish-dismiss">Dismiss</button>');
        h.push('      </div>');
        h.push('    </div>');

        if (!pDraft.changes.length) {
          h.push('    <p class="rmd-muted" style="margin: 8px 0 0;">No wording changes suggested. The section text is already clear and concise.</p>');
        } else {
          h.push('    <div class="rmd-polish-list">');
          for (var ci = 0; ci < pDraft.changes.length; ci++) {
            var ch = pDraft.changes[ci];
            h.push('      <div class="rmd-polish-change-item" data-polish-idx="' + ci + '">');
            h.push('        <div class="rmd-polish-change-header">');
            h.push('          <span class="rmd-badge rmd-badge-pill">' + esc(polishReasonLabel(ch.reason)) + '</span>');
            if (ch.status === "pending") {
              h.push('          <div class="rmd-polish-change-actions">');
              h.push('            <button type="button" class="rmd-btn rmd-btn-sm rmd-btn-primary" data-rmd-polish-accept="' + ci + '">Accept</button>');
              h.push('            <button type="button" class="rmd-btn rmd-btn-sm rmd-btn-subtle" data-rmd-polish-reject="' + ci + '">Reject</button>');
              h.push('          </div>');
            } else {
              h.push('          <span class="rmd-badge rmd-badge-soft">' + (ch.status === "accepted" ? "Accepted" : "Rejected") + '</span>');
            }
            h.push('        </div>');
            h.push('        <div class="rmd-polish-diff">');
            h.push('          <del class="rmd-diff-del">' + esc(ch.before) + '</del> ');
            h.push('          <ins class="rmd-diff-ins">' + esc(ch.after) + '</ins>');
            h.push('        </div>');
            h.push('      </div>');
          }
          h.push('    </div>');
        }
        h.push('  </div>');
      }

      h.push('  <div id="rmdSectionEditor" class="rmd-man-editor" role="textbox" aria-multiline="true"' +
        ' aria-label="' + esc((curSec ? curSec.heading : "Section") + " text") + '"' +
        ' contenteditable="' + (isReadOnly ? "false" : "true") + '"' +
        (isReadOnly ? ' aria-readonly="true"' : '') + '>' +
        buildEditorHtml(secText) + '</div>');

      /* Phone action cards */
      if (phone && st.phoneTab === "approve") {
        h.push('  <div class="rmd-card" style="margin-top:12px;">');
        h.push('    <h4 class="rmd-card-heading">Mark as final and lock</h4>');
        h.push('    <p style="font-size:13px;color:var(--rmd-mut);">Check the numbers and claims, then mark this version as final. Locking is final and cannot be undone.</p>');
        if (!isApproved) {
          h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="manuscript-approve">Mark as final (approve this version)</button>');
        } else if (!isLocked) {
          h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="manuscript-lock">Lock this version (make it read-only)</button>');
        } else {
          h.push('    <span class="rmd-badge rmd-badge-pill">Locked</span>');
        }
        h.push('  </div>');
      }

      h.push('</div>');
    }

    h.push('</div>'); /* /rmd-man-right */
    h.push('</div>'); /* /rmd-man-split */
    h.push('</div>'); /* /rmd-manuscript-screen */

    container.innerHTML = h.join("\n");
    bindEvents(container);
  }

  /* Bind user interactions */
  function bindEvents(container) {
    if (!container) return;

    /* Section list item selection */
    var items = container.querySelectorAll(".rmd-section-item[data-section-id]");
    for (var i = 0; i < items.length; i++) {
      items[i].onclick = function () {
        var sid = this.getAttribute("data-section-id");
        if (sid) {
          st.selectedSectionId = sid;
          st.viewMode = "editor";
          if (isPhone()) st.phoneTab = "detail";
          render(container);
        }
      };
    }

    /* Phone segmented tabs */
    var pTabs = container.querySelectorAll("[data-rmd-phone-tab]");
    for (var pt = 0; pt < pTabs.length; pt++) {
      pTabs[pt].onclick = function () {
        st.phoneTab = this.getAttribute("data-rmd-phone-tab");
        render(container);
      };
    }

    /* Navigation toolbar actions */
    var btnEditor = container.querySelector('[data-rmd="manuscript-mode-editor"]');
    if (btnEditor) {
      btnEditor.onclick = function () {
        st.viewMode = "editor";
        render(container);
      };
    }

    var btnVersions = container.querySelector('[data-rmd="manuscript-versions-toggle"]');
    if (btnVersions) {
      btnVersions.onclick = function () {
        st.viewMode = "versions";
        render(container);
      };
    }

    var btnDiff = container.querySelector('[data-rmd="manuscript-diff-toggle"]');
    if (btnDiff) {
      btnDiff.onclick = function () {
        st.viewMode = "diff";
        render(container);
      };
    }

    var btnDraftCr = container.querySelector('[data-rmd="ask-maik-case-report"]');
    if (btnDraftCr) {
      btnDraftCr.onclick = function () {
        openCaseReportDraftModal(container);
      };
    }

    if (isPoEnabled()) {
      var poBtns = container.querySelectorAll('[data-rmd="full-draft-po"]');
      for (var pbi = 0; pbi < poBtns.length; pbi++) {
        poBtns[pbi].onclick = function () {
          openPoConfirm(container);
        };
      }
      var poStart = container.querySelector('[data-rmd="po-start"]');
      if (poStart) {
        poStart.onclick = function () {
          startPoDraft(container);
        };
      }
      var poDismiss = container.querySelector('[data-rmd="po-dismiss"]');
      if (poDismiss) {
        poDismiss.onclick = function () {
          st.poConfirm = null;
          render(container);
        };
      }
      var poCancelBtns = container.querySelectorAll('[data-rmd="po-cancel"]');
      for (var pci = 0; pci < poCancelBtns.length; pci++) {
        poCancelBtns[pci].onclick = function () {
          cancelPoJob(container);
        };
      }
      var poContinue = container.querySelector('[data-rmd="po-continue"]');
      if (poContinue) {
        poContinue.onclick = function () {
          continuePoDraft(container);
        };
      }
    }

    var btnSave = container.querySelector('[data-rmd="section-save"]');
    if (btnSave) {
      btnSave.onclick = function () {
        saveCurrentSection(container);
      };
    }

    var btnInsert = container.querySelector('[data-rmd="insert-result"]');
    if (btnInsert) {
      btnInsert.onclick = function () {
        toggleInsertPanel(container);
      };
    }

    var btnApprove = container.querySelectorAll('[data-rmd="manuscript-approve"]');
    for (var ba = 0; ba < btnApprove.length; ba++) {
      btnApprove[ba].onclick = function () {
        approveManuscript(container);
      };
    }

    var btnLock = container.querySelectorAll('[data-rmd="manuscript-lock"]');
    for (var bl = 0; bl < btnLock.length; bl++) {
      btnLock[bl].onclick = function () {
        lockManuscript(container);
      };
    }

    var btnExport = container.querySelector('[data-rmd="manuscript-export"]');
    if (btnExport) {
      btnExport.onclick = function () {
        exportDocx(container);
      };
    }

    /* Journal format check link */
    var btnFormatCheck = container.querySelector('[data-rmd="to-format-check"]');
    if (btnFormatCheck) {
      btnFormatCheck.onclick = function () {
        SMD.navigate("ready", {});
      };
    }

    /* Polish wording button and panel actions */
    var btnPolish = container.querySelectorAll('[data-rmd="polish-wording"]');
    for (var bp = 0; bp < btnPolish.length; bp++) {
      btnPolish[bp].onclick = function () {
        runPolish(container);
      };
    }

    var btnPolishRetry = container.querySelector('[data-rmd="polish-retry"]');
    if (btnPolishRetry) {
      btnPolishRetry.onclick = function () {
        runPolish(container);
      };
    }

    var btnAcceptAll = container.querySelector('[data-rmd="polish-accept-all"]');
    if (btnAcceptAll) {
      btnAcceptAll.onclick = function () {
        if (!st.polishDraft) return;
        var curSec = getSection(st.selectedSectionId);
        if (!curSec) return;
        if (st.polishDraft.polished) {
          curSec.text = st.polishDraft.polished;
          saveLocalManuscript(st.projectId, st.manuscript);
          if (SMD.api) {
            SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(apiProjectId()) + "/manuscript/sections/" + encodeURIComponent(curSec.id), {
              version: st.manuscript.version,
              heading: curSec.heading,
              text: curSec.text
            }).catch(function () {});
          }
          st.saveNotice = "Polished wording accepted.";
          st.polishDraft = null;
          render(container);
        }
      };
    }

    var btnDismiss = container.querySelector('[data-rmd="polish-dismiss"]');
    if (btnDismiss) {
      btnDismiss.onclick = function () {
        st.polishDraft = null;
        st.polishError = null;
        render(container);
      };
    }

    var acceptBtns = container.querySelectorAll("[data-rmd-polish-accept]");
    for (var ab = 0; ab < acceptBtns.length; ab++) {
      acceptBtns[ab].onclick = function () {
        var idx = parseInt(this.getAttribute("data-rmd-polish-accept"), 10);
        if (isNaN(idx) || !st.polishDraft) return;
        var ch = st.polishDraft.changes[idx];
        var curSec = getSection(st.selectedSectionId);
        if (ch && curSec && ch.status === "pending") {
          if (ch.before && curSec.text.indexOf(ch.before) >= 0) {
            curSec.text = curSec.text.replace(ch.before, ch.after);
          }
          ch.status = "accepted";
          saveLocalManuscript(st.projectId, st.manuscript);
          if (SMD.api) {
            SMD.api.request("PUT", "/v1/projects/" + encodeURIComponent(apiProjectId()) + "/manuscript/sections/" + encodeURIComponent(curSec.id), {
              version: st.manuscript.version,
              heading: curSec.heading,
              text: curSec.text
            }).catch(function () {});
          }
          st.saveNotice = "Change accepted.";
          render(container);
        }
      };
    }

    var rejectBtns = container.querySelectorAll("[data-rmd-polish-reject]");
    for (var rb = 0; rb < rejectBtns.length; rb++) {
      rejectBtns[rb].onclick = function () {
        var idx = parseInt(this.getAttribute("data-rmd-polish-reject"), 10);
        if (isNaN(idx) || !st.polishDraft) return;
        var ch = st.polishDraft.changes[idx];
        if (ch && ch.status === "pending") {
          ch.status = "rejected";
          render(container);
        }
      };
    }

    /* Jump buttons for gate failures */
    var jumpBtns = container.querySelectorAll("[data-rmd-jump]");
    for (var j = 0; j < jumpBtns.length; j++) {
      jumpBtns[j].onclick = function (e) {
        e.stopPropagation();
        var targetSec = this.getAttribute("data-rmd-jump");
        if (targetSec) {
          jumpToSection(container, targetSec);
        }
      };
    }

    /* Diff selectors */
    var diffBase = container.querySelector("#rmdDiffBase");
    if (diffBase) {
      diffBase.onchange = function () {
        st.diffBaseVersion = Number(this.value);
        render(container);
      };
    }
    var diffTarget = container.querySelector("#rmdDiffTarget");
    if (diffTarget) {
      diffTarget.onchange = function () {
        st.diffTargetVersion = Number(this.value);
        render(container);
      };
    }
    var diffSec = container.querySelector("#rmdDiffSection");
    if (diffSec) {
      diffSec.onchange = function () {
        st.diffSectionId = this.value;
        render(container);
      };
    }

    /* Editor: plain prose with non-editable number spans */
    var editor = container.querySelector("#rmdSectionEditor");
    if (editor) {
      var readOnly = editor.getAttribute("contenteditable") === "false";

      editor.onclick = function (e) {
        var t = e.target;
        var span = (t && t.closest) ? t.closest(".rmd-num") : null;
        if (span) {
          e.preventDefault();
          openNumPopover(span);
        }
      };

      editor.onkeydown = function (e) {
        var key = e.key;
        var t = e.target;
        if (t && t.classList && t.classList.contains("rmd-num") &&
            (key === "Enter" || key === " " || key === "Spacebar")) {
          e.preventDefault();
          e.stopPropagation();
          openNumPopover(t);
          return;
        }
        if (readOnly) return;
        if (key === "Enter") {
          e.preventDefault();
          insertNewlineAtCaret(editor);
          syncEditorText(editor);
        } else if (key === "Backspace" || key === "Delete") {
          var sp = adjacentSpan(editor, key === "Delete");
          if (sp) {
            e.preventDefault();
            sp.parentNode.removeChild(sp);
            syncEditorText(editor);
          }
        }
      };

      editor.onkeyup = function () { saveCaret(editor); };
      editor.onmouseup = function () { saveCaret(editor); };
      editor.onblur = function () { saveCaret(editor); };
      editor.oninput = function () {
        if (!readOnly) {
          ensurePad(editor);
          syncEditorText(editor);
        }
      };
    }

    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: st.projectId, task: "manuscript_draft", label: "manuscript draft", cost: 2,
        request: function () { return startManuscriptDraft(); },
        apply: function (draft) {
          return applyManuscriptDraft(container, draft);
        },
        render: function () { render(container); }
      });
    }
  }

  /* ---------- Local drafts + master chart append ---------- */

  var LOCAL_DRAFT_KEY = "smd_rmd_manuscript_local_v1";

  function readLocalDrafts() {
    try {
      return JSON.parse(localStorage.getItem(LOCAL_DRAFT_KEY) || "{}") || {};
    } catch (e) { return {}; }
  }

  function saveLocalManuscript(pid, man) {
    if (!pid || !man || !man.sections) return;
    var all = readLocalDrafts();
    var sectionsMap = {};
    var headingsMap = {};
    var order = [];
    for (var i = 0; i < man.sections.length; i++) {
      var s = man.sections[i];
      if (!s || !s.id) continue;
      sectionsMap[s.id] = s.text || "";
      headingsMap[s.id] = s.heading || s.id;
      order.push(s.id);
    }
    all[pid] = { sections: sectionsMap, headings: headingsMap, order: order };
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function localManuscript(pid) {
    var d = readLocalDrafts()[pid];
    if (!d || !d.sections) return null;
    var man = defaultManuscript(pid);
    var seen = {};
    for (var i = 0; i < man.sections.length; i++) {
      var sid = man.sections[i].id;
      seen[sid] = true;
      if (d.sections[sid] != null) man.sections[i].text = d.sections[sid];
    }
    var keys = (d.order && d.order.length) ? d.order : Object.keys(d.sections);
    for (var k = 0; k < keys.length; k++) {
      var eid = keys[k];
      if (seen[eid] || d.sections[eid] == null) continue;
      seen[eid] = true;
      var meta = EXTRA_SECTION_META[eid];
      var heading = (d.headings && d.headings[eid]) || (meta && meta.label) || eid;
      man.sections.push({ id: eid, heading: heading, level: 1, text: d.sections[eid] });
    }
    return man;
  }

  function appendLocalResults(pid, text) {
    var all = readLocalDrafts();
    var d = all[pid] || { sections: {} };
    var base = d.sections.results;
    if (base == null) {
      var def = defaultManuscript(pid);
      for (var i = 0; i < def.sections.length; i++) {
        if (def.sections[i].id === "results") base = def.sections[i].text;
      }
    }
    d.sections.results = (base ? base + "\n\n" : "") + text;
    all[pid] = d;
    try {
      localStorage.setItem(LOCAL_DRAFT_KEY, JSON.stringify(all));
    } catch (e) { /* storage full: the append stays in memory for this session */ }
    return Promise.resolve({ local: true });
  }

  function appendManuscriptResults(pid, text) {
    var store = SMD.store;
    var proj = store && store.getProject ? store.getProject(pid) : null;
    if (!SMD.api || !proj || !proj.serverId) return appendLocalResults(pid, text);
    var base = "/v1/projects/" + encodeURIComponent(proj.serverId);
    return SMD.api.request("GET", base + "/manuscript").then(function (res) {
      var man = (res && res.manuscript) || defaultManuscript(pid);
      var sec = null;
      for (var i = 0; i < man.sections.length; i++) {
        if (man.sections[i].id === "results" || /^results$/i.test(man.sections[i].heading || "")) {
          sec = man.sections[i];
          break;
        }
      }
      if (!sec) {
        sec = { id: "results", heading: "Results", level: 1, text: "" };
        man.sections.push(sec);
      }
      var merged = (sec.text ? sec.text + "\n\n" : "") + text;
      return SMD.api.request("PUT", base + "/manuscript/sections/" + encodeURIComponent(sec.id), {
        version: man.version,
        heading: sec.heading,
        text: merged
      }).then(function (r) {
        return r || { ok: true };
      }, function () {
        return appendLocalResults(pid, text);
      });
    }, function () {
      return appendLocalResults(pid, text);
    });
  }

  SMD.appendManuscriptResults = appendManuscriptResults;
  SMD.docxFromSections = function (title, sections) {
    return buildDocxBytes({ title: title, sections: sections || [] });
  };

  /* Register screen */
  SMD.screens.manuscript = {
    render: function (container, params) {
      load(container, params);
    },
    cleanup: function () {
      clearPoPoll();
      st.poCancelling = false;
      st.poCancelError = null;
      st.poFailures = 0;
      st.poConfirm = null;
    },
    _loadCasePromise: loadCasePromise,
    _mapPoError: mapPoError,
    _clearPoPoll: clearPoPoll,
    _pollPoJob: pollPoJob,
    _cancelPoJob: cancelPoJob,
    _getState: function () { return st; },
    _defaultManuscript: defaultManuscript,
    _defaultVersions: defaultVersions,
    _isDemoProject: isDemoProject,
    _openPoConfirm: openPoConfirm,
    showDraftPreviewModal: showDraftPreviewModal
  };

})(typeof window !== "undefined" ? window : global);
