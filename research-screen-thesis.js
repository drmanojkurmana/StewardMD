/* StewardMD - ResearchMD: turn a thesis into a journal paper.
   Client only. The server (pdf-uploads, pdf_extract job, ai-draft task
   "thesis_to_paper", journals/match) lives on the research-server branch;
   here we drive it through SMD.api and verify every number against the
   extracted thesis text before it is shown. ES5 IIFE, dual export. */
(function (G) {
  "use strict";

  var NAME = "research-screen-thesis";
  var VERSION = "rmd1";
  var D = G && G.document;
  var SMD = G && (G.SMD_RESEARCH = G.SMD_RESEARCH || {});
  var THESIS_KEY = "smd_rmd_thesis_v1";
  var MAX_BYTES = 40 * 1024 * 1024;
  var POLL_MS = 1500;
  var POLL_TRIES = 40;

  var DEFAULT_JOURNAL = {
    name: "General Indian medical journal format",
    wordLimit: 3000,
    abstractFormat: "Structured abstract (Background, Methods, Results, Conclusion), up to 250 words",
    referenceStyle: "vancouver"
  };

  var PAPER_TYPES = [
    { key: "obs", label: "Original article (observational study)", checklist: "strobe", checklistName: "STROBE", gloss: "the reporting checklist for observational studies", eg: "A cohort, case-control or cross-sectional study from your thesis data." },
    { key: "rct", label: "Randomized controlled trial (RCT)", checklist: "consort", checklistName: "CONSORT", gloss: "the reporting checklist for randomized trials", eg: "A trial that randomly allocated people to groups." },
    { key: "case", label: "Case series or case report", checklist: "care", checklistName: "CARE", gloss: "the reporting checklist for case reports", eg: "One patient or a small series of unusual cases." },
    { key: "sr", label: "Systematic review", checklist: "prisma2020", checklistName: "PRISMA", gloss: "the reporting checklist for systematic reviews", eg: "A structured search and synthesis of many studies." }
  ];

  var SECTION_ORDER = [
    { id: "abstract", heading: "Abstract" },
    { id: "introduction", heading: "Introduction" },
    { id: "methods", heading: "Methods" },
    { id: "results", heading: "Results" },
    { id: "discussion", heading: "Discussion" }
  ];

  /* ---------- pure helpers (unit tested) ---------- */

  function splitSentences(text) {
    var out = [], cur = "", i, ch, next, prev, decimal;
    text = String(text || "");
    for (i = 0; i < text.length; i++) {
      ch = text.charAt(i);
      cur += ch;
      if (ch === "." || ch === "!" || ch === "?") {
        next = text.charAt(i + 1);
        prev = text.charAt(i - 1);
        decimal = ch === "." && prev >= "0" && prev <= "9" && next >= "0" && next <= "9";
        if (!decimal && (next === "" || /\s/.test(next))) { out.push(cur); cur = ""; }
      }
    }
    if (cur) out.push(cur);
    return out;
  }

  function numTokens(text) {
    var re = /(?:\d+(?:\.\d+)?|\.\d+)/g, out = [], m;
    while ((m = re.exec(text))) out.push({ tok: m[0], idx: m.index });
    return out;
  }

  function isReportingConstant(text, idx, tok) {
    if (tok === "95" && text.slice(idx, idx + 6) === "95% CI") return true;
    if ((tok === ".001" || tok === "0.001") && /p\s*<\s*$/.test(text.slice(Math.max(0, idx - 8), idx))) return true;
    return false;
  }

  function tableFor(text, idx) {
    var head = text.slice(0, idx), re = /Table\s+(\d+)/gi, m, last = null;
    while ((m = re.exec(head))) last = m[1];
    return last ? Number(last) : null;
  }

  function findNumber(pageTexts, tok) {
    var p, t, idx, before, after, nextAfter, bOk, aOk;
    for (p = 0; p < (pageTexts || []).length; p++) {
      t = pageTexts[p].text;
      idx = t.indexOf(tok);
      while (idx >= 0) {
        before = idx > 0 ? t.charAt(idx - 1) : "";
        after = t.charAt(idx + tok.length);
        nextAfter = t.charAt(idx + tok.length + 1);
        bOk = !(before >= "0" && before <= "9") && before !== ".";
        aOk = !(after >= "0" && after <= "9") && (after !== "." || !(nextAfter >= "0" && nextAfter <= "9"));
        if (bOk && aOk) return { page: pageTexts[p].n, table: tableFor(t, idx) };
        idx = t.indexOf(tok, idx + 1);
      }
    }
    return null;
  }

  function buildPageTexts(pages) {
    var out = [], i, pg, words, parts, w;
    for (i = 0; i < (pages || []).length; i++) {
      pg = pages[i];
      words = pg.words || [];
      parts = [];
      for (w = 0; w < words.length; w++) parts.push(words[w].t);
      out.push({ n: pg.n != null ? pg.n : i + 1, text: parts.join(" ") });
    }
    return out;
  }

  /* Every number must appear verbatim in the thesis. A number that is not
     found is removed and its sentence flagged "check this number". Kept
     numbers carry a locator (page, table). Reporting constants (95% CI,
     p < .001) are not thesis data and are left alone. */
  function verifyNumbers(text, pageTexts) {
    var sentences = splitSentences(String(text || ""));
    var flags = [], locators = [], seen = {}, outParts = [];
    var s, sent, lead, body, toks, flagged, newBody, removals, k, t, loc, r, rm;
    for (s = 0; s < sentences.length; s++) {
      sent = sentences[s];
      lead = sent.match(/^\s*/)[0];
      body = sent.slice(lead.length);
      toks = numTokens(body);
      flagged = false;
      newBody = body;
      removals = [];
      for (k = 0; k < toks.length; k++) {
        t = toks[k];
        if (isReportingConstant(body, t.idx, t.tok)) continue;
        loc = findNumber(pageTexts || [], t.tok);
        if (loc) {
          if (!seen[t.tok]) { seen[t.tok] = true; locators.push({ number: t.tok, page: loc.page, table: loc.table }); }
        } else {
          flagged = true;
          removals.push(t);
          flags.push({ sentence: body.replace(/\s+$/, "").replace(/[.!?]$/, ""), number: t.tok });
        }
      }
      if (flagged) {
        removals.sort(function (a, b) { return b.idx - a.idx; });
        for (r = 0; r < removals.length; r++) {
          rm = removals[r];
          newBody = newBody.slice(0, rm.idx) + newBody.slice(rm.idx + rm.tok.length);
        }
        newBody = newBody.replace(/\s{2,}/g, " ").replace(/\s+([,;.)])/g, "$1");
        newBody = newBody.replace(/[.!?]\s*$/, "") + " [check this number].";
      }
      outParts.push(lead + newBody);
    }
    return { text: outParts.join(""), flags: flags, locators: locators };
  }

  function countWords(t) {
    t = String(t || "").replace(/^\s+|\s+$/g, "");
    return t ? t.split(/\s+/).length : 0;
  }

  /* Trim whole sentences from the end of the main text (never the abstract)
     until it fits the journal word limit. Deterministic, no recomputation. */
  function enforceWordLimit(sections, limit) {
    var secs = [], i, total = 0, li, sentences, trimmed = false;
    for (i = 0; i < (sections || []).length; i++) {
      secs.push({ id: sections[i].id, heading: sections[i].heading, text: sections[i].text });
    }
    if (!isFinite(limit) || limit <= 0) return { sections: secs, words: 0, trimmed: false };
    function mainTotal() {
      var sum = 0, j;
      for (j = 0; j < secs.length; j++) if (secs[j].id !== "abstract") sum += countWords(secs[j].text);
      return sum;
    }
    total = mainTotal();
    while (total > limit) {
      li = -1;
      for (i = 0; i < secs.length; i++) if (secs[i].id !== "abstract" && countWords(secs[i].text) > 0) li = i;
      if (li < 0) break;
      sentences = splitSentences(secs[li].text);
      if (sentences.length > 1) {
        sentences.pop();
        secs[li].text = sentences.join("").replace(/\s+$/, "");
      } else {
        secs[li].text = "";
      }
      trimmed = true;
      total = mainTotal();
    }
    return { sections: secs, words: total, trimmed: trimmed };
  }

  function suggestPaperType(text) {
    var t = String(text || "").toLowerCase();
    if (t.indexOf("systematic review") >= 0 || t.indexOf("meta-analysis") >= 0 || t.indexOf("meta analysis") >= 0) {
      return { key: "sr", checklist: "prisma2020", checklistName: "PRISMA", why: "Your thesis mentions a systematic review or meta-analysis." };
    }
    if (t.indexOf("randomized") >= 0 || t.indexOf("randomised") >= 0 || t.indexOf(" rct ") >= 0) {
      return { key: "rct", checklist: "consort", checklistName: "CONSORT", why: "Your thesis describes a randomized controlled trial." };
    }
    if (t.indexOf("case report") >= 0 || t.indexOf("case series") >= 0) {
      return { key: "case", checklist: "care", checklistName: "CARE", why: "Your thesis is a case report or case series." };
    }
    return { key: "obs", checklist: "strobe", checklistName: "STROBE", why: "Your thesis looks like an observational study (cohort, case-control or cross-sectional)." };
  }

  function referenceFlags(refs) {
    var out = [], i, r;
    for (i = 0; i < (refs || []).length; i++) {
      r = refs[i] || {};
      out.push({ ref: r, needCheck: !r.doi && !r.pmid });
    }
    return out;
  }

  function formatReference(ref, style, idx) {
    ref = ref || {};
    var authors = ref.authors;
    if (Object.prototype.toString.call(authors) === "[object Array]") authors = authors.join(", ");
    authors = authors || "";
    var title = ref.title || "", journal = ref.journal || "", year = ref.year || "";
    var vol = ref.volume || "", issue = ref.issue || "", pages = ref.pages || "";
    var doi = ref.doi || "", pmid = ref.pmid || "", s;
    if (style === "apa") {
      s = authors + " (" + (year || "n.d.") + "). " + title + ". " + journal + ".";
    } else {
      s = (idx != null ? (idx + 1) + ". " : "") + authors + " " + title + ". " + journal + ". " +
        (year ? year + ";" : "") + vol + (issue ? "(" + issue + ")" : "") + (pages ? ":" + pages : "") + ".";
    }
    if (doi) s += " doi: " + doi + ".";
    if (pmid) s += " PMID: " + pmid + ".";
    return s.replace(/\s{2,}/g, " ").replace(/\s+\./g, ".").replace(/\.\./g, ".").replace(/^\s+|\s+$/g, "");
  }

  function suggestTables(tables, max) {
    var list = (tables || []).slice(), out = [], i;
    list.sort(function (a, b) { return (b.score || 0) - (a.score || 0); });
    for (i = 0; i < list.length && out.length < (max || 3); i++) out.push(list[i].id);
    return out;
  }

  function canRunAi(project) {
    var r = (project && project.role) || "owner";
    return r === "owner" || r === "editor" || r === "analyst";
  }

  /* The AI gate: a PHI hit blocks every provider call until a clean upload;
     viewers cannot run AI at all. */
  function aiGate(project, state) {
    if (state && state.phi && state.phi.blocked) return { allowed: false, reason: "phi" };
    if (!canRunAi(project)) return { allowed: false, reason: "role" };
    return { allowed: true, reason: "" };
  }

  /* ---------- state ---------- */

  function loadThesis(pid) {
    try {
      if (typeof localStorage === "undefined") return {};
      var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
      return all[pid] || {};
    } catch (e) { return {}; }
  }

  function saveThesis(pid, patch) {
    try {
      if (typeof localStorage === "undefined") return;
      var all = JSON.parse(localStorage.getItem(THESIS_KEY) || "{}");
      var cur = all[pid] || {}, k;
      for (k in patch) if (Object.prototype.hasOwnProperty.call(patch, k)) cur[k] = patch[k];
      all[pid] = cur;
      localStorage.setItem(THESIS_KEY, JSON.stringify(all));
    } catch (e) {}
  }

  function activeProject() {
    return SMD && SMD.store && SMD.store.getActiveProject ? SMD.store.getActiveProject() : null;
  }
  function pidOf(proj) { return proj ? (proj.serverId || proj.id) : ""; }
  function esc(s) {
    return String(s == null ? "" : s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  }
  function allThesisText() {
    var parts = [], i;
    for (i = 0; i < (ts.pages || []).length; i++) parts.push(ts.pages[i].text);
    return parts.join("\n");
  }
  function journalOf() { return ts.journal || DEFAULT_JOURNAL; }
  function styleName(style) {
    if (style === "apa") return "APA style (author and year)";
    if (style === "vancouver") return "Vancouver style (numbered in order of appearance)";
    return style || "Vancouver style (numbered in order of appearance)";
  }

  var ts = {};
  var tpid = "";
  var draftAi = null;
  var pollTimer = null;

  /* ---------- shared chrome ---------- */

  function nextBtn(screen, label) {
    return '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-thesis-next="' + screen + '">' + esc(label || "Next") + '</button>';
  }

  function phiWarningHtml() {
    var pages = (ts.phi && ts.phi.pages) || [];
    var pageList = pages.length ? "Pages: " + pages.join(", ") + "." : "";
    return '<div class="rmd-banner rmd-banner-warn" role="alert" id="rmdThesisPhi">' +
      '<strong>Patient identifiers found in your thesis.</strong> ' +
      '<span>' + esc(pageList) + ' Remove names, dates of birth, hospital numbers, phone numbers and addresses from those pages, then upload the thesis again. Nothing was sent to an AI provider.</span>' +
      '</div>';
  }

  function needPagesHtml(container) {
    container.innerHTML = '<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">' +
      '<h2>Upload your thesis first</h2>' +
      '<p class="rmd-screen-subtitle">We read your thesis before we can shape it into a paper.</p>' +
      '<button type="button" class="rmd-btn rmd-btn-primary" data-rmd-thesis-next="thesis">Go to upload</button>' +
      '</div></div>';
    bindNext(container);
  }

  function bindNext(container) {
    var btns = container.querySelectorAll("[data-rmd-thesis-next]"), i;
    for (i = 0; i < btns.length; i++) {
      btns[i].onclick = function () { SMD.navigate(this.getAttribute("data-rmd-thesis-next")); };
    }
  }

  /* ---------- screen: upload ---------- */

  function renderUpload(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    if (ts.phi && ts.phi.blocked) {
      h.push(phiWarningHtml());
      h.push('<div class="rmd-card"><button type="button" class="rmd-btn" id="rmdThesisReupload">Upload a clean version</button></div>');
    } else if (ts.pages && ts.pages.length) {
      h.push('<div class="rmd-card">');
      h.push('<h2>Thesis read</h2>');
      h.push('<p class="rmd-screen-subtitle">' + esc(ts.filename || "Your thesis") + ' was read: ' + ts.pages.length + ' page(s). The text stays on this device and on our server; it is only sent to an AI provider when you ask MaiK to draft.</p>');
      h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn" id="rmdThesisReupload">Upload a different file</button>' + nextBtn("thesis-type", "Next: pick the paper type") + '</div>');
      h.push('</div>');
    } else {
      h.push('<div class="rmd-card">');
      h.push('<h2>Upload your thesis</h2>');
      h.push('<p class="rmd-screen-subtitle">PDF or DOCX, up to 40 MB. We read a PDF on our server. For DOCX, export it as a PDF first.</p>');
      h.push('<div class="rmd-field"><label for="rmdThesisFile">Thesis file</label>');
      h.push('<input type="file" id="rmdThesisFile" accept=".pdf,.docx,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document"></div>');
      h.push('<p class="rmd-thesis-meta">Tip: in Word, use File, then Export, then Create PDF, and upload the PDF.</p>');
      h.push('<div id="rmdThesisMsg"></div>');
      h.push('</div>');
    }
    h.push('</div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var fileEl = container.querySelector("#rmdThesisFile");
    if (fileEl) fileEl.onchange = function () { if (this.files && this.files[0]) handleFile(this.files[0], container); };
    var re = container.querySelector("#rmdThesisReupload");
    if (re) re.onclick = function () {
      saveThesis(tpid, { pages: null, phi: null, artifactId: null, jobId: null, draft: null });
      ts = loadThesis(tpid);
      renderUpload(container);
    };
  }

  function setMsg(container, html) {
    var box = container.querySelector("#rmdThesisMsg");
    if (box) box.innerHTML = html;
  }

  function handleFile(file, container) {
    var name = (file.name || "").toLowerCase();
    if (/\.docx?$/.test(name) || name.indexOf("wordprocessingml") >= 0) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">DOCX cannot be read here yet. In Word, use File, then Export, then Create PDF, and upload the PDF.</div>');
      return;
    }
    if (file.size > MAX_BYTES) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">This file is larger than 40 MB. Split it or export a smaller PDF.</div>');
      return;
    }
    setMsg(container, SMD.p2.loadingHtml("Uploading your thesis"));
    var form = new FormData();
    form.append("file", file);
    SMD.api.upload("/v1/projects/" + tpid + "/pdf-uploads", form).then(function (res) {
      var art = (res && res.artifact) || {};
      saveThesis(tpid, { artifactId: art.id, jobId: art.jobId, filename: art.filename || file.name, phi: null });
      ts = loadThesis(tpid);
      pollJob(art.jobId, 0, container);
    }).catch(function (err) {
      var msg;
      if (err && err.code === "ceiling_bytes") msg = "The server reads PDFs up to 25 MB. Export a smaller PDF and upload it again.";
      else if (err && err.code === "file_type") msg = "That file is not a PDF. Export your thesis as a PDF and upload it.";
      else msg = SMD.p2.friendlyError(err).message;
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">' + esc(msg) + '</div>');
    });
  }

  function pollJob(jobId, tries, container) {
    if (!jobId) { loadResult(container); return; }
    if (tries > POLL_TRIES) {
      setMsg(container, '<div class="rmd-banner rmd-banner-warn">Reading is taking longer than usual. Go back and try again.</div>');
      return;
    }
    SMD.api.request("GET", "/v1/jobs/" + jobId).then(function (job) {
      job = job || {};
      if (job.status === "succeeded") { loadResult(container); return; }
      if (job.status === "failed" || job.status === "cancelled") {
        if (job.errorCode === "phi_blocked") {
          var pages = job.errorPages || job.phiPages || (job.error && job.error.pages) || [];
          saveThesis(tpid, { phi: { blocked: true, pages: pages }, pages: null });
          ts = loadThesis(tpid);
          renderUpload(container);
          return;
        }
        setMsg(container, '<div class="rmd-banner rmd-banner-warn">We could not read this PDF. Try again, or export a fresh PDF.</div>');
        return;
      }
      pollTimer = G.setTimeout(function () { pollJob(jobId, tries + 1, container); }, POLL_MS);
    }).catch(function () {
      pollTimer = G.setTimeout(function () { pollJob(jobId, tries + 1, container); }, POLL_MS);
    });
  }

  function loadResult(container) {
    if (!ts.artifactId) { renderUpload(container); return; }
    SMD.api.request("GET", "/v1/artifacts/" + ts.artifactId + "/result").then(function (res) {
      var pages = buildPageTexts((res && res.pages) || []);
      saveThesis(tpid, { pages: pages, phi: null });
      ts = loadThesis(tpid);
      renderUpload(container);
    }).catch(function () {
      pollTimer = G.setTimeout(function () { loadResult(container); }, POLL_MS);
    });
  }

  /* ---------- screen: paper type ---------- */

  function renderType(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var sug = suggestPaperType(allThesisText());
    var chosen = ts.paperType || sug.key;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Pick the paper type</h2>');
    h.push('<p class="rmd-screen-subtitle">Suggested: ' + esc(labelFor(chosen)) + '. ' + esc(sug.why) + '</p>');
    var i, pt;
    for (i = 0; i < PAPER_TYPES.length; i++) {
      pt = PAPER_TYPES[i];
      h.push('<button type="button" class="rmd-start-choice" data-rmd-type="' + pt.key + '" aria-pressed="' + (pt.key === chosen ? "true" : "false") + '">');
      h.push(esc(pt.label) + (pt.key === sug.key ? ' <span class="rmd-badge-pill">Suggested</span>' : ''));
      h.push('<span>Reporting checklist: ' + esc(pt.checklistName) + ' (' + esc(pt.gloss) + '). ' + esc(pt.eg) + '</span>');
      h.push('</button>');
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-journal", "Next: pick the journal") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var btns = container.querySelectorAll("[data-rmd-type]");
    for (i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var key = this.getAttribute("data-rmd-type"), j, gid = "";
        for (j = 0; j < PAPER_TYPES.length; j++) if (PAPER_TYPES[j].key === key) gid = PAPER_TYPES[j].checklist;
        saveThesis(tpid, { paperType: key, checklist: gid });
        if (SMD.setPreferredChecklist) SMD.setPreferredChecklist(tpid, gid);
        ts = loadThesis(tpid);
        renderType(container);
      };
    }
  }

  function labelFor(key) {
    var i;
    for (i = 0; i < PAPER_TYPES.length; i++) if (PAPER_TYPES[i].key === key) return PAPER_TYPES[i].label;
    return "Original article (observational study)";
  }

  /* ---------- screen: journal ---------- */

  function renderJournal(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var sel = ts.journal || null;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Pick the target journal</h2>');
    h.push('<p class="rmd-screen-subtitle">We shape the draft to the journal word limit, abstract format and reference style.</p>');
    h.push('<button type="button" class="rmd-start-choice" data-rmd-journal="default" aria-pressed="' + (!sel || sel.name === DEFAULT_JOURNAL.name ? "true" : "false") + '">');
    h.push(esc(DEFAULT_JOURNAL.name));
    h.push('<span>Word limit: 3,000 words. Abstract: structured (Background, Methods, Results, Conclusion). References: ' + esc(styleName("vancouver")) + '.</span>');
    h.push('</button>');
    h.push('<div id="rmdJournalMatches"></div>');
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-draft", "Next: shape the draft") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var def = container.querySelector('[data-rmd-journal="default"]');
    if (def) def.onclick = function () {
      saveThesis(tpid, { journal: DEFAULT_JOURNAL });
      ts = loadThesis(tpid);
      renderJournal(container);
    };
    renderMatches(container);
    if (!ts.matches && SMD.api) {
      SMD.api.request("POST", "/v1/journals/match", { keywords: (proj.title || "") + " " + labelFor(ts.paperType || "obs"), design: ts.paperType || "obs" }).then(function (res) {
        saveThesis(tpid, { matches: (res && res.matches) || [] });
        ts = loadThesis(tpid);
        renderMatches(container);
      }).catch(function () {});
    }
  }

  function renderMatches(container) {
    var box = container.querySelector("#rmdJournalMatches");
    if (!box) return;
    var matches = ts.matches || [], h = [], i, m, j, wl, sel = ts.journal || {};
    for (i = 0; i < matches.length; i++) {
      m = matches[i];
      j = m.journal || {};
      wl = j.wordLimits || {};
      h.push('<button type="button" class="rmd-start-choice" data-rmd-journal="' + i + '" aria-pressed="' + (sel.name === j.name ? "true" : "false") + '">');
      h.push(esc(j.name || "Journal"));
      h.push('<span>Word limit: ' + (wl.main || 3000) + ' words main text. Abstract: ' + (wl.abstract ? "up to " + wl.abstract + " words" : "structured") + '. References: ' + esc(styleName(j.referenceStyle)) + '.</span>');
      h.push('</button>');
    }
    box.innerHTML = h.join("");
    var btns = box.querySelectorAll("[data-rmd-journal]");
    for (i = 0; i < btns.length; i++) {
      btns[i].onclick = function () {
        var idx = Number(this.getAttribute("data-rmd-journal"));
        var mm = (ts.matches || [])[idx], jj = (mm && mm.journal) || {}, wll = jj.wordLimits || {};
        var picked = {
          id: jj.id || "",
          name: jj.name || "Journal",
          wordLimit: wll.main || 3000,
          abstractFormat: wll.abstract ? "Structured abstract, up to " + wll.abstract + " words" : DEFAULT_JOURNAL.abstractFormat,
          referenceStyle: jj.referenceStyle || "vancouver"
        };
        saveThesis(tpid, { journal: picked });
        ts = loadThesis(tpid);
        renderJournal(container);
      };
    }
  }

  /* ---------- screen: draft ---------- */

  function renderDraft(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var gate = aiGate(proj, ts);
    if (gate.reason === "phi") {
      container.innerHTML = '<div class="rmd-p2-screen rmd-thesis-screen">' + phiWarningHtml() +
        '<div class="rmd-card"><button type="button" class="rmd-btn rmd-btn-primary" data-rmd-thesis-next="thesis">Go to upload</button></div></div>';
      bindNext(container);
      return;
    }
    if (!ts.pages || !ts.pages.length) { needPagesHtml(container); return; }
    var jr = journalOf();
    var mayAi = gate.allowed;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen">'];
    h.push('<div class="rmd-card">');
    h.push('<h2>Shape the draft</h2>');
    h.push('<p class="rmd-screen-subtitle">Target: ' + esc(jr.name) + '. Word limit: ' + jr.wordLimit + ' words. ' + esc(jr.abstractFormat) + '. MaiK keeps your wording and never invents a number; every number is checked against your thesis.</p>');
    if (mayAi) {
      var st = draftAi || (draftAi = SMD.ai.state());
      h.push(SMD.ai.barHtml(st, { task: "thesis_to_paper", label: "paper draft", cost: 3 }));
      h.push('<div id="rmdDraftNote">' + SMD.ai.noteHtml(st, "draft") + '</div>');
    } else {
      h.push('<p class="rmd-thesis-meta">Only the project owner, editor or analyst can ask MaiK. You can still edit and save the draft yourself.</p>');
    }
    h.push('<div id="rmdDraftBody"></div>');
    h.push('<div class="rmd-card-actions"><button type="button" class="rmd-btn" id="rmdDraftToggle">' + (ts.editMode ? "Done editing" : "Edit draft") + '</button>');
    h.push('<button type="button" class="rmd-btn rmd-btn-primary" id="rmdDraftSave">Save to the manuscript</button>');
    h.push(nextBtn("thesis-tables", "Next: tables") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    renderDraftBody(container);
    if (mayAi) {
      var st2 = draftAi;
      SMD.ai.bind(container, st2, {
        pid: tpid,
        task: "thesis_to_paper",
        input: function () {
          return { pages: ts.pages || [], filename: ts.filename || "", paperType: labelFor(ts.paperType || "obs"), checklist: ts.checklist || "strobe", journalId: journalOf().id || "", wordLimit: journalOf().wordLimit };
        },
        apply: function (draft) { return applyDraft(draft); },
        render: function () { renderDraft(container); }
      });
    }
    var tog = container.querySelector("#rmdDraftToggle");
    if (tog) tog.onclick = function () {
      saveThesis(tpid, { editMode: !ts.editMode });
      ts = loadThesis(tpid);
      renderDraft(container);
    };
    var save = container.querySelector("#rmdDraftSave");
    if (save) save.onclick = function () { saveDraft(container); };
  }

  function applyDraft(draft) {
    draft = draft || {};
    var sections = draft.sections || [], pageTexts = ts.pages || [];
    var allFlags = [], allLocators = [], seen = {}, i, sec, v, k, loc;
    var built = [];
    for (i = 0; i < SECTION_ORDER.length; i++) {
      sec = null;
      for (k = 0; k < sections.length; k++) if (sections[k].id === SECTION_ORDER[i].id) sec = sections[k];
      var text = sec ? sec.text : "";
      v = verifyNumbers(text, pageTexts);
      for (k = 0; k < v.flags.length; k++) allFlags.push(v.flags[k]);
      for (k = 0; k < v.locators.length; k++) {
        loc = v.locators[k];
        if (!seen[loc.number]) { seen[loc.number] = true; allLocators.push(loc); }
      }
      built.push({ id: SECTION_ORDER[i].id, heading: SECTION_ORDER[i].heading, text: v.text });
    }
    var enf = enforceWordLimit(built, journalOf().wordLimit);
    var tables = draft.tables || draft.suggestedTables || [];
    var refs = draft.references || [];
    saveThesis(tpid, {
      draft: { sections: enf.sections, flags: allFlags, locators: allLocators, tables: tables, references: refs, trimmed: enf.trimmed, words: enf.words },
      tablePicks: suggestTables(tables, 3),
      editMode: false
    });
    ts = loadThesis(tpid);
    return ["draft"];
  }

  function renderDraftBody(container) {
    var box = container.querySelector("#rmdDraftBody");
    if (!box) return;
    var draft = ts.draft;
    var editMode = ts.editMode || !draft;
    var h = [], i, sec;
    if (draft && draft.flags && draft.flags.length) {
      h.push('<div class="rmd-banner rmd-banner-warn">' + draft.flags.length + ' sentence(s) need a number check. A number that was not found verbatim in your thesis was removed and marked.</div>');
    }
    if (draft && draft.trimmed) {
      h.push('<p class="rmd-thesis-meta">The draft was over the word limit, so the last sentences of the main text were trimmed. Check the ending.</p>');
    }
    var secs = (draft && draft.sections) || SECTION_ORDER;
    for (i = 0; i < secs.length; i++) {
      sec = secs[i];
      h.push('<div class="rmd-thesis-section">');
      h.push('<div class="rmd-field"><label>' + esc(sec.heading || sec.id) + ' <span class="rmd-thesis-meta">' + countWords(sec.text) + ' words</span></label>');
      if (editMode) {
        h.push('<textarea class="rmd-thesis-edit" data-rmd-section="' + esc(sec.id) + '" rows="5">' + esc(sec.text || "") + '</textarea>');
      } else {
        h.push('<div class="rmd-thesis-section-text">' + sectionHtml(sec.text || "", (draft && draft.locators) || []) + '</div>');
      }
      h.push('</div></div>');
    }
    if (draft) {
      h.push('<p class="rmd-thesis-meta">Main text: ' + (draft.words || 0) + ' of ' + journalOf().wordLimit + ' words.</p>');
    }
    box.innerHTML = h.join("");
    var areas = box.querySelectorAll("[data-rmd-section]");
    for (i = 0; i < areas.length; i++) {
      areas[i].oninput = function () {
        var id = this.getAttribute("data-rmd-section"), j, d = ts.draft;
        if (!d) {
          d = { sections: [], flags: [], locators: [], tables: [], references: [], words: 0 };
          for (j = 0; j < SECTION_ORDER.length; j++) d.sections.push({ id: SECTION_ORDER[j].id, heading: SECTION_ORDER[j].heading, text: "" });
        }
        for (j = 0; j < d.sections.length; j++) if (d.sections[j].id === id) d.sections[j].text = this.value;
        saveThesis(tpid, { draft: d });
        ts = loadThesis(tpid);
      };
    }
    var nums = box.querySelectorAll(".rmd-thesis-num");
    for (i = 0; i < nums.length; i++) nums[i].onclick = function () { openThesisPop(this); };
  }

  function sectionHtml(text, locators) {
    var html = esc(text), i, loc, re;
    html = html.split("[check this number]").join('<span class="rmd-thesis-flag">[check this number]</span>');
    var sorted = (locators || []).slice().sort(function (a, b) { return b.number.length - a.number.length; });
    for (i = 0; i < sorted.length; i++) {
      loc = sorted[i];
      re = new RegExp("(^|[^0-9.])(" + loc.number.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + ")(?=$|[^0-9.]|\\.(?![0-9]))");
      html = html.replace(re, function (m, pre, num) {
        return pre + '<span class="rmd-thesis-num" data-page="' + loc.page + '" data-table="' + (loc.table != null ? loc.table : "") + '" tabindex="0" role="button">' + num + '</span>';
      });
    }
    return html;
  }

  function openThesisPop(el) {
    var page = el.getAttribute("data-page"), table = el.getAttribute("data-table");
    var line = "From your thesis, page " + page + (table ? ", Table " + table : "") + ".";
    var old = D.querySelector(".rmd-thesis-pop");
    if (old) old.parentNode.removeChild(old);
    var pop = D.createElement("div");
    // smd-books-keep: the page/table locator is a source attribution, not a textbook citation;
    // the app-wide book scrubber (emoji-icons.js) would otherwise strip "page 54" from it.
    pop.className = "rmd-thesis-pop smd-books-keep";
    pop.innerHTML = '<div class="rmd-thesis-pop-text">' + esc(line) + '</div><button type="button" class="rmd-btn rmd-thesis-pop-close">Close</button>';
    D.body.appendChild(pop);
    function close() { if (pop.parentNode) pop.parentNode.removeChild(pop); D.removeEventListener("click", onDoc, true); }
    function onDoc(ev) { if (!pop.contains(ev.target)) close(); }
    pop.querySelector(".rmd-thesis-pop-close").onclick = close;
    G.setTimeout(function () { D.addEventListener("click", onDoc, true); }, 0);
  }

  function saveDraft(container) {
    var draft = ts.draft;
    if (!draft || !draft.sections || !draft.sections.length) {
      SMD.p2.flashNotice(container, "Write or draft the paper first.", "error");
      return;
    }
    var pid = tpid;
    SMD.api.request("GET", "/v1/projects/" + pid + "/manuscript").then(function (res) {
      return (res && res.manuscript && res.manuscript.version) || 1;
    }).catch(function () { return 1; }).then(function (version) {
      var chain = Promise.resolve(), i;
      for (i = 0; i < draft.sections.length; i++) {
        (function (sec) {
          chain = chain.then(function () {
            return SMD.api.request("PUT", "/v1/projects/" + pid + "/manuscript/sections/" + sec.id, { version: version, heading: sec.heading, text: sec.text });
          });
        })(draft.sections[i]);
      }
      return chain;
    }).then(function () {
      SMD.p2.flashNotice(container, "Saved to the manuscript.", "info");
      SMD.navigate("thesis-tables");
    }).catch(function () {
      SMD.p2.flashNotice(container, "Saved on this device.", "info");
      SMD.navigate("thesis-tables");
    });
  }

  /* ---------- screen: tables ---------- */

  function renderTables(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var tables = (ts.draft && ts.draft.tables) || [];
    var picks = ts.tablePicks || [];
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Keep the 3 most important tables</h2>');
    if (!tables.length) {
      h.push('<p class="rmd-screen-subtitle">No tables were found in the draft. You can add tables later in the manuscript screen.</p>');
    } else {
      h.push('<p class="rmd-screen-subtitle">MaiK suggests three. Tick the ones to keep (up to 3).</p>');
      var i, t, checked;
      for (i = 0; i < tables.length; i++) {
        t = tables[i];
        checked = picks.indexOf(t.id) >= 0;
        h.push('<label class="rmd-thesis-table-row">');
        h.push('<input type="checkbox" data-rmd-table="' + esc(t.id) + '"' + (checked ? " checked" : "") + '>');
        h.push('<span><strong>' + esc(t.caption || t.id) + '</strong>');
        if (t.reason) h.push('<span class="rmd-thesis-meta">Why MaiK suggests it: ' + esc(t.reason) + '</span>');
        h.push('</span></label>');
      }
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("thesis-refs", "Next: references") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
    var boxes = container.querySelectorAll("[data-rmd-table]");
    for (var b = 0; b < boxes.length; b++) {
      boxes[b].onchange = function () {
        var id = this.getAttribute("data-rmd-table");
        var cur = (ts.tablePicks || []).slice();
        if (this.checked) {
          if (cur.length >= 3) { this.checked = false; SMD.p2.flashNotice(container, "Keep at most 3 tables. Untick one first.", "error"); return; }
          if (cur.indexOf(id) < 0) cur.push(id);
        } else {
          cur = cur.filter(function (x) { return x !== id; });
        }
        saveThesis(tpid, { tablePicks: cur });
        ts = loadThesis(tpid);
      };
    }
  }

  /* ---------- screen: references ---------- */

  function renderRefs(container) {
    var proj = activeProject();
    if (!proj) { container.innerHTML = SMD.p2.errHtml("Open a project first."); return; }
    tpid = pidOf(proj);
    ts = loadThesis(tpid);
    injectCSS();
    var refs = (ts.draft && ts.draft.references) || [];
    var flags = referenceFlags(refs);
    var style = journalOf().referenceStyle;
    var h = ['<div class="rmd-p2-screen rmd-thesis-screen"><div class="rmd-card">'];
    h.push('<h2>Check the references</h2>');
    if (!refs.length) {
      h.push('<p class="rmd-screen-subtitle">No references were found in the draft. Add them in the manuscript screen.</p>');
    } else {
      h.push('<p class="rmd-screen-subtitle">Formatted for your journal: ' + esc(styleName(style)) + '. A reference without a DOI or PMID is marked so you can check it.</p>');
      h.push('<div class="rmd-thesis-refs">');
      var i, f;
      for (i = 0; i < flags.length; i++) {
        f = flags[i];
        h.push('<div class="rmd-thesis-ref">' + esc(formatReference(f.ref, style, i)));
        if (f.needCheck) h.push(' <span class="rmd-thesis-check">[check this reference]</span><span class="rmd-thesis-meta"> No DOI or PMID found. Add one so the journal can locate it.</span>');
        h.push('</div>');
      }
      h.push('</div>');
    }
    h.push('<div class="rmd-card-actions">' + nextBtn("checklist", "Next: reporting checklist") + '</div>');
    h.push('</div></div>');
    container.innerHTML = h.join("");
    bindNext(container);
  }

  /* ---------- css ---------- */

  var cssDone = false;
  function injectCSS() {
    if (cssDone || !D) return;
    cssDone = true;
    var s = D.createElement("style");
    s.textContent = [
      "#researchMD .rmd-thesis-meta { font: 400 12.5px var(--rmd-f); color: var(--rmd-mut); display: block; margin-top: 2px; }",
      "#researchMD .rmd-thesis-section { margin-bottom: 14px; }",
      "#researchMD .rmd-thesis-section-text { font: 400 14px/1.65 var(--rmd-f); color: var(--rmd-ink); white-space: pre-wrap; overflow-wrap: anywhere; }",
      "#researchMD .rmd-thesis-edit { width: 100%; box-sizing: border-box; font: 400 14px/1.6 var(--rmd-f); }",
      "#researchMD .rmd-thesis-num { border-bottom: 2px dotted var(--rmd-acc); font-weight: 600; cursor: pointer; }",
      "#researchMD .rmd-thesis-flag { color: var(--rmd-warn); font-weight: 600; }",
      "#researchMD .rmd-thesis-table-row { display: flex; gap: 10px; align-items: flex-start; padding: 10px 12px; border: 1px solid var(--rmd-line); border-radius: 8px; margin-bottom: 8px; background: var(--rmd-panel); font: 400 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-thesis-table-row input { margin-top: 3px; }",
      "#researchMD .rmd-thesis-ref { padding: 8px 0; border-bottom: 1px solid var(--rmd-line); font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-thesis-check { color: var(--rmd-warn); font-weight: 600; }",
      ".rmd-thesis-pop { position: fixed; left: 50%; bottom: 24px; transform: translateX(-50%); max-width: 320px; background: var(--rmd-panel, #fffdf9); border: 1px solid var(--rmd-line, #e5ddce); border-radius: 12px; padding: 12px 14px; box-shadow: 0 8px 28px rgba(17,28,68,0.18); font: 400 13px/1.5 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-ink, #111c44); z-index: 9999; }",
      ".rmd-thesis-pop-text { margin-bottom: 8px; }",
      ".rmd-thesis-pop-close { width: 100%; }"
    ].join("\n");
    D.head.appendChild(s);
  }

  /* ---------- registration + export ---------- */

  if (SMD) {
    SMD.screens = SMD.screens || {};
    SMD.screens.thesis = { render: renderUpload };
    SMD.screens["thesis-type"] = { render: renderType };
    SMD.screens["thesis-journal"] = { render: renderJournal };
    SMD.screens["thesis-draft"] = { render: renderDraft };
    SMD.screens["thesis-tables"] = { render: renderTables };
    SMD.screens["thesis-refs"] = { render: renderRefs };
  }

  var API = {
    name: NAME,
    version: VERSION,
    splitSentences: splitSentences,
    buildPageTexts: buildPageTexts,
    verifyNumbers: verifyNumbers,
    enforceWordLimit: enforceWordLimit,
    suggestPaperType: suggestPaperType,
    referenceFlags: referenceFlags,
    formatReference: formatReference,
    suggestTables: suggestTables,
    canRunAi: canRunAi,
    aiGate: aiGate,
    countWords: countWords,
    PAPER_TYPES: PAPER_TYPES,
    DEFAULT_JOURNAL: DEFAULT_JOURNAL
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RESEARCH_THESIS = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));