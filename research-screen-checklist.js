/* StewardMD - ResearchMD reporting checklist screen
 * (window.SMD_RESEARCH.screens.checklist). ES5 only, buildless. Phase 5B.1.
 * Tablet-first: manual entry is available at >= 768px. On a phone the screen
 * is view and approve only.
 *
 * ORCHESTRATOR WIRING (do not edit research.js or index.html from this package):
 *
 * 1. index.html, with the other ResearchMD script tags, BEFORE research.js
 *    (after the research-screen-grade.js line):
 *
 *      <script src="/research-checklist.js?v=rmd4" defer></script>
 *      <script src="/research-submission.js?v=rmd4" defer></script>
 *      <script src="/research-screen-checklist.js?v=rmd4" defer></script>
 *
 * 2. research.js, renderShell() tabs array, add after ["grade", "GRADE"]:
 *
 *      ["checklist", "Checklist"]
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
    jump: null,
    csv: "",
    ai: null,
    seq: 0
  };
  var lastContainer = null;
  var mqlBound = false;

  function engine() { return G.SMD_RESEARCH_CHECKLIST; }

  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }

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

  function manuscriptSections() {
    var ms = st.snapshot && st.snapshot.manuscript;
    var raw, out, i, sec, paras, heading, p, list, text;
    if (!ms) return [];
    raw = isArr(ms) ? ms : (ms.sections || []);
    out = [];
    for (i = 0; i < raw.length; i++) {
      sec = raw[i] || {};
      heading = sec.heading || sec.title || ("Section " + (i + 1));
      paras = isArr(sec.paragraphs) ? sec.paragraphs : [];
      list = [];
      for (p = 0; p < paras.length; p++) {
        text = paras[p] == null ? "" : String(paras[p]).replace(/^\s+|\s+$/g, "");
        if (text) list.push(text);
      }
      if (list.length) out.push({ heading: String(heading), paragraphs: list });
    }
    return out;
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
  }

  function failLoad(e) {
    st.loading = false;
    st.error = (e && e.message) ? String(e.message) : "Could not load the checklist.";
    st.errObj = e || null;
    if (lastContainer) paint(lastContainer);
  }

  function loadGuideline(pid, gid, seq) {
    var base;
    st.guidelineId = gid;
    st.loading = true;
    st.error = "";
    st.errObj = null;
    st.approved = false;
    st.csv = "";
    st.jump = null;
    st.filled = null;
    st.ai = null;
    if (lastContainer) paint(lastContainer);
    base = "/v1/projects/" + encodeURIComponent(pid);
    return Promise.all([
      api("GET", "/v1/checklists/" + encodeURIComponent(gid)),
      api("GET", base + "/checklist-snapshot"),
      api("GET", base + "/checklist-manual/" + encodeURIComponent(gid))
    ]).then(function (parts) {
      if (seq !== st.seq) return;
      st.checklist = unwrapChecklist(parts[0]);
      st.snapshot = unwrapSnapshot(parts[1]);
      st.manual = (parts[2] && parts[2].entries) ? parts[2].entries : {};
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

  function loadAll(pid) {
    var seq = ++st.seq;
    st.projectId = pid;
    st.loading = true;
    st.error = "";
    st.errObj = null;
    st.checklist = null;
    st.filled = null;
    st.approved = false;
    st.csv = "";
    st.jump = null;
    if (lastContainer) paint(lastContainer);
    api("GET", "/v1/checklists").then(function (list) {
      var rows, id, i;
      if (seq !== st.seq) return;
      rows = (list && list.checklists) || [];
      st.guidelines = rows;
      id = "";
      var pref = SMD.preferredChecklist ? SMD.preferredChecklist(pid) : "";
      if (pref) {
        for (i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].id === pref) id = pref;
        }
      }
      if (!id) {
        for (i = 0; i < rows.length; i++) {
          if (rows[i] && rows[i].id === "prisma2020") id = "prisma2020";
        }
      }
      if (!id && rows.length && rows[0] && rows[0].id) id = String(rows[0].id);
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

  function saveManual(num) {
    var box = null;
    var nodes, i, text, pid, gid;
    nodes = D.querySelectorAll("[data-rmd-manual]");
    for (i = 0; i < nodes.length; i++) {
      if (nodes[i].getAttribute("data-rmd-manual") === num) box = nodes[i];
    }
    text = box ? String(box.value || "") : "";
    pid = st.projectId;
    gid = st.guidelineId;
    api("PUT", "/v1/projects/" + encodeURIComponent(pid) + "/checklist-manual/" + encodeURIComponent(gid), { num: num, text: text }).then(function (data) {
      st.manual = (data && data.entries) ? data.entries : st.manual;
      st.error = "";
      st.errObj = null;
      st.csv = "";
      try {
        compute();
      } catch (err) {
        st.error = (err && err.message) ? String(err.message) : "Could not fill the checklist.";
        st.errObj = err || null;
      }
      if (lastContainer) paint(lastContainer);
    }).catch(function (e) {
      st.error = (e && e.message) ? String(e.message) : "Could not save the entry.";
      st.errObj = e || null;
      if (lastContainer) paint(lastContainer);
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
      "#researchMD .rmd-checklist-btn[disabled] { color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-screen :focus-visible { outline: 2px solid var(--rmd-acc, #1b41bf); outline-offset: 2px; }",
      "#researchMD .rmd-checklist-counts { margin: 0 0 12px; font: 600 13px/1.4 var(--rmd-f, system-ui, sans-serif); }",
      "#researchMD .rmd-checklist-note, #researchMD .rmd-checklist-approved { margin: 0 0 12px; color: var(--rmd-mut, #93a4a8); font-size: 13px; }",
      "#researchMD .rmd-checklist-approved { color: var(--rmd-acc, #1b41bf); }",
      "#researchMD .rmd-checklist-banner { margin: 0 0 12px; padding: 10px 12px; border: 1px solid var(--rmd-bad, #ff7b6e); background: var(--rmd-bad-soft, #3a1714); border-radius: 8px; display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }",
      "#researchMD .rmd-checklist-layout { display: grid; grid-template-columns: minmax(0, 1.15fr) minmax(0, 0.85fr); gap: 16px; width: 100%; min-width: 0; }",
      "#researchMD .rmd-checklist-items, #researchMD .rmd-checklist-manuscript { min-width: 0; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-section { margin: 0 0 16px; }",
      "#researchMD .rmd-checklist-section h3, #researchMD .rmd-checklist-manuscript h3 { margin: 0 0 8px; font: 600 13px/1.3 var(--rmd-f, system-ui, sans-serif); color: var(--rmd-mut, #93a4a8); }",
      "#researchMD .rmd-checklist-item { border: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-panel, #fffdf9); border-radius: 10px; padding: 12px; margin: 0 0 10px; min-width: 0; }",
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
      "#researchMD .rmd-checklist-manuscript { border: 1px solid var(--rmd-line, #e5ddce); background: var(--rmd-bg, #f8f1e4); border-radius: 10px; padding: 12px; }",
      "#researchMD .rmd-checklist-ms-section { margin: 0 0 14px; }",
      "#researchMD .rmd-checklist-ms-p { margin: 0 0 8px; overflow-wrap: anywhere; }",
      "#researchMD .rmd-checklist-jump { background: var(--rmd-acc-soft, #e4e9f8); border-radius: 6px; padding: 8px 10px; }",
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

  function itemHtml(it, phone) {
    var h = [];
    var label = statusLabel(it.status);
    var lines, i, shown, n;
    h.push('<article class="rmd-checklist-item" data-rmd-item="' + esc(it.num) + '" data-rmd-field="' + esc(it.projectField) + '">');
    h.push('<div class="rmd-checklist-item-head">');
    h.push('<span class="rmd-checklist-num">' + esc(it.num) + '</span>');
    h.push('<h4>' + esc(it.topic || "Item") + '</h4>');
    h.push('<span class="rmd-checklist-badge rmd-checklist-badge-' + esc(it.status) + '" data-rmd-status="' + esc(it.status) + '">' + esc(label) + '</span>');
    h.push('</div>');
    if (st.ai) h.push(SMD.ai.noteHtml(st.ai, it.num));
    h.push('<p class="rmd-checklist-req">' + esc(it.text) + '</p>');
    h.push('<p class="rmd-checklist-filled">' + esc(it.filled ? it.filled : "Not recorded in the project.") + '</p>');
    lines = it.evidence || [];
    shown = 0;
    for (i = 0; i < lines.length; i++) {
      if (lines[i] && lines[i] !== it.filled) shown++;
    }
    if (shown) {
      h.push('<ul class="rmd-checklist-evidence">');
      for (i = 0; i < lines.length; i++) {
        if (lines[i] && lines[i] !== it.filled) h.push('<li>' + esc(lines[i]) + '</li>');
      }
      h.push('</ul>');
    }
    if (it.pointer && it.pointer.section) {
      n = (it.pointer.paragraph || 0) + 1;
      h.push('<p class="rmd-checklist-pointer">Reported in ' + esc(it.pointer.section) + ', paragraph ' + n + '.</p>');
      h.push('<button type="button" class="rmd-checklist-btn" data-rmd-pointer="' + esc(it.num) + '">Show in manuscript</button>');
    }
    if (!phone && it.projectField === "manual") {
      h.push('<form class="rmd-checklist-field" data-rmd-manual-form="' + esc(it.num) + '" action="" method="post">');
      h.push('<label class="rmd-checklist-label" for="rmdManual_' + esc(it.num) + '">Your entry</label>');
      h.push('<textarea id="rmdManual_' + esc(it.num) + '" name="entry" data-rmd-manual="' + esc(it.num) + '" enterkeyhint="done">' + esc(st.manual[it.num] || "") + '</textarea>');
      h.push('<button type="submit" class="rmd-checklist-btn rmd-checklist-btn-primary" data-rmd-manual-save="' + esc(it.num) + '">Save entry</button>');
      h.push('</form>');
    }
    h.push('</article>');
    return h.join("");
  }

  function manuscriptHtml() {
    var sections = manuscriptSections();
    var h = [];
    var i, p, sec, current;
    h.push('<div class="rmd-checklist-manuscript" id="rmdChecklistManuscript">');
    h.push('<h3>Manuscript</h3>');
    if (!sections.length) {
      h.push('<p class="rmd-checklist-note">No manuscript sections are stored on this project.</p>');
    }
    for (i = 0; i < sections.length; i++) {
      sec = sections[i];
      h.push('<section class="rmd-checklist-ms-section">');
      h.push('<h3>' + esc(sec.heading) + '</h3>');
      for (p = 0; p < sec.paragraphs.length; p++) {
        current = st.jump && st.jump.section === sec.heading && st.jump.paragraph === p;
        h.push('<p class="rmd-checklist-ms-p' + (current ? ' rmd-checklist-jump' : '') + '" data-rmd-ms-section="' + esc(sec.heading) + '" data-rmd-ms-p="' + p + '"' + (current ? ' data-rmd-ms-current="1"' : '') + '>' + esc(sec.paragraphs[p]) + '</p>');
      }
      h.push('</section>');
    }
    h.push('</div>');
    return h.join("");
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
    if (st.approved) {
      h.push('<button type="button" class="rmd-checklist-btn" data-rmd-approve disabled>Approved</button>');
    } else {
      h.push('<button type="button" class="rmd-checklist-btn rmd-checklist-btn-primary" data-rmd-approve>Approve</button>');
    }
    h.push('</div></div>');
    if (st.filled && !st.ai) st.ai = SMD.ai.state();
    if (st.filled && st.ai) h.push(SMD.ai.barHtml(st.ai, { task: "checklist", label: "reporting checklist", cost: 2 }));
    if (phone) h.push('<p class="rmd-checklist-note">On a phone this checklist is view and approve only. Enter manual items on a tablet.</p>');
    if (st.approved) h.push('<p id="rmdChecklistApproved" class="rmd-checklist-approved">Approved on this device. You still upload the pack yourself.</p>');
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
      h.push('<p class="rmd-checklist-counts" aria-live="polite">Filled ' + (counts.auto || 0) + '. Partial ' + (counts.partial || 0) + '. Manual ' + (counts.manual || 0) + '. Missing ' + (counts.missing || 0) + '.</p>');
      h.push('<div class="rmd-checklist-layout">');
      h.push('<div class="rmd-checklist-items">');
      items = st.filled.items || [];
      groups = groupItems(items);
      for (i = 0; i < groups.length; i++) {
        var g = groups[i];
        var j;
        h.push('<section class="rmd-checklist-section" data-rmd-section="' + esc(g.title) + '">');
        h.push('<h3>' + esc(g.title || "Section") + '</h3>');
        for (j = 0; j < g.items.length; j++) h.push(itemHtml(g.items[j], phone));
        h.push('</section>');
      }
      h.push('</div>');
      h.push(manuscriptHtml());
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
  }

  function bind(container) {
    var guide = container.querySelector("#rmdChecklistGuide");
    var exp = container.querySelector("[data-rmd-export]");
    var approve = container.querySelector("[data-rmd-approve]");
    var retry = container.querySelector('[data-rmd="retry"]');
    var jumps = container.querySelectorAll("[data-rmd-pointer]");
    var forms = container.querySelectorAll("[data-rmd-manual-form]");
    var i;
    if (guide) {
      guide.onchange = function () {
        var seq = ++st.seq;
        loadGuideline(st.projectId, guide.value, seq);
      };
    }
    if (exp) exp.onclick = function () { exportCsv(); };
    if (approve && !st.approved) {
      approve.onclick = function () {
        st.approved = true;
        paint(lastContainer);
      };
    }
    if (retry) {
      retry.onclick = function () {
        if (st.projectId) loadAll(st.projectId);
      };
    }
    for (i = 0; i < jumps.length; i++) {
      jumps[i].onclick = function () {
        var num = this.getAttribute("data-rmd-pointer");
        var items = (st.filled && st.filled.items) || [];
        var n, el;
        for (n = 0; n < items.length; n++) {
          if (items[n].num === num && items[n].pointer) {
            st.jump = { section: items[n].pointer.section, paragraph: items[n].pointer.paragraph };
            break;
          }
        }
        paint(lastContainer);
        el = D.querySelector('[data-rmd-ms-current="1"]');
        if (el && el.scrollIntoView) {
          try { el.scrollIntoView({ block: "nearest" }); } catch (e) { el.scrollIntoView(); }
        }
      };
    }
    for (i = 0; i < forms.length; i++) {
      forms[i].onsubmit = function (ev) {
        if (ev && ev.preventDefault) ev.preventDefault();
        saveManual(this.getAttribute("data-rmd-manual-form"));
        return false;
      };
    }
    var manuals = container.querySelectorAll("[data-rmd-manual]");
    for (i = 0; i < manuals.length; i++) {
      manuals[i].oninput = function () { SMD.ai.clearNote(st.ai, this.getAttribute("data-rmd-manual")); };
    }
    if (st.ai) {
      SMD.ai.bind(container, st.ai, {
        pid: st.projectId, task: "checklist", label: "reporting checklist", cost: 2,
        input: function () {
          var items = (st.filled && st.filled.items) || [];
          var slim = [];
          for (var k = 0; k < items.length; k++) {
            slim.push({ num: items[k].num, topic: items[k].topic, text: items[k].text, projectField: items[k].projectField, status: items[k].status });
          }
          return { guideline: st.guidelineId, items: slim, snapshot: st.snapshot || {} };
        },
        apply: function (draft) {
          var d = draft || {};
          var items = d.items || [];
          var filledItems = (st.filled && st.filled.items) || [];
          var byNum = {};
          var k, it, target, text;
          for (k = 0; k < filledItems.length; k++) byNum[filledItems[k].num] = filledItems[k];
          var keys = [];
          for (k = 0; k < items.length; k++) {
            it = items[k];
            var num = it && (it.num || it.itemNum);
            if (!num) continue;
            target = byNum[num];
            if (!target || target.projectField !== "manual") continue;
            text = typeof it.text === "string" ? it.text : (it.status === "covered" && it.section ? "Reported in the " + it.section + " section." : "");
            if (!text) continue;
            st.manual[num] = text;
            keys.push(num);
          }
          if (keys.length) {
            try { compute(); } catch (e) {}
          }
          return keys;
        },
        render: function () { paint(lastContainer); }
      });
    }
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
      if (lastContainer && D.body && D.body.contains(lastContainer)) render(lastContainer);
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
    paint(container);
    bindBreakpoint();
  }

  SMD.screens.checklist = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
