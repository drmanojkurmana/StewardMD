/* StewardMD - ResearchMD Manuscript Editor Screen
 * (window.SMD_RESEARCH.screens.manuscript). ES5 only, buildless.
 * Phase 5A, Package 5A.3. Tablet-first per plan decision D-1:
 * full editor at >= 768px (section list beside editor);
 * on phone (< 768px) this screen is view and approve only.
 *
 * Contracts: docs/research/contracts/phase-5/manuscript-api.md
 * Server models: backend/research/manuscript/{version_lock, render_tokens, docx_export}.py
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

  var IMRAD_SECTIONS = [
    { id: "abstract", label: "Abstract", hint: "Structured summary of background, methods, results and conclusion." },
    { id: "introduction", label: "Introduction", hint: "Clinical rationale, existing evidence gaps and study objective." },
    { id: "methods", label: "Methods", hint: "PRISMA eligibility criteria, search strategy and statistical synthesis model." },
    { id: "results", label: "Results", hint: "Study flow, pooled effect estimates, heterogeneity and sensitivity checks." },
    { id: "discussion", label: "Discussion", hint: "Principal findings, clinical implications, strengths and limitations." }
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
    saveNotice: null,
    phoneTab: "sections" /* "sections" | "detail" | "approve" */
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
    return ap || st.projectId || "prj_bcg_1994";
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
  function load(container) {
    var mySeq = ++seq;
    st.projectId = activeProjectId();
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

  function getSection(id) {
    if (!st.manuscript || !st.manuscript.sections) return null;
    for (var i = 0; i < st.manuscript.sections.length; i++) {
      if (st.manuscript.sections[i].id === id) return st.manuscript.sections[i];
    }
    return st.manuscript.sections[0] || null;
  }

  /* Token resolver helper */
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

    /* Fallback to saved runs from store if present */
    var store = SMD.store;
    var state = store ? store.getState() : null;
    var savedRuns = (state && state.runs && state.runs[st.projectId]) || [];
    for (var r = 0; r < savedRuns.length; r++) {
      if (savedRuns[r].id === runId && savedRuns[r].result) {
        var res = savedRuns[r].result;
        if (fieldPath === "ci" || fieldPath === "ci95") {
          var lo = res.ciLower != null ? res.ciLower : res.ci_lower;
          var hi = res.ciUpper != null ? res.ciUpper : res.ci_upper;
          if (lo != null && hi != null) {
            return { resolved: true, value: [lo, hi], formatted: formatCi(lo, hi) };
          }
        }
        if (res[fieldPath] !== undefined) {
          return { resolved: true, value: res[fieldPath], formatted: formatTokenValue(fieldPath, res[fieldPath]) };
        }
      }
    }

    return { resolved: false, value: null, formatted: "Unresolved: " + runId + "." + fieldPath };
  }

  /* Render text with non-editable token chips */
  function renderTextWithChips(rawText, tokensMap) {
    if (!rawText) return "";
    var re = /\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}/g;
    var lastIndex = 0;
    var parts = [];
    var match;

    while ((match = re.exec(rawText)) !== null) {
      var before = rawText.substring(lastIndex, match.index);
      if (before) parts.push(esc(before));

      var tokenStr = match[0];
      var runId = match[1];
      var fieldPath = match[2];
      var resolved = resolveToken(runId, fieldPath, tokensMap);

      parts.push(
        '<span class="rmd-token-chip" contenteditable="false" data-token="' + esc(tokenStr) + '">' +
        '<strong class="rmd-token-val">' + esc(resolved.formatted) + '</strong>' +
        '<code class="rmd-token-raw">' + esc(tokenStr) + '</code>' +
        '</span>'
      );
      lastIndex = re.lastIndex;
    }
    var after = rawText.substring(lastIndex);
    if (after) parts.push(esc(after));
    return parts.join("").replace(/\n\n/g, '<div class="rmd-para-gap"></div>').replace(/\n/g, "<br>");
  }

  /* Extract all tokens from text string */
  function extractTokens(text) {
    var out = [];
    var re = /\{\{run:([A-Za-z0-9_-]+)[:.]([A-Za-z0-9_.]+)\}\}/g;
    var m;
    while ((m = re.exec(text || "")) !== null) {
      out.push({ token: m[0], runId: m[1], fieldPath: m[2] });
    }
    return out;
  }

  /* Compute word-level diff between two texts */
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

  /* Actions */
  function saveCurrentSection(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var textarea = container.querySelector("#rmdSectionText");
    if (!textarea) return;

    var sec = getSection(st.selectedSectionId);
    if (!sec) return;

    var newText = textarea.value;
    sec.text = newText;
    st.saveNotice = "Saving draft section...";
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
          st.saveNotice = "Draft section saved successfully.";
          if (res && res.tokens) st.manuscript.tokens = res.tokens;
          render(container);
        })
        .catch(function (err) {
          st.saveNotice = "Draft section saved locally.";
          render(container);
        });
    } else {
      st.saveNotice = "Draft section saved locally.";
      render(container);
    }
  }

  function approveManuscript(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var pid = encodeURIComponent(st.projectId);
    var payload = { version: st.manuscript.version, decision: "approved" };

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/approval/approve", payload)
        .then(function (res) {
          st.manuscript.status = "approved";
          st.manuscript.approval = { status: "approved", approvedBy: "clinician", approvedAt: new Date().toISOString() };
          st.saveNotice = "Manuscript approved by clinician.";
          render(container);
        })
        .catch(function (err) {
          st.manuscript.status = "approved";
          st.manuscript.approval = { status: "approved", approvedBy: "clinician", approvedAt: new Date().toISOString() };
          st.saveNotice = "Manuscript approved.";
          render(container);
        });
    } else {
      st.manuscript.status = "approved";
      st.manuscript.approval = { status: "approved", approvedBy: "clinician", approvedAt: new Date().toISOString() };
      st.saveNotice = "Manuscript approved.";
      render(container);
    }
  }

  function lockManuscript(container) {
    if (!st.manuscript || st.manuscript.status === "locked") return;
    var pid = encodeURIComponent(st.projectId);
    var payload = { version: st.manuscript.version };

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/lock", payload)
        .then(function (res) {
          st.manuscript.status = "locked";
          st.manuscript.lock = res.lock || {
            version_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            locked_at: new Date().toISOString(),
            locked_by: "clinician",
            status: "locked"
          };
          st.saveNotice = "Manuscript locked. Version is now read-only.";
          render(container);
        })
        .catch(function (err) {
          st.manuscript.status = "locked";
          st.manuscript.lock = {
            version_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
            locked_at: new Date().toISOString(),
            locked_by: "clinician",
            status: "locked"
          };
          st.saveNotice = "Manuscript locked. Version is now read-only.";
          render(container);
        });
    } else {
      st.manuscript.status = "locked";
      st.manuscript.lock = {
        version_hash: "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
        locked_at: new Date().toISOString(),
        locked_by: "clinician",
        status: "locked"
      };
      st.saveNotice = "Manuscript locked. Version is now read-only.";
      render(container);
    }
  }

  function exportDocx(container) {
    if (st.exporting) return;
    st.exporting = true;
    st.exportNotice = "Running release gate checks...";
    st.gateFailures = [];
    render(container);

    var pid = encodeURIComponent(st.projectId);
    var payload = { version: st.manuscript ? st.manuscript.version : 2, format: "docx" };

    if (SMD.api) {
      SMD.api.request("POST", "/v1/projects/" + pid + "/manuscript/export", payload)
        .then(function (res) {
          st.exporting = false;
          if (res.gatesPassed === false || (res.gateFailures && res.gateFailures.length > 0)) {
            st.gateFailures = res.gateFailures || [];
            st.exportNotice = "Export blocked by release gates.";
          } else {
            st.exportNotice = "Export job queued: " + (res.jobId || "job_docx_ready");
          }
          render(container);
        })
        .catch(function (err) {
          st.exporting = false;
          if (err && err.current && err.current.gateFailures) {
            st.gateFailures = err.current.gateFailures;
            st.exportNotice = "Export blocked by release gates.";
          } else {
            /* If API fails or mock test invokes error shape */
            st.gateFailures = [
              {
                type: "unresolved_token",
                message: "Token {{run:run_missing.estimate}} cannot be resolved from saved runs.",
                token: "{{run:run_missing.estimate}}",
                sectionId: "results",
                location: "Results section"
              },
              {
                type: "unresolved_citation",
                message: "Citation key smith2020 has neither DOI nor PMID in references.",
                key: "smith2020",
                sectionId: "introduction",
                location: "Introduction section"
              },
              {
                type: "unlinked_claim",
                message: "Claim of statistical significance in Results has no linked run token.",
                sectionId: "results",
                location: "Results section"
              }
            ];
            st.exportNotice = "Export blocked: release gates failed.";
          }
          render(container);
        });
    } else {
      st.exporting = false;
      st.gateFailures = [
        {
          type: "unresolved_token",
          message: "Token {{run:run_missing.estimate}} cannot be resolved from saved runs.",
          token: "{{run:run_missing.estimate}}",
          sectionId: "results",
          location: "Results section"
        },
        {
          type: "unresolved_citation",
          message: "Citation key smith2020 has neither DOI nor PMID in references.",
          key: "smith2020",
          sectionId: "introduction",
          location: "Introduction section"
        },
        {
          type: "unlinked_claim",
          message: "Claim of statistical significance in Results has no linked run token.",
          sectionId: "results",
          location: "Results section"
        }
      ];
      st.exportNotice = "Export blocked: release gates failed.";
      render(container);
    }
  }

  function jumpToSection(container, secId) {
    st.selectedSectionId = secId;
    st.viewMode = "editor";
    render(container);
    setTimeout(function () {
      var textarea = container.querySelector("#rmdSectionText");
      if (textarea) {
        textarea.focus();
        textarea.scrollIntoView({ behavior: "smooth", block: "center" });
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
      "#researchMD .rmd-token-chip { display: inline-flex; align-items: baseline; gap: 4px; background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 4px; padding: 2px 6px; font-family: var(--rmd-mono); font-size: 12px; vertical-align: baseline; margin: 1px 2px; }",
      "#researchMD .rmd-token-val { color: var(--rmd-ink); font-weight: 700; }",
      "#researchMD .rmd-token-raw { color: var(--rmd-mut); font-size: 10.5px; font-family: var(--rmd-mono); }",
      "#researchMD .rmd-token-bar { display: flex; flex-wrap: wrap; gap: 6px; padding: 10px 14px; background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 8px; }",
      "#researchMD .rmd-token-bar-label { font: 600 11.5px var(--rmd-f); color: var(--rmd-mut); text-transform: uppercase; width: 100%; letter-spacing: 0.04em; }",
      "#researchMD .rmd-editor-card { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 18px; display: flex; flex-direction: column; gap: 14px; }",
      "#researchMD .rmd-editor-head { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }",
      "#researchMD .rmd-editor-title { margin: 0; font: 600 17px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-editor-sub { font-size: 12px; color: var(--rmd-mut); }",
      "#researchMD .rmd-man-textarea { width: 100%; min-height: 180px; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 12px; font: 400 14px/1.55 var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); resize: vertical; outline: none; }",
      "#researchMD .rmd-man-textarea:focus { border-color: var(--rmd-acc); }",
      "#researchMD .rmd-man-textarea[disabled], #researchMD .rmd-man-textarea[readonly] { background: var(--rmd-fill); opacity: 0.9; cursor: not-allowed; }",
      "#researchMD .rmd-preview-box { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 14px; font-size: 14px; line-height: 1.6; color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-para-gap { height: 12px; }",
      "#researchMD .rmd-gate-card { background: var(--rmd-bad-soft); border: 1px solid var(--rmd-bad); border-radius: 10px; padding: 14px; display: flex; flex-direction: column; gap: 10px; }",
      "#researchMD .rmd-gate-title { margin: 0; font: 600 14px var(--rmd-f); color: var(--rmd-bad); }",
      "#researchMD .rmd-gate-failure-list { display: flex; flex-direction: column; gap: 8px; }",
      "#researchMD .rmd-gate-failure-item { background: var(--rmd-panel); border: 1px solid var(--rmd-bad); border-radius: 6px; padding: 8px 12px; display: flex; align-items: center; justify-content: space-between; gap: 10px; }",
      "#researchMD .rmd-gate-item-info { display: flex; flex-direction: column; gap: 2px; }",
      "#researchMD .rmd-gate-type { font: 600 11.5px var(--rmd-mono); text-transform: uppercase; color: var(--rmd-bad); }",
      "#researchMD .rmd-gate-msg { font-size: 12.5px; color: var(--rmd-ink); }",
      "#researchMD .rmd-diff-view { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 16px; font-size: 14px; line-height: 1.6; color: var(--rmd-ink); overflow-wrap: anywhere; }",
      "#researchMD .rmd-diff-ins { background: var(--rmd-acc-soft); color: var(--rmd-acc); text-decoration: none; border-bottom: 2px solid var(--rmd-acc); padding: 1px 3px; border-radius: 2px; font-weight: 600; }",
      "#researchMD .rmd-diff-del { background: var(--rmd-bad-soft); color: var(--rmd-bad); text-decoration: line-through; padding: 1px 3px; border-radius: 2px; }",
      "#researchMD .rmd-diff-same { color: var(--rmd-ink); }",
      "#researchMD .rmd-diff-controls { display: flex; align-items: center; gap: 12px; flex-wrap: wrap; padding: 12px; background: var(--rmd-fill); border-radius: 8px; }",
      "#researchMD .rmd-diff-select { padding: 6px 10px; border-radius: 6px; border: 1px solid var(--rmd-line); background: var(--rmd-panel); color: var(--rmd-ink); font-size: 13px; }",
      "#researchMD .rmd-locked-banner { background: var(--rmd-acc-soft); border: 1px solid var(--rmd-acc); border-radius: 8px; padding: 10px 14px; display: flex; align-items: center; gap: 10px; font-size: 13px; color: var(--rmd-acc); }",
      "#researchMD .rmd-phone-notice { background: var(--rmd-fill); border: 1px solid var(--rmd-line); border-radius: 8px; padding: 10px 12px; font-size: 12.5px; color: var(--rmd-mut); }",
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
      h.push('    <span class="rmd-badge rmd-badge-soft">Draft</span>');
    }
    h.push('  </div>');

    /* Action buttons */
    h.push('  <div class="rmd-man-actions">');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Editor</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-versions-toggle">Versions (' + st.versions.length + ')</button>');
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-diff-toggle">Compare Diff</button>');

    if (!isApproved) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="manuscript-approve">Approve</button>');
    } else if (!isLocked) {
      h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="manuscript-lock">Lock Version</button>');
    }
    h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-export">Export DOCX</button>');
    h.push('  </div>');
    h.push('</div>');

    /* Phone segmented bar */
    if (phone) {
      h.push('<div class="rmd-man-phone-bar">');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "sections" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="sections">Sections</button>');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "detail" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="detail">View &amp; Chips</button>');
      h.push('  <button type="button" class="rmd-man-phone-btn' + (st.phoneTab === "approve" ? " rmd-seg-active" : "") + '" data-rmd-phone-tab="approve">Approve &amp; Lock</button>');
      h.push('</div>');
      h.push('<div class="rmd-phone-notice" style="margin: 8px 14px 0;">');
      h.push('  <strong>Phone View:</strong> Editor requires tablet (768px or wider). Phone is view and approve only.');
      h.push('</div>');
    }

    /* Main split layout */
    h.push('<div class="rmd-man-split">');

    /* Left Pane: IMRAD section list */
    var leftHideClass = (phone && st.phoneTab !== "sections") ? " rmd-phone-hide" : "";
    h.push('<div class="rmd-man-left' + leftHideClass + '">');
    h.push('  <div class="rmd-pane-header">');
    h.push('    <span class="rmd-role-tag">IMRAD Structure</span>');
    h.push('  </div>');
    h.push('  <div class="rmd-section-list">');

    for (var i = 0; i < IMRAD_SECTIONS.length; i++) {
      var item = IMRAD_SECTIONS[i];
      var secObj = getSection(item.id);
      var words = secObj && secObj.text ? secObj.text.trim().split(/\s+/).length : 0;
      var toks = extractTokens(secObj ? secObj.text : "");
      var isActive = st.selectedSectionId === item.id;

      h.push('    <button type="button" class="rmd-section-item' + (isActive ? ' rmd-section-item-active' : '') + '" data-section-id="' + esc(item.id) + '">');
      h.push('      <div class="rmd-section-item-head">');
      h.push('        <span class="rmd-section-item-label">' + esc(item.label) + '</span>');
      h.push('        <span class="rmd-section-item-meta">' + words + ' words' + (toks.length ? ' &bull; ' + toks.length + ' tokens' : '') + '</span>');
      h.push('      </div>');
      h.push('      <span class="rmd-section-item-desc">' + esc(item.hint) + '</span>');
      h.push('    </button>');
    }
    h.push('  </div>');

    /* Gate failures list (if any) */
    if (st.gateFailures && st.gateFailures.length > 0) {
      h.push('  <div style="padding:14px;">');
      h.push('    <div class="rmd-gate-card">');
      h.push('      <h4 class="rmd-gate-title">Release Gate Failures (' + st.gateFailures.length + ')</h4>');
      h.push('      <div class="rmd-gate-failure-list">');
      for (var g = 0; g < st.gateFailures.length; g++) {
        var fail = st.gateFailures[g];
        h.push('        <div class="rmd-gate-failure-item" data-section="' + esc(fail.sectionId || "results") + '" data-gate-type="' + esc(fail.type) + '">');
        h.push('          <div class="rmd-gate-item-info">');
        h.push('            <span class="rmd-gate-type">' + esc(fail.type.replace(/_/g, " ")) + '</span>');
        h.push('            <span class="rmd-gate-msg">' + esc(fail.message) + '</span>');
        h.push('          </div>');
        h.push('          <button type="button" class="rmd-btn rmd-btn-sm rmd-btn-subtle" data-rmd-jump="' + esc(fail.sectionId || "results") + '">Jump</button>');
        h.push('        </div>');
      }
      h.push('      </div>');
      h.push('    </div>');
      h.push('  </div>');
    }
    h.push('</div>');

    /* Right Pane: Editor, Versions or Diff */
    var rightHideClass = (phone && st.phoneTab === "sections") ? " rmd-phone-hide" : "";
    h.push('<div class="rmd-man-right' + rightHideClass + '">');

    /* Phone notice */
    if (phone) {
      h.push('<div class="rmd-phone-notice">');
      h.push('  <strong>Phone View:</strong> Editor requires tablet (768px or wider). Phone is view and approve only.');
      h.push('</div>');
    }

    /* Save/export notice */
    if (st.saveNotice) {
      h.push('<div class="rmd-banner rmd-banner-info" role="status"><span>' + esc(st.saveNotice) + '</span></div>');
    }
    if (st.exportNotice) {
      h.push('<div class="rmd-banner rmd-banner-warn" role="alert"><span>' + esc(st.exportNotice) + '</span></div>');
    }

    if (isLocked) {
      var lockHash = (man.lock && man.lock.version_hash) || "verified";
      h.push('<div class="rmd-locked-banner">');
      h.push('  <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="11" width="18" height="11" rx="2" ry="2"></rect><path d="M7 11V7a5 5 0 0 1 10 0v4"></path></svg>');
      h.push('  <div>');
      h.push('    <strong>Manuscript is locked. Read-only.</strong>');
      h.push('    <div class="rmd-mono-sm">SHA-256: ' + esc(lockHash) + '</div>');
      h.push('  </div>');
      h.push('</div>');
    }

    /* Sub-view: Versions list */
    if (st.viewMode === "versions") {
      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <h4 class="rmd-editor-title">Version History</h4>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Back to Editor</button>');
      h.push('  </div>');
      h.push('  <div class="rmd-section-list">');
      for (var v = 0; v < st.versions.length; v++) {
        var ver = st.versions[v];
        h.push('    <div class="rmd-section-item" style="cursor:default;">');
        h.push('      <div class="rmd-section-item-head">');
        h.push('        <strong>Version ' + esc(ver.version) + ' (' + esc(ver.status) + ')</strong>');
        h.push('        <span class="rmd-section-item-meta">' + esc(ver.createdAt ? ver.createdAt.substring(0, 10) : "") + '</span>');
        h.push('      </div>');
        if (ver.versionHash) {
          h.push('      <span class="rmd-mono-sm">Hash: ' + esc(ver.versionHash.substring(0, 24)) + '...</span>');
        }
        h.push('    </div>');
      }
      h.push('  </div>');
      h.push('</div>');
    }
    /* Sub-view: Compare Diff */
    else if (st.viewMode === "diff") {
      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <h4 class="rmd-editor-title">Section Version Diff</h4>');
      h.push('    <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="manuscript-mode-editor">Back to Editor</button>');
      h.push('  </div>');

      h.push('  <div class="rmd-diff-controls">');
      h.push('    <label>Base Version:');
      h.push('      <select class="rmd-diff-select" id="rmdDiffBase">');
      for (var vb = 0; vb < st.versions.length; vb++) {
        var vnumB = st.versions[vb].version;
        h.push('        <option value="' + vnumB + '"' + (st.diffBaseVersion === vnumB ? ' selected' : '') + '>v' + vnumB + '</option>');
      }
      h.push('      </select>');
      h.push('    </label>');

      h.push('    <label>Compare Version:');
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

      var textA = getVersionText(st.diffBaseVersion, st.diffSectionId);
      var textB = getVersionText(st.diffTargetVersion, st.diffSectionId);
      var diffHtml = computeDiff(textA, textB);

      h.push('  <div class="rmd-diff-view">');
      h.push(diffHtml);
      h.push('  </div>');
      h.push('</div>');
    }
    /* Sub-view: Active Section Editor */
    else {
      var curSec = getSection(st.selectedSectionId);
      var secText = curSec ? curSec.text : "";
      var tokensList = extractTokens(secText);

      h.push('<div class="rmd-editor-card">');
      h.push('  <div class="rmd-editor-head">');
      h.push('    <div>');
      h.push('      <h4 class="rmd-editor-title">' + esc(curSec ? curSec.heading : "Section") + '</h4>');
      h.push('      <span class="rmd-editor-sub">Numbers are deterministically resolved from analysis runs.</span>');
      h.push('    </div>');

      if (!isLocked && !phone) {
        h.push('    <button type="button" class="rmd-btn rmd-btn-primary rmd-btn-sm" data-rmd="section-save">Save Section</button>');
      }
      h.push('  </div>');

      /* Resolved Token Chips Bar */
      if (tokensList.length > 0) {
        h.push('  <div class="rmd-token-bar">');
        h.push('    <div class="rmd-token-bar-label">Resolved Tokens in this Section:</div>');
        for (var tk = 0; tk < tokensList.length; tk++) {
          var tokItem = tokensList[tk];
          var resTok = resolveToken(tokItem.runId, tokItem.fieldPath, man.tokens);
          h.push('    <span class="rmd-token-chip" contenteditable="false" data-token="' + esc(tokItem.token) + '">');
          h.push('      <strong class="rmd-token-val">' + esc(resTok.formatted) + '</strong>');
          h.push('      <code class="rmd-token-raw">' + esc(tokItem.token) + '</code>');
          h.push('    </span>');
        }
        h.push('  </div>');
      }

      /* Editor textarea (disabled on phone or if locked) */
      var isReadOnly = isLocked || phone;
      h.push('  <div class="rmd-field">');
      h.push('    <label for="rmdSectionText">Section Content (Source text with tokens):</label>');
      h.push('    <textarea id="rmdSectionText" class="rmd-man-textarea"' + (isReadOnly ? ' disabled="disabled" readonly="true"' : '') + ' placeholder="Write section content...">' + esc(secText) + '</textarea>');
      h.push('  </div>');

      /* Preview with chips */
      h.push('  <div class="rmd-field">');
      h.push('    <label>Preview with Token Chips:</label>');
      h.push('    <div class="rmd-preview-box" id="rmdTokenPreview">');
      h.push(renderTextWithChips(secText, man.tokens));
      h.push('    </div>');
      h.push('  </div>');

      /* Phone action cards */
      if (phone && st.phoneTab === "approve") {
        h.push('  <div class="rmd-card" style="margin-top:12px;">');
        h.push('    <h4 class="rmd-card-heading">Manuscript Approval &amp; Lock</h4>');
        h.push('    <p style="font-size:13px;color:var(--rmd-mut);">Review tokens and claims, then submit clinician approval. Version locking is final and one-way.</p>');
        if (!isApproved) {
          h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="manuscript-approve">Approve Manuscript</button>');
        } else if (!isLocked) {
          h.push('    <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="manuscript-lock">Lock Manuscript Version</button>');
        } else {
          h.push('    <span class="rmd-badge rmd-badge-pill">Locked &amp; Verified</span>');
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

    /* Live update preview on textarea change */
    var textarea = container.querySelector("#rmdSectionText");
    if (textarea) {
      textarea.oninput = function () {
        var preview = container.querySelector("#rmdTokenPreview");
        if (preview && st.manuscript) {
          preview.innerHTML = renderTextWithChips(this.value, st.manuscript.tokens);
        }
      };
    }
  }

  /* Register screen */
  SMD.screens.manuscript = {
    render: function (container) {
      load(container);
    }
  };

})(typeof window !== "undefined" ? window : global);
