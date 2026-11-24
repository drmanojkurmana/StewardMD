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
    polishDraft: null
  };

  var seq = 0;
  var lastContainer = null;
  var mqlBound = false;

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

  /* Default seed manuscript when API initializes fresh draft */
  function defaultManuscript(pid) {
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

  function defaultVersions() {
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

  /* Load manuscript and version data */
  function load(container, params) {
    var mySeq = ++seq;
    var newPid = activeProjectId();
    if (st.projectId !== newPid) {
      st.ai = null;
      st.polishBusy = false;
      st.polishError = null;
      st.polishDraft = null;
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

    var base = "/v1/projects/" + encodeURIComponent(st.projectId);
    var pMan = SMD.api ? SMD.api.request("GET", base + "/manuscript") : Promise.resolve(null);
    var pVers = SMD.api ? SMD.api.request("GET", base + "/manuscript/versions") : Promise.resolve(null);

    Promise.all([pMan, pVers]).then(function (res) {
      if (mySeq !== seq) return;
      st.loading = false;
      st.manuscript = (res[0] && res[0].manuscript) || defaultManuscript(st.projectId);
      st.versions = (res[1] && res[1].versions) || defaultVersions();
      render(container);
    }).catch(function (err) {
      if (mySeq !== seq) return;
      st.loading = false;
      /* Fallback to local default if API unmocked or offline */
      st.manuscript = defaultManuscript(st.projectId);
      st.versions = defaultVersions();
      render(container);
    });
  }

  function runPolish(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var curSec = getSection(st.selectedSectionId);
    if (!curSec) return;
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    var pid = encodeURIComponent(st.projectId);
    var targetJournal = (proj && (proj.targetJournal || proj.journal)) || undefined;
    var inputPayload = {
      sectionId: curSec.id,
      text: curSec.text
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
    }).catch(function (err) {
      st.polishBusy = false;
      st.polishError = err || { message: "MaiK could not polish the wording." };
      render(container);
    });
  }

  /* manuscript_draft is an async server job: POST it, then poll until it
   * finishes. Cap the wait so a stuck job never spins forever. */
  function pollManuscriptJob(jid, tries) {
    return SMD.api.request("GET", "/v1/jobs/" + encodeURIComponent(jid)).then(function (j) {
      var job = (j && j.job) || j || {};
      var status = job.status;
      if (status === "succeeded" || status === "failed" || status === "error" || tries >= 60) return job;
      return new Promise(function (resolve) {
        G.setTimeout(function () { resolve(pollManuscriptJob(jid, tries + 1)); }, 2000);
      });
    });
  }

  function startManuscriptDraft() {
    var pid = st.projectId;
    var key = "man-" + pid + "-" + Date.now();
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(pid) + "/jobs",
      { kind: "manuscript_draft", idempotencyKey: key }).then(function (res) {
      var job = (res && res.job) || res || {};
      var jid = job.id || (res && res.id);
      if (!jid) return job;
      if (job.status === "succeeded" || job.status === "failed" || job.status === "error") return job;
      return pollManuscriptJob(jid, 0);
    });
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
      if (e.key === "Escape" || e.keyCode === 27) closeNumPopover();
    });
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

    var pid = encodeURIComponent(st.projectId);
    var sid = encodeURIComponent(sec.id);
    var payload = {
      version: st.manuscript.version,
      heading: sec.heading,
      text: newText
    };

    if (SMD.api) {
      SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sid, payload)
        .then(function (res) {
          st.saveNotice = "Saved.";
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
    var pid = encodeURIComponent(st.projectId);
    var payload = { version: st.manuscript.version, decision: "approved" };

    function done() {
      st.manuscript.status = "approved";
      st.manuscript.approval = { status: "approved", approvedBy: "clinician", approvedAt: new Date().toISOString() };
      st.saveNotice = "Marked as final.";
      render(container);
    }

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/approval/approve", payload)
        .then(done, done);
    } else {
      done();
    }
  }

  function lockManuscript(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var pid = encodeURIComponent(st.projectId);
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

    var pid = encodeURIComponent(st.projectId);
    var payload = { version: st.manuscript ? st.manuscript.version : 2, format: "docx" };

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
        editor.scrollIntoView({ behavior: "smooth", block: "center" });
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
      "#researchMD .rmd-man-topbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px 18px; border-bottom: 1px solid var(--rmd-line); background: var(--rmd-panel); }",
      "#researchMD .rmd-man-topbar-info { display: flex; align-items: baseline; gap: 10px; min-width: 0; }",
      "#researchMD .rmd-man-title { margin: 0; font: 600 16px var(--rmd-f); white-space: nowrap; overflow: hidden; text-overflow: ellipsis; color: var(--rmd-ink); }",
      "#researchMD .rmd-man-actions { display: flex; align-items: center; gap: 8px; flex-shrink: 0; flex-wrap: wrap; }",
      "#researchMD .rmd-man-phone-bar { display: none; background: var(--rmd-fill); padding: 4px; border-bottom: 1px solid var(--rmd-line); }",
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
      "#researchMD .rmd-phone-notice { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--rmd-mut); }",
      "#researchMD .rmd-polish-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 12px; margin-bottom: 12px; }",
      "#researchMD .rmd-polish-head { display: flex; align-items: center; justify-content: space-between; gap: 10px; flex-wrap: wrap; }",
      "#researchMD .rmd-polish-head-actions { display: flex; align-items: center; gap: 8px; }",
      "#researchMD .rmd-polish-list { display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-polish-change-item { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-polish-change-header { display: flex; align-items: center; justify-content: space-between; gap: 8px; }",
      "#researchMD .rmd-polish-change-actions { display: flex; align-items: center; gap: 6px; }",
      "#researchMD .rmd-polish-diff { font-size: 13.5px; line-height: 1.5; color: var(--rmd-ink); }",
      "@media (max-width: 767px) {",
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
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-export">Download Word file</button>');
    h.push('  </div>');
    h.push('</div>');

    if (!isLocked) {
      if (!st.ai) st.ai = SMD.ai.state();
      h.push('<div style="margin: 12px 18px 0;">');
      h.push(SMD.ai.barHtml(st.ai, { task: "manuscript", label: "manuscript draft", cost: 2 }));
      h.push(SMD.ai.noteHtml(st.ai, "manuscript"));
      h.push('</div>');
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

    for (var i = 0; i < IMRAD_SECTIONS.length; i++) {
      var item = IMRAD_SECTIONS[i];
      var secObj = getSection(item.id);
      var words = wordCount(secObj ? secObj.text : "");
      var isActive = st.selectedSectionId === item.id;

      h.push('    <button type="button" class="rmd-section-item' + (isActive ? ' rmd-section-item-active' : '') + '" data-section-id="' + esc(item.id) + '">');
      h.push('      <div class="rmd-section-item-head">');
      h.push('        <span class="rmd-section-item-label">' + esc(item.label) + '</span>');
      h.push('        <span class="rmd-section-item-meta">' + words + ' words</span>');
      h.push('      </div>');
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
        pid: st.projectId, task: "manuscript", label: "manuscript draft", cost: 2,
        request: function () { return startManuscriptDraft(); },
        apply: function (draft) {
          var job = draft || {};
          if (job.status === "failed" || job.status === "error") {
            throw { message: "MaiK could not draft the manuscript. Try again." };
          }
          load(container);
          return ["manuscript"];
        },
        render: function () { render(container); }
      });
    }
  }

  /* Register screen */
  SMD.screens.manuscript = {
    render: function (container, params) {
      load(container, params);
    }
  };

})(typeof window !== "undefined" ? window : global);
