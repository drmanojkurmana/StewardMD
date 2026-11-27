/* StewardMD - ResearchMD reporting checklist screen
 * (window.SMD_RESEARCH.screens.checklist). ES5 only, buildless. Phase 5B.1.
 * Tablet-first. The right pane is the shared manuscript editor
 * (research-doc-editor.js), prefilled from the saved manuscript, the thesis
 * draft, or empty checklist headings. Item status follows the document text
 * on iPad and iPhone; the researcher still approves and uploads the pack.
 *
 * ORCHESTRATOR WIRING:
 *
 * 1. index.html loads research-doc-editor.js before this screen:
 *
 *      <script src="/research-checklist.js?v=rmd4" defer></script>
 *      <script src="/research-doc-editor.js?v=rmddoc1" defer></script>
 *      <script src="/research-submission.js?v=rmd3" defer></script>
 *      <script src="/research-screen-checklist.js?v=rmd11" defer></script>
 *
 * 2. research.js, renderShell() tabs array, has ["checklist", "Checklist"].
 *
 * The screen fills a guideline from the project snapshot. It does not send
 * a manuscript to a journal. The researcher uploads the pack.
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

  var st = {
    projectId: null,
    loading: false,
    error: "",
    errObj: null,
    guidelines: [],
    guidelineId: "",
    checklist: null,
    snapshot: null,
    manual: {},
    filled: null,
    approved: false,
    approving: false,
    approveError: "",
    csv: "",
    manuscript: null,
    manuscriptTitle: "",
    doc: null,
    docOutline: null,
    itemSub: null,
    docEditor: null,
    seq: 0
  };
  var APPROVAL_KEY = "checklist_approval";
  var manuscriptMissing = {};
  var lastContainer = null;
  var mqlBound = false;

  function engine() { return G.SMD_RESEARCH_CHECKLIST; }

  function closeDocEditor() {
    if (st.docEditor && st.docEditor.destroy) {
      try { st.docEditor.destroy(); } catch (e) {}
    }
    st.docEditor = null;
  }

  function isPhone() {
    try {
      if (G.matchMedia) return G.matchMedia("(max-width: 767px)").matches;
    } catch (e) {}
    return (G.innerWidth || 1024) < 768;
  }

  function activeProject() {
    try {
      if (SMD.store && SMD.store.getActiveProject) return SMD.store.getActiveProject();
    } catch (e) {}
    return null;
  }

  function api(method, path, body) {
    return SMD.api.request(method, path, body);
  }

  function statusLabel(status) {
    if (status === "auto") return "Filled";
    if (status === "partial") return "Partial";
    if (status === "manual") return "Manual";
    return "Missing";
  }

  function unwrapChecklist(data) {
    if (data && data.checklist && data.checklist.sections) return data.checklist;
    return data || null;
  }

  function unwrapSnapshot(data) {
    if (data && data.snapshot && typeof data.snapshot === "object") return data.snapshot;
    return data || {};
  }

  function approvalRecord(entries) {
    if (!entries || !entries[APPROVAL_KEY]) return null;
    var raw = entries[APPROVAL_KEY];
    if (typeof raw === "object" && raw) return raw;
    try {
      var parsed = JSON.parse(String(raw));
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch (e) {
      return String(raw) === "approved" ? { approved: true } : null;
    }
  }

  function serverProjectIdForChecklist(proj) {
    return (proj && proj.serverId && !proj.tutorial && !proj.practice) ? proj.serverId : "";
  }

  function saveManualEntry(apiPid, gid, num, text) {
    return api("PUT", "/v1/projects/" + encodeURIComponent(apiPid) + "/checklist-manual/" + encodeURIComponent(gid), {
      num: String(num),
      text: String(text)
    });
  }

  function compute() {
    var src = st.snapshot || {};
    var snap = {};
    var key;
    for (key in src) {
      if (Object.prototype.hasOwnProperty.call(src, key)) snap[key] = src[key];
    }
    snap.manual = {};
    for (key in st.manual) {
      if (Object.prototype.hasOwnProperty.call(st.manual, key)) snap.manual[key] = st.manual[key];
    }
    st.filled = engine().fill(st.checklist, snap);
    if (SMD_RESEARCH_DOC && SMD_RESEARCH_DOC.outlineFor) {
      st.docOutline = SMD_RESEARCH_DOC.outlineFor(st.checklist);
      st.itemSub = st.docOutline.itemSub;
    } else {
      st.docOutline = null;
      st.itemSub = null;
    }
    var items = (st.filled && st.filled.items) || [];
    var i, it;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      it._baseStatus = it.status;
      it._baseFilled = it.filled;
      it._baseEvidence = it.evidence;
      it._doc = 0;
    }
  }

  function failLoad(e) {
    st.loading = false;
    st.error = (e && e.message) ? String(e.message) : "Could not load the checklist.";
    st.errObj = e || null;
    if (lastContainer) paint(lastContainer);
  }

  function nonEmptySections(secs) {
    var out = [], i, s, has;
    if (!secs || !secs.length) return out;
    for (i = 0; i < secs.length; i++) {
      s = secs[i];
      if (!s) continue;
      has = (typeof s.text === "string" && String(s.text).replace(/\s+/g, "")) ||
            (s.paragraphs && s.paragraphs.length);
      if (has) out.push(s);
    }
    return out;
  }

  function loadGuideline(pid, gid, seq) {
    var base;
    var proj = activeProject();
    var apiPid = (proj && (proj.serverId || proj.id)) || pid;
    st.guidelineId = gid;
    st.loading = true;
    st.error = "";
    st.errObj = null;
    st.approved = false;
    st.approving = false;
    st.approveError = "";
    st.csv = "";
    st.filled = null;
    st.manuscript = null;
    st.manuscriptTitle = "";
    st.doc = null;
    st.docOutline = null;
    st.itemSub = null;
    closeDocEditor();
    if (lastContainer) paint(lastContainer);
    base = "/v1/projects/" + encodeURIComponent(pid);
    return Promise.all([
      api("GET", "/v1/checklists/" + encodeURIComponent(gid)),
      api("GET", base + "/checklist-snapshot"),
      api("GET", base + "/checklist-manual/" + encodeURIComponent(gid))
    ]).then(function (parts) {
      if (seq !== st.seq) return null;
      st.checklist = unwrapChecklist(parts[0]);
      st.snapshot = unwrapSnapshot(parts[1]);
      st.manual = (parts[2] && parts[2].entries) ? parts[2].entries : {};
      st.approved = !!approvalRecord(st.manual);
      st.approveError = "";
      /* A project with no manuscript yet is a normal state, not an error.
       * Skip the request when the snapshot already carries the sections or a
       * previous 404 already established there is nothing saved. */
      var snapHasMan = nonEmptySections(st.snapshot && st.snapshot.manuscript && st.snapshot.manuscript.sections).length > 0;
      if (snapHasMan || manuscriptMissing[apiPid]) return null;
      return api("GET", "/v1/projects/" + encodeURIComponent(apiPid) + "/manuscript").then(function (m) {
        return m;
      }, function (err) {
        if (err && (err.status === 404 || err.code === "manuscript_not_found")) {
          manuscriptMissing[apiPid] = true;
          return null;
        }
        throw err;
      });
    }).then(function (manPart) {
      var manObj, snapSecs, manSecs, chosenSecs, rawTitle;
      if (seq !== st.seq) return;
      manObj = (manPart && manPart.manuscript) || null;
      st.manuscript = manObj;
      rawTitle = (manObj && manObj.title) ||
        (st.snapshot && st.snapshot.manuscript && st.snapshot.manuscript.title) ||
        (st.snapshot && st.snapshot.title) ||
        (st.snapshot && st.snapshot.projectTitle) ||
        (proj && proj.title ? String(proj.title).replace(/^\[Tutorial\]\s*/i, "") : "");
      st.manuscriptTitle = rawTitle ? String(rawTitle).replace(/^\s+|\s+$/g, "") : "";
      snapSecs = nonEmptySections(st.snapshot && st.snapshot.manuscript && st.snapshot.manuscript.sections);
      manSecs = nonEmptySections(manObj && manObj.sections);
      chosenSecs = snapSecs.length ? snapSecs : manSecs;
      if (chosenSecs.length || st.manuscriptTitle) {
        st.snapshot.manuscript = {
          title: st.manuscriptTitle,
          sections: chosenSecs
        };
      }
      st.loading = false;
      try {
        compute();
      } catch (err) {
        st.filled = null;
        st.error = (err && err.message) ? String(err.message) : "Could not fill the checklist.";
        st.errObj = err || null;
      }
      if (lastContainer) paint(lastContainer);
      bindBreakpoint();
    }).catch(function (e) {
      if (seq !== st.seq) return;
      failLoad(e);
    });
  }

  function tutorialChecklistId(proj) {
    var tut = SMD.tutorial;
    var key, ex;
    if (!proj || !proj.tutorial || !tut || !tut.exampleByKey) return "";
    key = proj.tutorialKey || (tut.keyForStudyType ? tut.keyForStudyType(proj.studyType) : "");
    ex = tut.exampleByKey(key);
    return (ex && ex.checklistId) || "";
  }

  function loadAll(pid) {
    var seq = ++st.seq;
    var proj = activeProject();
    st.projectId = pid;
    st.loading = true;
    st.error = "";
    st.errObj = null;
    st.checklist = null;
    st.filled = null;
    st.approved = false;
    st.approving = false;
    st.approveError = "";
    st.csv = "";
    st.manuscript = null;
    st.manuscriptTitle = "";
    st.doc = null;
    st.docOutline = null;
    st.itemSub = null;
    closeDocEditor();
    if (lastContainer) paint(lastContainer);
    api("GET", "/v1/checklists").then(function (list) {
      var rows, id, pref, tutCid;
      if (seq !== st.seq) return;
      rows = (list && list.checklists) || [];
      st.guidelines = rows;
      pref = SMD.preferredChecklist ? (SMD.preferredChecklist(pid) || (proj && proj.serverId ? SMD.preferredChecklist(proj.serverId) : "")) : "";
      tutCid = tutorialChecklistId(proj);
      if (engine() && typeof engine().chooseChecklistId === "function") {
        id = engine().chooseChecklistId(rows, proj, pref, tutCid, SMD.checklistFor);
      } else {
        id = pref || tutCid || (SMD.checklistFor && proj ? SMD.checklistFor(proj, "publication") : "") || (rows[0] && rows[0].id) || "";
      }
      if (!id) {
        st.loading = false;
        st.error = "No reporting guidelines are available.";
        if (lastContainer) paint(lastContainer);
        return;
      }
      loadGuideline(pid, id, seq);
    }).catch(function (e) {
      if (seq !== st.seq) return;
      failLoad(e);
    });
  }

  function exportCsv() {
    if (!st.filled || !engine() || typeof engine().toCsv !== "function") return;
    st.csv = engine().toCsv(st.filled);
    if (lastContainer) paint(lastContainer);
    var proj = activeProject();
    var name = SMD.p2.fileSlug(proj && proj.title, "reporting-checklist") + "-checklist.csv";
    SMD.p2.downloadText(name, st.csv, "text/csv").then(function () {
      SMD.p2.flashNotice(lastContainer, "Your file is ready to save or share.", "info");
    }, function (err) {
      SMD.p2.flashNotice(lastContainer, SMD.p2.friendlyError(err).message, "error");
    });
  }

  function approvalPayload() {
    return JSON.stringify({
      approved: true,
      guidelineId: st.guidelineId,
      approvedAt: Date.now()
    });
  }

  /* Approval is a server fact, not a session flag: the Submit screen reads the
   * checklist from the project snapshot. Persist the document-filled items as
   * manual entries first, then the approval marker. A failure keeps the button
   * available instead of claiming an approval the server never stored. */
  function persistApproval(container) {
    if (st.approved || st.approving || remainingRequiredCount() !== 0) return;
    var target = lastContainer || container;
    var proj = activeProject();
    var apiPid = serverProjectIdForChecklist(proj);
    var gid = st.guidelineId;
    var items = (st.filled && st.filled.items) || [];
    var rows = [], i, it, text;
    st.approveError = "";
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!isItemFilled(it)) continue;
      /* Save text written in this screen's document editor. Server-backed auto
       * items and manual entries already loaded from the server need no write. */
      if (!it._doc && (it.status !== "manual" || st.manual[String(it.num)] != null)) continue;
      text = String(it.filled || "").trim();
      if (!text) continue;
      rows.push({ num: it.num, text: text.length > 8000 ? text.slice(0, 8000) : text });
    }
    if (!apiPid || !SMD.api || !gid) {
      st.approved = true;
      st.manual[APPROVAL_KEY] = approvalPayload();
      try { compute(); } catch (e) {}
      paint(target);
      return;
    }
    st.approving = true;
    paint(target);
    var chain = Promise.resolve();
    for (i = 0; i < rows.length; i++) {
      (function (row) {
        chain = chain.then(function () { return saveManualEntry(apiPid, gid, row.num, row.text); });
      })(rows[i]);
    }
    var marker = approvalPayload();
    chain.then(function () {
      return saveManualEntry(apiPid, gid, APPROVAL_KEY, marker);
    }).then(function () {
      st.approving = false;
      st.approved = true;
      st.approveError = "";
      for (i = 0; i < rows.length; i++) st.manual[String(rows[i].num)] = rows[i].text;
      st.manual[APPROVAL_KEY] = marker;
      try { compute(); } catch (e) {}
      paint(target);
    }, function (err) {
      st.approving = false;
      var msg = err && (err.message || (err.error && err.error.message));
      st.approveError = msg
        ? String(msg).replace(/[\u2014\u2013]/g, "-")
        : "Could not save the approval. Check the connection and try again.";
      paint(target);
    });
  }

  function injectCss() {
    var s;
    if (!D || D.getElementById("rmdChecklistCss")) return;
    s = D.createElement("style");
    s.id = "rmdChecklistCss";
    s.textContent = [
      "#researchMD .rmd-checklist-screen { color-scheme: light; display: flex; flex-direction: column; width: 100%; max-width: 100%; min-width: 0; color: var(--rmd-ink, #e3ecea); font: 14.5px/1.45 var(--rmd-f, -apple-system, BlinkMacSystemFont, system-ui, sans-serif); }",
      "body.dark #researchMD .rmd-checklist-screen, body.v3-dark #researchMD .rmd-checklist-screen { color-scheme: dark; }",
      "#researchMD .rmd-checklist-screen * { box-sizing: border-box; }",
      "#researchMD .rmd-checklist-wrap { width: 100%; max-width: 1100px; margin: 0 auto; padding: 16px 18px 40px; min-width: 0; }",
      "#researchMD .rmd-checklist-bar { display: flex; flex-wrap: wrap; align-items: flex-end; gap: 8px 12px; margin-bottom: 14px; min-width: 0; }",
      "#researchMD .rmd-checklist-title { margin: 0; font: 600 16px/1.3 var(--rmd-f, system-ui, sans-serif); flex: 1 1 180px; min-width: 0; }",
      "#researchMD .rmd-checklist-project { font: 500 12px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #93a4a8); padding: 4px 8px; border: 1px solid var(--rmd-line, #e5ddce); border-radius: 999px; max-width: 100%; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-field { display: flex; flex-direction: column; gap: 4px; flex: 1 1 200px; min-width: 0; }",
      "#researchMD .rmd-checklist-label { font: 600 12px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-screen select, #researchMD .rmd-checklist-screen textarea { font: inherit; font-size: max(1rem, 1em); width: 100%; min-width: 0; color: var(--rmd-ink, #e3ecea); background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); border-radius: 8px; }",
      "#researchMD .rmd-checklist-screen select { min-height: 48px; padding: 8px 10px; }",
      "#researchMD .rmd-checklist-screen textarea { min-height: 96px; padding: 10px 12px; resize: vertical; }",
      "#researchMD .rmd-checklist-actions { display: flex; flex-wrap: wrap; gap: 8px; }",
      "#researchMD .rmd-checklist-btn { appearance: none; min-height: 48px; padding: 8px 14px; border-radius: 8px; border: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-panel, #fffdf9); color: var(--rmd-ink, #e3ecea); font: 600 14px/1.2 var(--rmd-f, system-ui, sans-serif); text-decoration: none; display: inline-flex; align-items: center; justify-content: center; touch-action: manipulation; }",
      "#researchMD .rmd-checklist-btn-primary { background: var(--rmd-acc-grad, #1b41bf); border-color: transparent; color: #fff; box-shadow: var(--rmd-lift, none); }",
      "#researchMD .rmd-checklist-btn[disabled], #researchMD .rmd-checklist-btn-primary[disabled] { background: var(--rmd-panel, #fffdf9); border: 1px dashed var(--rmd-line, #c6d0cf); color: var(--rmd-mut, #485458); box-shadow: none; cursor: not-allowed; opacity: 1; }",
      "#researchMD .rmd-checklist-screen :focus-visible { outline: 2px solid var(--rmd-acc, #1b41bf); outline-offset: 2px; }",
      "#researchMD .rmd-checklist-counts { margin: 0 0 12px; font: 600 13px/1.4 var(--rmd-f, system-ui, sans-serif); }",
      "#researchMD .rmd-checklist-note, #researchMD .rmd-checklist-approved { margin: 0 0 12px; color: var(--rmd-mut, #93a4a8); font-size: 13px; }",
      "#researchMD .rmd-checklist-approved { color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-checklist-banner { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--rmd-bad, #ff7b6e); background: var(--rmd-bad-soft, #3a1714); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-checklist-layout { display: grid; grid-template-columns: minmax(0, 0.9fr) minmax(0, 1.1fr); gap: 16px; width: 100%; min-width: 0; align-items: start; }",
      "#researchMD .rmd-checklist-items, #researchMD .rmd-checklist-doc { min-width: 0; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-section { margin: 0 0 16px; }",
      "#researchMD .rmd-checklist-section h3 { margin: 0 0 8px; font: 600 13px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-item { border: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-panel, #fffdf9); border-radius: 10px; padding: 12px; margin: 0 0 10px; min-width: 0; cursor: pointer; touch-action: manipulation; }",
      "#researchMD .rmd-checklist-item-head { display: flex; flex-wrap: wrap; align-items: baseline; gap: 8px; margin-bottom: 6px; }",
      "#researchMD .rmd-checklist-num { font: 600 12px/1 var(--rmd-mono, ui-monospace, monospace); color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-item h4 { margin: 0; font: 600 15px/1.3 var(--rmd-f, system-ui, sans-serif); flex: 1 1 140px; min-width: 0; }",
      "#researchMD .rmd-checklist-badge { font: 600 12px/1 var(--rmd-f, system-ui, sans-serif); padding: 4px 8px; border-radius: 999px; border: 1px solid var(--rmd-line, #e5ddce); }",
      "#researchMD .rmd-checklist-badge-auto { background: var(--rmd-acc-soft, #e4e9f8); color: var(--rmd-acc, #1b41bf); border-color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-checklist-badge-partial { background: var(--rmd-warn-soft, #352812); color: var(--rmd-warn, #f0b454); border-color: var(--rmd-warn, #f0b454); }",
      "#researchMD .rmd-checklist-badge-manual { background: var(--rmd-fill, rgba(118,118,128,0.26)); color: var(--rmd-ink, #e3ecea); }",
      "#researchMD .rmd-checklist-badge-missing { background: var(--rmd-bad-soft, #3a1714); color: var(--rmd-bad, #ff7b6e); border-color: var(--rmd-bad, #ff7b6e); }",
      "#researchMD .rmd-checklist-req, #researchMD .rmd-checklist-filled, #researchMD .rmd-checklist-pointer { margin: 0 0 8px; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-req { color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-evidence { margin: 0 0 8px; padding-left: 18px; color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-evidence li { margin: 0 0 4px; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-jump-btn { margin-top: 2px; min-height: 44px; }",
      "@media (hover: hover) and (pointer: fine) {",
      "  #researchMD .rmd-checklist-item:hover { border-color: var(--rmd-acc, #1b41bf); }",
      "}",
      "#researchMD .rmd-checklist-empty { padding: 28px 8px; }",
      "#researchMD .rmd-checklist-empty h2 { margin: 0 0 8px; font: 600 18px/1.3 var(--rmd-f, system-ui, sans-serif); }",
      "#researchMD .rmd-checklist-empty p { margin: 0 0 14px; color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-credit { margin: 16px 0 0; padding: 12px 0 0; border-top: 1px solid var(--rmd-line, #e5ddce); color: var(--rmd-mut, #93a4a8); font-size: 12.5px; line-height: 1.5; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-credit-line { margin: 0 0 6px; }",
      "#researchMD .rmd-checklist-credit-key { font-weight: 600; }",
      "#researchMD .rmd-checklist-sr { position: absolute; width: 1px; height: 1px; padding: 0; margin: -1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; border: 0; }",
      "@media (max-width: 767px) {",
      "  #researchMD .rmd-checklist-wrap { padding: 12px 14px 32px; }",
      "  #researchMD .rmd-checklist-layout { grid-template-columns: minmax(0, 1fr); }",
      "}",
      "@media (prefers-reduced-motion: reduce) {",
      "  #researchMD .rmd-checklist-screen * { transition: none !important; }",
      "}"
    ].join("\n");
    D.head.appendChild(s);
  }

  function groupItems(items) {
    var groups = [];
    var map = {};
    var i, it, g;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (!map[it.section]) {
        g = { title: it.section, items: [] };
        map[it.section] = g;
        groups.push(g);
      }
      map[it.section].items.push(it);
    }
    return groups;
  }

  function previewText(text, max) {
    var t = String(text == null ? "" : text).replace(/\s+/g, " ").replace(/^\s+|\s+$/g, "");
    if (t.length > max) t = t.slice(0, max - 1).replace(/\s+\S*$/, "") + ".";
    return t;
  }

  function itemHtml(it) {
    var h = [];
    var label = statusLabel(it.status);
    var lines, i, shown, n, shownText;
    shownText = it.filled ? previewText(it.filled, 280) : "Not recorded in the project.";
    h.push('<article class="rmd-checklist-item" data-rmd-item="' + esc(it.num) + '" data-rmd-field="' + esc(it.projectField) + '">');
    h.push('<div class="rmd-checklist-item-head">');
    h.push('<span class="rmd-checklist-num">' + esc(it.num) + '</span>');
    h.push('<h4>' + esc(it.topic || "Item") + '</h4>');
    h.push('<span class="rmd-checklist-badge rmd-checklist-badge-' + esc(it.status) + '" data-rmd-status="' + esc(it.status) + '">' + esc(label) + '</span>');
    h.push('</div>');
    h.push('<p class="rmd-checklist-req">' + esc(it.text) + '</p>');
    h.push('<p class="rmd-checklist-filled" data-rmd-filled>' + esc(shownText) + '</p>');
    lines = it.evidence || [];
    shown = 0;
    for (i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i] !== it.filled) shown++;
    }
    if (shown) {
      h.push('<ul class="rmd-checklist-evidence" data-rmd-evidence>');
      for (i = 0; i < lines.length; i++) {
        if (lines[i] && lines[i] !== it.filled) h.push('<li>' + esc(previewText(lines[i], 220)) + '</li>');
      }
      h.push('</ul>');
    }
    if (it.pointer && it.pointer.section) {
      n = (it.pointer.paragraph || 0) + 1;
      h.push('<p class="rmd-checklist-pointer">Reported in ' + esc(it.pointer.section) + ', paragraph ' + n + '.</p>');
    }
    h.push('<button type="button" class="rmd-checklist-btn rmd-checklist-jump-btn" data-rmd-jump="' + esc(it.num) + '">Edit in document</button>');
    h.push('</article>');
    return h.join("");
  }

  function isItemFilled(it) {
    if (!it) return false;
    if (it.status === "auto") return true;
    if (it.status === "manual" && it.filled && String(it.filled).replace(/\s+/g, "")) return true;
    return false;
  }

  function remainingRequiredCount() {
    var items = (st.filled && st.filled.items) || [];
    var rem = 0, i;
    if (!items.length) return -1;
    for (i = 0; i < items.length; i++) {
      if (!isItemFilled(items[i])) rem++;
    }
    return rem;
  }

  function approveReasonText() {
    var rem = remainingRequiredCount();
    if (rem < 0) return "Checklist items are still loading.";
    if (rem === 0) return "";
    return "Fill the remaining " + rem + " checklist " + (rem === 1 ? "item" : "items") + " to approve.";
  }

  function paintEmpty(container) {
    container.innerHTML = '<div class="rmd-checklist-screen"><div class="rmd-checklist-wrap"><div class="rmd-checklist-empty"><h2>No project open</h2><p>Open a project to fill a reporting checklist.</p><button type="button" class="rmd-checklist-btn rmd-checklist-btn-primary" data-rmd-to-projects>Open projects</button></div></div></div>';
    var btn = container.querySelector("[data-rmd-to-projects]");
    if (btn) btn.onclick = function () { if (SMD.navigate) SMD.navigate("projects"); };
  }

  function paint(container) {
    var phone = isPhone();
    var proj = activeProject();
    var h = [];
    var counts, groups, i, items;
    if (!container) return;
    if (st.docEditor && st.docEditor.getDoc) {
      try { st.doc = st.docEditor.getDoc(); } catch (e) {}
    }
    injectCss();
    h.push('<div class="rmd-checklist-screen">');
    h.push('<div class="rmd-checklist-wrap">');
    h.push('<div class="rmd-checklist-bar">');
    h.push('<h2 class="rmd-checklist-title">Reporting checklist</h2>');
    if (proj && proj.title) h.push('<span class="rmd-checklist-project">' + esc(proj.title) + '</span>');
    if (st.guidelines.length) {
      h.push('<div class="rmd-checklist-field">');
      h.push('<label class="rmd-checklist-label" for="rmdChecklistGuide">Guideline</label>');
      h.push('<select id="rmdChecklistGuide" name="guideline" data-rmd-guideline>');
      for (i = 0; i < st.guidelines.length; i++) {
        h.push('<option value="' + esc(st.guidelines[i].id) + '"' + (st.guidelines[i].id === st.guidelineId ? ' selected' : '') + '>' + esc(st.guidelines[i].name || st.guidelines[i].id) + '</option>');
      }
      h.push('</select></div>');
    }
    h.push('<div class="rmd-checklist-actions">');
    h.push('<button type="button" class="rmd-checklist-btn" data-rmd-export="csv">Download CSV</button>');
    var remCount = remainingRequiredCount();
    var canApprove = !st.approved && !st.approving && remCount === 0;
    var reasonMsg = st.approved ? "" : approveReasonText();
    if (st.approved) {
      h.push('<button type="button" class="rmd-checklist-btn" data-rmd-approve disabled>Approved</button>');
    } else if (st.approving) {
      h.push('<button type="button" class="rmd-checklist-btn rmd-checklist-btn-primary" data-rmd-approve disabled aria-busy="true">Saving approval...</button>');
    } else {
      h.push('<button type="button" class="rmd-checklist-btn rmd-checklist-btn-primary" data-rmd-approve' + (canApprove ? '' : ' disabled aria-describedby="rmdChecklistApproveReason"') + '>Approve</button>');
    }
    h.push('</div></div>');
    if (reasonMsg) h.push('<p id="rmdChecklistApproveReason" class="rmd-checklist-note rmd-checklist-approve-reason" data-rmd-approve-reason>' + esc(reasonMsg) + '</p>');
    else h.push('<p id="rmdChecklistApproveReason" class="rmd-checklist-note rmd-checklist-approve-reason" data-rmd-approve-reason hidden></p>');
    if (phone) h.push('<p class="rmd-checklist-note">Tap an item to jump to that part of the document.</p>');
    if (st.approved) {
      var approvedCopy = serverProjectIdForChecklist(proj)
        ? "Approved and saved to your project. You still upload the pack yourself."
        : "Approved on this device. You still upload the pack yourself.";
      h.push('<p id="rmdChecklistApproved" class="rmd-checklist-approved">' + esc(approvedCopy) + '</p>');
    }
    if (st.approveError) {
      h.push('<div class="rmd-checklist-banner" role="alert"><strong>' + esc(st.approveError) + '</strong></div>');
    }
    if (st.error) {
      if (SMD.p2 && SMD.p2.errHtml) {
        h.push(SMD.p2.errHtml(st.errObj || { message: st.error }, "retry"));
      } else {
        h.push('<div class="rmd-checklist-banner" role="alert"><strong>' + esc(st.error) + '</strong><button type="button" class="rmd-checklist-btn" data-rmd="retry">Retry</button></div>');
      }
    }
    if (st.loading && !st.filled) {
      h.push('<p class="rmd-checklist-note">Loading the checklist.</p>');
    }
    if (st.filled) {
      counts = st.filled.counts || {};
      h.push('<p class="rmd-checklist-counts" data-rmd-counts aria-live="polite">Filled ' + (counts.auto || 0) + '. Partial ' + (counts.partial || 0) + '. Manual ' + (counts.manual || 0) + '. Missing ' + (counts.missing || 0) + '.</p>');
      h.push('<div class="rmd-checklist-layout">');
      h.push('<div class="rmd-checklist-items">');
      items = st.filled.items || [];
      groups = groupItems(items);
      for (i = 0; i < groups.length; i++) {
        var g = groups[i];
        var j;
        h.push('<section class="rmd-checklist-section" data-rmd-section="' + esc(g.title) + '">');
        h.push('<h3>' + esc(g.title || "Section") + '</h3>');
        for (j = 0; j < g.items.length; j++) h.push(itemHtml(g.items[j]));
        h.push('</section>');
      }
      h.push('</div>');
      h.push('<div class="rmd-checklist-doc" id="rmdChecklistDoc"></div>');
      h.push('</div>');
    }
    if (st.filled && (st.filled.source || st.filled.licence)) {
      h.push('<footer class="rmd-checklist-credit" id="rmdChecklistCredit">');
      if (st.filled.source) h.push('<p class="rmd-checklist-credit-line"><span class="rmd-checklist-credit-key">Source</span> ' + esc(st.filled.source) + '</p>');
      if (st.filled.licence) h.push('<p class="rmd-checklist-credit-line"><span class="rmd-checklist-credit-key">Licence</span> ' + esc(st.filled.licence) + '</p>');
      h.push('</footer>');
    }
    h.push('<pre id="rmdChecklistCsv" class="rmd-checklist-sr"></pre>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    var pre = container.querySelector("#rmdChecklistCsv");
    if (pre) pre.textContent = st.csv || "";
    bind(container);
    if (st.filled) mountDocEditor(container);
  }

  function isItemControl(el) {
    var t = el && el.tagName ? el.tagName.toUpperCase() : "";
    return t === "BUTTON" || t === "A" || t === "INPUT" || t === "TEXTAREA" || t === "SELECT" || t === "LABEL";
  }

  function jumpToItem(num) {
    var sid = st.itemSub && st.itemSub[num];
    if (sid && st.docEditor && st.docEditor.scrollToSub) {
      st.docEditor.scrollToSub(sid);
      return true;
    }
    return false;
  }

  function bindItemJumps(container) {
    var cards = container.querySelectorAll("[data-rmd-item]");
    var jumps = container.querySelectorAll("[data-rmd-jump]");
    var i;
    for (i = 0; i < cards.length; i++) {
      cards[i].onclick = function (ev) {
        var t = ev && ev.target;
        if (isItemControl(t)) return;
        if (t && t.closest && t.closest("button,a,input,textarea,select,label")) return;
        jumpToItem(this.getAttribute("data-rmd-item"));
      };
    }
    for (i = 0; i < jumps.length; i++) {
      jumps[i].onclick = function (ev) {
        if (ev && ev.stopPropagation) ev.stopPropagation();
        jumpToItem(this.getAttribute("data-rmd-jump"));
      };
    }
  }

  function bind(container) {
    var guide = container.querySelector("#rmdChecklistGuide");
    var exp = container.querySelector("[data-rmd-export]");
    var approve = container.querySelector("[data-rmd-approve]");
    var retry = container.querySelector('[data-rmd="retry"]');
    if (guide) {
      guide.onchange = function () {
        var seq = ++st.seq;
        loadGuideline(st.projectId, guide.value, seq);
      };
    }
    if (exp) exp.onclick = function () { exportCsv(); };
    if (approve && !st.approved && !st.approving) {
      approve.onclick = function () {
        if (remainingRequiredCount() !== 0) return;
        persistApproval(container);
      };
    }
    if (retry) {
      retry.onclick = function () {
        if (st.projectId) loadAll(st.projectId);
      };
    }
    bindItemJumps(container);
  }

  function mountDocEditor(container) {
    var host = container.querySelector("#rmdChecklistDoc");
    if (!host) return;
    if (!SMD_RESEARCH_DOC || typeof SMD_RESEARCH_DOC.render !== "function" || !st.docOutline) {
      host.innerHTML = '<div class="rmd-checklist-banner" role="alert"><strong>The document editor did not load.</strong><span>Update the app and reopen ResearchMD.</span></div>';
      return;
    }
    var proj = activeProject();
    var apiPid = (proj && (proj.serverId || proj.id)) || st.projectId;
    if (st.docEditor && st.docEditor.destroy) {
      try { st.docEditor.destroy(); } catch (e) {}
    }
    st.docEditor = SMD_RESEARCH_DOC.render(host, {
      outline: st.docOutline,
      saved: st.doc,
      sources: (st.snapshot && st.snapshot.manuscript) || null,
      manuscriptTitle: st.manuscriptTitle || "",
      pid: st.projectId,
      apiPid: apiPid,
      thesisPid: apiPid,
      project: proj,
      projectTitle: st.manuscriptTitle || (proj && proj.title),
      onChange: function (doc) { syncDocStatuses(doc); }
    });
    if (st.docEditor) {
      st.doc = st.docEditor.getDoc();
      syncDocStatuses(st.doc);
    }
  }

  function updateCountsDom() {
    var root = lastContainer || D;
    var items = (st.filled && st.filled.items) || [];
    var counts = { auto: 0, partial: 0, manual: 0, missing: 0, total: items.length };
    var i, it, el;
    for (i = 0; i < items.length; i++) {
      it = items[i];
      if (counts[it.status] == null) counts.missing++;
      else counts[it.status]++;
    }
    if (st.filled) st.filled.counts = counts;
    el = root.querySelector("[data-rmd-counts]");
    if (el) {
      el.textContent = "Filled " + counts.auto + ". Partial " + counts.partial + ". Manual " + counts.manual + ". Missing " + counts.missing + ".";
    }
  }

  function updateItemsDom(items) {
    var root = lastContainer || D;
    var cards = root.querySelectorAll("[data-rmd-item]");
    var map = {};
    var i, it, card, badge, filled, num;
    for (i = 0; i < cards.length; i++) map[cards[i].getAttribute("data-rmd-item")] = cards[i];
    for (i = 0; i < items.length; i++) {
      it = items[i];
      num = String(it.num);
      card = map[num];
      if (!card) continue;
      badge = card.querySelector("[data-rmd-status]");
      if (badge) {
        badge.className = "rmd-checklist-badge rmd-checklist-badge-" + it.status;
        badge.setAttribute("data-rmd-status", it.status);
        badge.textContent = statusLabel(it.status);
      }
      filled = card.querySelector("[data-rmd-filled]");
      if (filled) {
        filled.textContent = it.filled ? previewText(it.filled, 280) : "Not recorded in the project.";
      }
      var evidence = card.querySelector("[data-rmd-evidence]");
      var lines = it.evidence || [];
      var shown = 0;
      var j;
      for (j = 0; j < lines.length; j++) {
        if (lines[j] && lines[j] !== it.filled) shown++;
      }
      if (!shown) {
        if (evidence && evidence.parentNode) evidence.parentNode.removeChild(evidence);
      } else {
        if (!evidence) {
          evidence = D.createElement("ul");
          evidence.className = "rmd-checklist-evidence";
          evidence.setAttribute("data-rmd-evidence", "");
          if (filled && filled.parentNode) filled.parentNode.insertBefore(evidence, filled.nextSibling);
        }
        while (evidence.firstChild) evidence.removeChild(evidence.firstChild);
        for (j = 0; j < lines.length; j++) {
          if (!lines[j] || lines[j] === it.filled) continue;
          var li = D.createElement("li");
          li.textContent = previewText(lines[j], 220);
          evidence.appendChild(li);
        }
      }
    }
  }

  function updateApproveDom() {
    var root = lastContainer || D;
    var btn = root.querySelector("[data-rmd-approve]");
    var reason = root.querySelector("[data-rmd-approve-reason]");
    var rem, msg;
    if (!btn || st.approved || st.approving) return;
    rem = remainingRequiredCount();
    msg = approveReasonText();
    btn.disabled = rem !== 0;
    if (btn.disabled) btn.setAttribute("aria-describedby", "rmdChecklistApproveReason");
    else btn.removeAttribute("aria-describedby");
    if (reason) {
      reason.textContent = msg;
      reason.hidden = !msg;
    }
  }

  function syncDocStatuses(doc) {
    if (!st.filled || !SMD_RESEARCH_DOC) return;
    if (doc) st.doc = doc;
    var d = st.doc;
    if (!d || !d.sections) return;
    var bySub = {};
    var i, j, sec, sub, text, words, items, it, sid, row, before;
    for (i = 0; i < d.sections.length; i++) {
      sec = d.sections[i];
      for (j = 0; j < sec.subheadings.length; j++) {
        sub = sec.subheadings[j];
        text = SMD_RESEARCH_DOC.htmlToText(sub.html);
        words = SMD_RESEARCH_DOC.countWords(text);
        bySub[sub.id] = { text: text, words: words };
      }
    }
    items = st.filled.items || [];
    for (i = 0; i < items.length; i++) {
      it = items[i];
      sid = st.itemSub ? st.itemSub[it.num] : "";
      if (!sid || !bySub[sid]) continue;
      row = bySub[sid];
      if (row.words > 0) {
        before = it.status;
        it.status = "auto";
        it.filled = row.text;
        it.evidence = [];
        it._doc = 1;
        if (before !== it.status) st.csv = "";
      } else if (it._doc) {
        it.status = it._baseStatus;
        it.filled = it._baseFilled;
        it.evidence = it._baseEvidence;
        it._doc = 0;
        st.csv = "";
      }
    }
    updateCountsDom();
    updateItemsDom(items);
    updateApproveDom();
  }

  function bindBreakpoint() {
    var lastPhone, fn, mql;
    if (mqlBound) return;
    mqlBound = true;
    lastPhone = isPhone();
    fn = function () {
      var now = isPhone();
      if (now === lastPhone) return;
      lastPhone = now;
      if (lastContainer && D.body && D.body.contains(lastContainer)) {
        if (st.filled) paint(lastContainer);
        else render(lastContainer);
      }
    };
    try {
      if (G.matchMedia) {
        mql = G.matchMedia("(max-width: 767px)");
        if (mql.addEventListener) mql.addEventListener("change", fn);
        else if (mql.addListener) mql.addListener(fn);
      }
    } catch (e2) {}
    if (G.addEventListener) G.addEventListener("resize", fn);
  }

  function render(container) {
    var proj;
    lastContainer = container;
    injectCss();
    proj = activeProject();
    if (!proj || !proj.id) {
      st.projectId = null;
      paintEmpty(container);
      return;
    }
    if (!engine() || typeof engine().fill !== "function") {
      container.innerHTML = '<div class="rmd-checklist-screen"><div class="rmd-checklist-wrap"><div class="rmd-checklist-banner" role="alert"><strong>The checklist module did not load.</strong><span>Update the app and reopen ResearchMD.</span></div></div></div>';
      return;
    }
    if (!SMD.api || typeof SMD.api.request !== "function") {
      st.error = "The research API is not available.";
      st.filled = null;
      paint(container);
      return;
    }
    if (st.projectId !== proj.id || !st.checklist) {
      loadAll(proj.id);
      return;
    }
    if (st.guidelineId) {
      loadGuideline(proj.id, st.guidelineId, ++st.seq);
      return;
    }
    paint(container);
    bindBreakpoint();
  }

  SMD.screens.checklist = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
