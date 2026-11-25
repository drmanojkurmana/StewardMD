/* StewardMD - ResearchMD Thesis / Study Start Screen (window.SMD_RESEARCH.screens.plan).
 * ES5 only, buildless, mobile-first. Original studies journey step before Protocol.
 * Sample size calculator (0 MaiK tokens), Ethics committee (IEC) application,
 * Consent form (PIS + ICF, bilingual if non-English), CTRI registration fields.
 * Follows ICMR 2017 guidelines and CTRI requirements.
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

  function p2() { return SMD.p2 || {}; }

  var AIMS = [
    { id: "two_proportions", label: "compare two groups on a yes/no outcome" },
    { id: "two_means", label: "compare two groups on a measurement" },
    { id: "single_proportion", label: "estimate how common something is" },
    { id: "single_mean", label: "estimate an average" },
    { id: "correlation", label: "check if two measurements are related" },
    { id: "case_control", label: "Case-control (from an expected odds ratio)" },
    { id: "time_to_event", label: "Time to event (from a hazard ratio)" }
  ];

  var CONSENT_LANGS = [
    "English", "Hindi", "Telugu", "Tamil", "Kannada",
    "Malayalam", "Marathi", "Bengali", "Gujarati"
  ];

  /* Minimal ZIP and DOCX generator for on-device export */
  function xmlEsc(s) {
    return String(s || "")
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&apos;");
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

  function createDocx(title, sections) {
    var parts = [];
    parts.push(docxParagraph(title, true, 32));
    parts.push(docxParagraph("", false, 0));
    for (var i = 0; i < sections.length; i++) {
      var s = sections[i];
      if (s.heading) parts.push(docxParagraph(s.heading, true, 26));
      var lines = String(s.text || "").split("\n");
      for (var j = 0; j < lines.length; j++) {
        parts.push(docxParagraph(lines[j], false, 0));
      }
      parts.push(docxParagraph("", false, 0));
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

  function copyToClipboard(text, container, msg) {
    if (!text) return;
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(function () {
        if (p2().flashNotice) p2().flashNotice(container, msg || "Copied to clipboard.", "info");
      }).catch(function () {
        fallbackCopy(text, container, msg);
      });
    } else {
      fallbackCopy(text, container, msg);
    }
  }

  function fallbackCopy(text, container, msg) {
    var ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    try {
      document.execCommand("copy");
      if (p2().flashNotice) p2().flashNotice(container, msg || "Copied to clipboard.", "info");
    } catch (e) {}
    document.body.removeChild(ta);
  }

  var st = {
    projectId: null,
    aim: "two_proportions",
    ssInputs: {
      p1: 0.30,
      p2: 0.15,
      diff: 5,
      sd: 10,
      p: 0.50,
      precision: 0.05,
      r: 0.30,
      alpha: 0.05,
      power: 0.80,
      ratio: 1,
      dropout: 0.10,
      population: "",
      p0: 0.40,
      or: 2,
      hr: 0.70,
      allocation: 0.50,
      probEvent: 0.70
    },
    ssResult: null,

    /* IEC form state */
    iecOpen: false,
    iecAi: null,
    iecDrafted: {},
    iecData: {
      title: "",
      investigators: "",
      background: "",
      objectives: "",
      design: "",
      setting: "",
      duration: "",
      sampleSize: "",
      inclusion: "",
      exclusion: "",
      methodology: "",
      statisticalAnalysis: "",
      risks: "",
      benefits: "",
      confidentiality: "",
      compensation: "",
      conflictOfInterest: "",
      funding: "",
      consentProcess: "",
      vulnerablePopulations: ""
    },

    /* Consent form state */
    consentOpen: false,
    consentAi: null,
    consentDrafted: {},
    consentLang: "English",
    consentData: {
      title: "",
      purpose: "",
      procedures: "",
      duration: "",
      risks: "",
      benefits: "",
      alternatives: "",
      confidentiality: "",
      voluntary: "",
      contact: "",
      statements: "",
      signatureBlock: ""
    },
    consentTransData: null,

    /* CTRI form state */
    ctriOpen: false,
    ctriAi: null,
    ctriDrafted: {},
    ctriData: {
      publicTitle: "",
      scientificTitle: "",
      studyType: "",
      phase: "",
      condition: "",
      intervention: "",
      comparator: "",
      inclusion: "",
      exclusion: "",
      primaryOutcomeName: "",
      primaryOutcomeTime: "",
      secondaryOutcomes: "",
      targetSampleSize: "",
      sites: "",
      recruitmentStatus: "Not Yet Recruiting",
      ethicsCommittee: "",
      regulatoryClearance: "",
      fundingSource: "",
      briefSummary: ""
    }
  };

  function controlsParagraph() {
    var k = Number(st.ssInputs.ratio) || 1;
    return "Controls were selected from the same source population as the cases (the population that gave rise to the cases). " +
      "We matched on age and sex to control confounding (mixing of effects), avoiding over-matching on factors linked to the exposure. " +
      "We used " + k + " control" + (k === 1 ? "" : "s") + " per case; beyond about 4 controls per case the gain in power (chance of detecting a real difference) flattens.";
  }

  function calculateSampleSize() {
    var ss = G.SMD_RESEARCH_SAMPLESIZE;
    if (!ss) return null;
    var inp = st.ssInputs;
    try {
      if (st.aim === "two_proportions") {
        return ss.twoProportions({
          p1: Number(inp.p1),
          p2: Number(inp.p2),
          alpha: Number(inp.alpha) || 0.05,
          power: Number(inp.power) || 0.80,
          ratio: Number(inp.ratio) || 1,
          dropout: Number(inp.dropout) || 0
        });
      } else if (st.aim === "two_means") {
        return ss.twoMeans({
          diff: Number(inp.diff),
          sd: Number(inp.sd),
          alpha: Number(inp.alpha) || 0.05,
          power: Number(inp.power) || 0.80,
          ratio: Number(inp.ratio) || 1,
          dropout: Number(inp.dropout) || 0
        });
      } else if (st.aim === "single_proportion") {
        var opts = {
          p: Number(inp.p),
          precision: Number(inp.precision),
          alpha: Number(inp.alpha) || 0.05,
          dropout: Number(inp.dropout) || 0
        };
        if (inp.population && Number(inp.population) > 0) opts.population = Number(inp.population);
        return ss.singleProportion(opts);
      } else if (st.aim === "single_mean") {
        return ss.singleMean({
          sd: Number(inp.sd),
          precision: Number(inp.precision),
          alpha: Number(inp.alpha) || 0.05,
          dropout: Number(inp.dropout) || 0
        });
      } else if (st.aim === "correlation") {
        return ss.correlation({
          r: Number(inp.r),
          alpha: Number(inp.alpha) || 0.05,
          power: Number(inp.power) || 0.80,
          dropout: Number(inp.dropout) || 0
        });
      } else if (st.aim === "case_control") {
        return ss.caseControl({
          p0: Number(inp.p0),
          or: Number(inp.or),
          ratio: Number(inp.ratio) || 1,
          alpha: Number(inp.alpha) || 0.05,
          power: Number(inp.power) || 0.80,
          dropout: Number(inp.dropout) || 0
        });
      } else if (st.aim === "time_to_event") {
        return ss.logRankEvents({
          hr: Number(inp.hr),
          alpha: Number(inp.alpha) || 0.05,
          power: Number(inp.power) || 0.80,
          allocation: Number(inp.allocation) || 0.5,
          probEvent: Number(inp.probEvent),
          dropout: Number(inp.dropout) || 0
        });
      }
    } catch (e) {
      return null;
    }
    return null;
  }

  function loadSaved(pid) {
    if (!pid) return;
    try {
      var raw = localStorage.getItem("smd_research_plan_" + pid);
      if (raw) {
        var saved = JSON.parse(raw);
        if (saved.aim) st.aim = saved.aim;
        if (saved.ssInputs) st.ssInputs = Object.assign(st.ssInputs, saved.ssInputs);
        if (saved.iecData) { st.iecData = Object.assign(st.iecData, saved.iecData); st.iecOpen = true; }
        if (saved.iecDrafted) st.iecDrafted = saved.iecDrafted;
        if (saved.consentData) { st.consentData = Object.assign(st.consentData, saved.consentData); st.consentOpen = true; }
        if (saved.consentTransData) st.consentTransData = saved.consentTransData;
        if (saved.consentDrafted) st.consentDrafted = saved.consentDrafted;
        if (saved.consentLang) st.consentLang = saved.consentLang;
        if (saved.ctriData) { st.ctriData = Object.assign(st.ctriData, saved.ctriData); st.ctriOpen = true; }
        if (saved.ctriDrafted) st.ctriDrafted = saved.ctriDrafted;
      }
    } catch (e) {}
  }

  function saveCurrent(pid, container) {
    if (!pid) return;
    var payload = {
      aim: st.aim,
      ssInputs: st.ssInputs,
      iecData: st.iecData,
      iecDrafted: st.iecDrafted,
      consentData: st.consentData,
      consentTransData: st.consentTransData,
      consentDrafted: st.consentDrafted,
      consentLang: st.consentLang,
      ctriData: st.ctriData,
      ctriDrafted: st.ctriDrafted,
      savedAt: Date.now()
    };
    try {
      localStorage.setItem("smd_research_plan_" + pid, JSON.stringify(payload));
      var store = SMD.store;
      var proj = store ? store.getActiveProject() : null;
      if (proj) proj.plan = payload;
      if (p2().flashNotice) p2().flashNotice(container, "Plan saved to this project.", "info");
    } catch (e) {
      if (p2().flashNotice) p2().flashNotice(container, "Could not save plan locally.", "error");
    }
  }

  function noteBadge(drafted, key, val) {
    if (drafted && drafted[key]) {
      return '<span class="rmd-ai-note" data-rmd-ai-note="' + esc(key) + '">Drafted by MaiK, check it</span>';
    }
    if (val === "" || val == null || (Array.isArray(val) && val.length === 0)) {
      return '<span class="rmd-fillin-note" data-rmd-fillin="' + esc(key) + '">Fill this in</span>';
    }
    return "";
  }

  function injectCss() {
    var D = G.document;
    if (!D || D.getElementById("rmdPlanCss")) return;
    var s = D.createElement("style");
    s.id = "rmdPlanCss";
    /* Shared base only forces 44px targets at iPad width and skips date inputs; scope phone fixes here. */
    s.textContent = [
      "#researchMD .rmd-plan-screen .rmd-btn, #researchMD .rmd-plan-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-plan-screen input[type=text], #researchMD .rmd-plan-screen input[type=number], #researchMD .rmd-plan-screen input[type=date], #researchMD .rmd-plan-screen select, #researchMD .rmd-plan-screen textarea { min-height: 44px; }",
      "#researchMD .rmd-plan-screen input[type=date] { width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); }"
    ].join("\n");
    D.head.appendChild(s);
  }

  function render(container) {
    injectCss();
    var store = SMD.store;
    var proj = store ? store.getActiveProject() : null;
    if (!proj) {
      container.innerHTML = '<div class="rmd-empty-state"><h3>No project selected</h3><p>Open a project to plan your study.</p><button type="button" class="rmd-btn rmd-btn-primary" data-rmd="to-projects">Go to Projects</button></div>';
      var toP = container.querySelector('[data-rmd="to-projects"]');
      if (toP) toP.onclick = function () { if (SMD.navigate) SMD.navigate("projects", {}); };
      return;
    }

    if (st.projectId !== proj.id) {
      st.projectId = proj.id;
      loadSaved(proj.id);
    }

    if (!st.iecAi) st.iecAi = SMD.ai ? SMD.ai.state() : { busy: false, error: null, drafted: {} };
    if (!st.consentAi) st.consentAi = SMD.ai ? SMD.ai.state() : { busy: false, error: null, drafted: {} };
    if (!st.ctriAi) st.ctriAi = SMD.ai ? SMD.ai.state() : { busy: false, error: null, drafted: {} };

    st.ssResult = calculateSampleSize();

    var h = [];
    h.push('<div class="rmd-p2-screen rmd-plan-screen">');

    // Header
    h.push('  <div class="rmd-screen-header">');
    h.push('    <div>');
    h.push('      <h2 class="rmd-screen-title">Plan my study</h2>');
    h.push('      <p class="rmd-screen-subtitle">Sample size, ethics committee application, consent form, and trial registry.</p>');
    h.push('    </div>');
    h.push('    <div>');
    h.push('      <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="plan-save">Save plan</button>');
    h.push('    </div>');
    h.push('  </div>');

    // CARD 1: Sample size
    h.push('  <div class="rmd-card" id="rmdCardSampleSize">');
    h.push('    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
    h.push('      <h3 class="rmd-card-heading">Sample size (how many patients you need)</h3>');
    h.push('      <span class="rmd-badge rmd-badge-pill" style="font-weight:600;">0 MaiK tokens</span>');
    h.push('    </div>');

    // Study aim picker
    h.push('    <div class="rmd-field">');
    h.push('      <label for="rmd_ss_aim">Pick the study aim in plain words <span class="rmd-req">*</span></label>');
    h.push('      <select id="rmd_ss_aim">');
    for (var a = 0; a < AIMS.length; a++) {
      var sel = st.aim === AIMS[a].id ? ' selected="selected"' : "";
      h.push('        <option value="' + esc(AIMS[a].id) + '"' + sel + '>' + esc(AIMS[a].label) + '</option>');
    }
    h.push('      </select>');
    h.push('    </div>');

    // Dynamic inputs
    var inp = st.ssInputs;
    h.push('    <div class="rmd-form-row">');
    if (st.aim === "two_proportions") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_p1">Group 1 proportion (p1) (e.g. 0.30 for 30%)</label>');
      h.push('        <input type="number" id="rmd_ss_p1" step="0.01" min="0.001" max="0.999" value="' + esc(inp.p1) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_p2">Group 2 proportion (p2) (e.g. 0.15 for 15%)</label>');
      h.push('        <input type="number" id="rmd_ss_p2" step="0.01" min="0.001" max="0.999" value="' + esc(inp.p2) + '">');
      h.push('      </div>');
    } else if (st.aim === "two_means") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_diff">Difference to detect (diff)</label>');
      h.push('        <input type="number" id="rmd_ss_diff" step="0.1" value="' + esc(inp.diff) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_sd">Standard deviation (SD) (spread of measurement)</label>');
      h.push('        <input type="number" id="rmd_ss_sd" step="0.1" min="0.001" value="' + esc(inp.sd) + '">');
      h.push('      </div>');
    } else if (st.aim === "single_proportion") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_p">Expected proportion (p) (e.g. 0.50 for 50%)</label>');
      h.push('        <input type="number" id="rmd_ss_p" step="0.01" min="0.001" max="0.999" value="' + esc(inp.p) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_prec">Absolute precision (e.g. 0.05 for 5%)</label>');
      h.push('        <input type="number" id="rmd_ss_prec" step="0.01" min="0.001" max="0.5" value="' + esc(inp.precision) + '">');
      h.push('      </div>');
    } else if (st.aim === "single_mean") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_sd">Standard deviation (SD) (spread of measurement)</label>');
      h.push('        <input type="number" id="rmd_ss_sd" step="0.1" min="0.001" value="' + esc(inp.sd) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_prec">Absolute precision</label>');
      h.push('        <input type="number" id="rmd_ss_prec" step="0.1" min="0.001" value="' + esc(inp.precision) + '">');
      h.push('      </div>');
    } else if (st.aim === "correlation") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_r">Expected correlation (r) (-1 to 1, non-zero)</label>');
      h.push('        <input type="number" id="rmd_ss_r" step="0.05" min="-0.999" max="0.999" value="' + esc(inp.r) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_power">Power (chance of detecting a real difference)</label>');
      h.push('        <input type="number" id="rmd_ss_power" step="0.05" min="0.5" max="0.999" value="' + esc(inp.power) + '">');
      h.push('      </div>');
    } else if (st.aim === "case_control") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_p0">Exposure in controls (p0) (e.g. 0.40 for 40%)</label>');
      h.push('        <input type="number" id="rmd_ss_p0" step="0.01" min="0.001" max="0.999" value="' + esc(inp.p0) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_or">Expected odds ratio (OR) (must differ from 1)</label>');
      h.push('        <input type="number" id="rmd_ss_or" step="0.1" min="0.01" value="' + esc(inp.or) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_ratio">Controls per case (gains flatten beyond 4)</label>');
      h.push('        <input type="number" id="rmd_ss_ratio" step="1" min="1" max="10" value="' + esc(inp.ratio) + '">');
      h.push('      </div>');
    } else if (st.aim === "time_to_event") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_hr">Expected hazard ratio (HR) (must differ from 1)</label>');
      h.push('        <input type="number" id="rmd_ss_hr" step="0.05" min="0.01" value="' + esc(inp.hr) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_probev">Chance of the event happening (e.g. 0.70 for 70%)</label>');
      h.push('        <input type="number" id="rmd_ss_probev" step="0.05" min="0.01" max="0.999" value="' + esc(inp.probEvent) + '">');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_alloc">Share in group 1 (allocation) (e.g. 0.50 for equal groups)</label>');
      h.push('        <input type="number" id="rmd_ss_alloc" step="0.05" min="0.05" max="0.95" value="' + esc(inp.allocation) + '">');
      h.push('      </div>');
    }
    h.push('    </div>');

    // Second row: alpha, power/ratio, dropout
    h.push('    <div class="rmd-form-row">');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ss_alpha">Significance (alpha) (false positive risk)</label>');
    h.push('        <input type="number" id="rmd_ss_alpha" step="0.01" min="0.001" max="0.2" value="' + esc(inp.alpha) + '">');
    h.push('      </div>');
    if (st.aim === "two_proportions" || st.aim === "two_means" || st.aim === "case_control" || st.aim === "time_to_event") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_power">Power (chance of detecting a real difference)</label>');
      h.push('        <input type="number" id="rmd_ss_power" step="0.05" min="0.5" max="0.999" value="' + esc(inp.power) + '">');
      h.push('      </div>');
    }
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ss_dropout">Loss to follow-up (dropout) (e.g. 0.10 for 10%)</label>');
    h.push('        <input type="number" id="rmd_ss_dropout" step="0.05" min="0" max="0.5" value="' + esc(inp.dropout) + '">');
    h.push('      </div>');
    if (st.aim === "single_proportion") {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_ss_pop">Total population (leave blank for infinite)</label>');
      h.push('        <input type="number" id="rmd_ss_pop" min="10" placeholder="Optional" value="' + esc(inp.population) + '">');
      h.push('      </div>');
    }
    h.push('    </div>');

    // Live result
    if (st.ssResult && st.ssResult.ok === false) {
      h.push('    <div class="rmd-banner rmd-banner-warn" style="margin-top:8px;">');
      h.push('      <p style="margin:0;">' + esc((st.ssResult.warnings || []).join(" ")) + '</p>');
      h.push('    </div>');
    } else if (st.ssResult) {
      var r = st.ssResult;
      h.push('    <div class="rmd-data-box" style="margin-top:8px;">');
      h.push('      <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
      if (r.cases != null) {
        h.push('        <div><strong style="font-size:16px;">' + r.cases + ' cases</strong> <span class="rmd-mut">and ' + r.controls + ' controls (' + r.total + ' total)</span></div>');
      } else if (r.events != null) {
        h.push('        <div><strong style="font-size:16px;">' + r.events + ' events</strong> <span class="rmd-mut">(' + r.total + ' patients total)</span></div>');
      } else if (r.nPerGroup) {
        h.push('        <div><strong style="font-size:16px;">' + r.nPerGroup + ' per group</strong> <span class="rmd-mut">(' + r.total + ' total)</span></div>');
        if (r.withDropout) {
          h.push('        <div><span class="rmd-mut">With ' + Math.round((Number(inp.dropout) || 0) * 100) + '% loss to follow-up:</span> <strong>' + r.withDropout.nPerGroup + ' per group</strong> <span class="rmd-mut">(' + r.withDropout.total + ' total)</span></div>');
        }
      } else {
        h.push('        <div><strong style="font-size:16px;">' + r.n + ' total</strong></div>');
        if (r.withDropout) {
          h.push('        <div><span class="rmd-mut">With ' + Math.round((Number(inp.dropout) || 0) * 100) + '% loss to follow-up:</span> <strong>' + r.withDropout.n + ' total</strong></div>');
        }
      }
      h.push('      </div>');
      if (r.method) {
        h.push('      <div style="font-size:12.5px;color:var(--rmd-mut);margin-top:4px;">Method: ' + esc(r.method) + '</div>');
      }
      if (r.continuityCorrected) {
        h.push('      <div style="font-size:12.5px;color:var(--rmd-mut);margin-top:4px;">');
        h.push('        Continuity-corrected: ' + r.continuityCorrected.nPerGroup + ' per group (' + r.continuityCorrected.total + ' total; ' + (r.continuityCorrected.withDropout ? r.continuityCorrected.withDropout.total : '') + ' with dropout)');
        h.push('      </div>');
      }
      h.push('      <div class="rmd-quote-block" style="margin-top:10px;">');
      h.push('        <div class="rmd-quote-tag">Synopsis paragraph</div>');
      h.push('        <blockquote id="rmd_ss_paragraph">' + esc(r.paragraph) + '</blockquote>');
      h.push('      </div>');
      h.push('      <div style="display:flex;justify-content:flex-end;margin-top:8px;">');
      h.push('        <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="ss-copy">Copy paragraph</button>');
      h.push('      </div>');
      h.push('    </div>');
    }
    h.push('  </div>'); // End Card 1

    // CARD 1b: Choosing controls (case-control guidance, 0 MaiK tokens)
    h.push('  <div class="rmd-card" id="rmdCardControls">');
    h.push('    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
    h.push('      <h3 class="rmd-card-heading">Choosing controls (who to compare against)</h3>');
    h.push('      <span class="rmd-badge rmd-badge-pill" style="font-weight:600;">0 MaiK tokens</span>');
    h.push('    </div>');
    h.push('    <ul class="rmd-list" style="margin:8px 0 0;">');
    h.push('      <li>Source of controls: pick controls from the same source population (the population that gave rise to the cases), not from a different hospital or clinic.</li>');
    h.push('      <li>Matching on age and sex removes their confounding (mixing of effects); do not over-match on factors tied to the exposure, or you hide the very link you are studying.</li>');
    h.push('      <li>Controls per case: each extra control adds power (chance of detecting a real difference), but the gain flattens beyond about 4 controls per case.</li>');
    h.push('    </ul>');
    h.push('    <div class="rmd-quote-block" style="margin-top:10px;">');
    h.push('      <div class="rmd-quote-tag">Methods paragraph</div>');
    h.push('      <blockquote id="rmd_controls_paragraph">' + esc(controlsParagraph()) + '</blockquote>');
    h.push('    </div>');
    h.push('    <div style="display:flex;justify-content:flex-end;margin-top:8px;">');
    h.push('      <button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd="controls-copy">Copy paragraph</button>');
    h.push('    </div>');
    h.push('  </div>'); // End Card 1b

    // CARD 2: Ethics committee (IEC) application
    h.push('  <div class="rmd-card" id="rmdCardIec">');
    h.push('    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
    h.push('      <h3 class="rmd-card-heading">Ethics committee (IEC) application</h3>');
    h.push('      <span class="rmd-badge rmd-badge-neutral">ICMR 2017</span>');
    h.push('    </div>');
    h.push(SMD.ai ? SMD.ai.barHtml(st.iecAi, { task: "iec_application", label: "ethics application", cost: 2 }) : "");
    h.push('    <div class="rmd-iec-form rmd-form"' + (st.iecOpen ? '' : ' style="display:none;"') + '>');
    var id = st.iecData;
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_title">Study title <span class="rmd-req">*</span></label>');
    h.push('        <input type="text" id="rmd_iec_title" data-iec="title" value="' + esc(id.title) + '">' + noteBadge(st.iecDrafted, "title", id.title));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_investigators">Investigators</label>');
    h.push('        <textarea id="rmd_iec_investigators" data-iec="investigators" rows="2" placeholder="Principal Investigator, Co-investigators">' + esc(id.investigators) + '</textarea>' + noteBadge(st.iecDrafted, "investigators", id.investigators));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_bg">Background and rationale <span class="rmd-req">*</span></label>');
    h.push('        <textarea id="rmd_iec_bg" data-iec="background" rows="3">' + esc(id.background) + '</textarea>' + noteBadge(st.iecDrafted, "background", id.background));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_obj">Objectives (one per line)</label>');
    h.push('        <textarea id="rmd_iec_obj" data-iec="objectives" rows="3">' + esc(id.objectives) + '</textarea>' + noteBadge(st.iecDrafted, "objectives", id.objectives));
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_design">Study design</label>');
    h.push('          <input type="text" id="rmd_iec_design" data-iec="design" value="' + esc(id.design) + '">' + noteBadge(st.iecDrafted, "design", id.design));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_setting">Setting / institution</label>');
    h.push('          <input type="text" id="rmd_iec_setting" data-iec="setting" value="' + esc(id.setting) + '">' + noteBadge(st.iecDrafted, "setting", id.setting));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_dur">Study duration</label>');
    h.push('          <input type="text" id="rmd_iec_dur" data-iec="duration" value="' + esc(id.duration) + '">' + noteBadge(st.iecDrafted, "duration", id.duration));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_ss">Sample size calculation</label>');
    h.push('          <input type="text" id="rmd_iec_ss" data-iec="sampleSize" value="' + esc(id.sampleSize || (st.ssResult ? st.ssResult.paragraph : "")) + '">' + noteBadge(st.iecDrafted, "sampleSize", id.sampleSize));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_inc">Inclusion criteria</label>');
    h.push('        <textarea id="rmd_iec_inc" data-iec="inclusion" rows="2">' + esc(id.inclusion) + '</textarea>' + noteBadge(st.iecDrafted, "inclusion", id.inclusion));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_exc">Exclusion criteria</label>');
    h.push('        <textarea id="rmd_iec_exc" data-iec="exclusion" rows="2">' + esc(id.exclusion) + '</textarea>' + noteBadge(st.iecDrafted, "exclusion", id.exclusion));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_meth">Methodology</label>');
    h.push('        <textarea id="rmd_iec_meth" data-iec="methodology" rows="3">' + esc(id.methodology) + '</textarea>' + noteBadge(st.iecDrafted, "methodology", id.methodology));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_stat">Statistical analysis</label>');
    h.push('        <textarea id="rmd_iec_stat" data-iec="statisticalAnalysis" rows="2">' + esc(id.statisticalAnalysis) + '</textarea>' + noteBadge(st.iecDrafted, "statisticalAnalysis", id.statisticalAnalysis));
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_risks">Potential risks and mitigation</label>');
    h.push('          <textarea id="rmd_iec_risks" data-iec="risks" rows="2">' + esc(id.risks) + '</textarea>' + noteBadge(st.iecDrafted, "risks", id.risks));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_ben">Potential benefits</label>');
    h.push('          <textarea id="rmd_iec_ben" data-iec="benefits" rows="2">' + esc(id.benefits) + '</textarea>' + noteBadge(st.iecDrafted, "benefits", id.benefits));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_conf">Confidentiality safeguards</label>');
    h.push('          <input type="text" id="rmd_iec_conf" data-iec="confidentiality" value="' + esc(id.confidentiality) + '">' + noteBadge(st.iecDrafted, "confidentiality", id.confidentiality));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_comp">Compensation for injury</label>');
    h.push('          <input type="text" id="rmd_iec_comp" data-iec="compensation" value="' + esc(id.compensation) + '">' + noteBadge(st.iecDrafted, "compensation", id.compensation));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_coi">Conflict of interest</label>');
    h.push('          <input type="text" id="rmd_iec_coi" data-iec="conflictOfInterest" value="' + esc(id.conflictOfInterest) + '">' + noteBadge(st.iecDrafted, "conflictOfInterest", id.conflictOfInterest));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_iec_fund">Funding source</label>');
    h.push('          <input type="text" id="rmd_iec_fund" data-iec="funding" value="' + esc(id.funding) + '">' + noteBadge(st.iecDrafted, "funding", id.funding));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_proc">Consent process</label>');
    h.push('        <textarea id="rmd_iec_proc" data-iec="consentProcess" rows="2">' + esc(id.consentProcess) + '</textarea>' + noteBadge(st.iecDrafted, "consentProcess", id.consentProcess));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_iec_vuln">Vulnerable populations safeguards</label>');
    h.push('        <input type="text" id="rmd_iec_vuln" data-iec="vulnerablePopulations" value="' + esc(id.vulnerablePopulations) + '">' + noteBadge(st.iecDrafted, "vulnerablePopulations", id.vulnerablePopulations));
    h.push('      </div>');
    h.push('      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="iec-copy">Copy</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="iec-docx">Download (DOCX)</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="iec-save">Save</button>');
    h.push('      </div>');
    h.push('    </div>');
    h.push('  </div>'); // End Card 2

    // CARD 3: Consent form (PIS + ICF)
    h.push('  <div class="rmd-card" id="rmdCardConsent">');
    h.push('    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
    h.push('      <h3 class="rmd-card-heading">Consent form (participant information sheet + informed consent)</h3>');
    h.push('      <div style="display:flex;align-items:center;gap:6px;">');
    h.push('        <label for="rmd_consent_lang" style="font-size:12px;color:var(--rmd-mut);">Language:</label>');
    h.push('        <select id="rmd_consent_lang" style="width:auto;padding:4px 8px;font-size:13px;">');
    for (var l = 0; l < CONSENT_LANGS.length; l++) {
      var lsel = st.consentLang === CONSENT_LANGS[l] ? ' selected="selected"' : "";
      h.push('          <option value="' + esc(CONSENT_LANGS[l]) + '"' + lsel + '>' + esc(CONSENT_LANGS[l]) + '</option>');
    }
    h.push('        </select>');
    h.push('      </div>');
    h.push('    </div>');
    h.push(SMD.ai ? SMD.ai.barHtml(st.consentAi, { task: "consent_form", label: "consent form", cost: 2 }) : "");
    h.push('    <div class="rmd-consent-form rmd-form"' + (st.consentOpen ? '' : ' style="display:none;"') + '>');
    var cd = st.consentData;

    // If non-English with both versions available
    if (st.consentLang !== "English" && st.consentTransData) {
      h.push('      <div class="rmd-sub-card">');
      h.push('        <h4 style="margin:0;font-size:14px;color:var(--rmd-acc);">English version</h4>');
      h.push('        <div class="rmd-field"><label>Title:</label><div class="rmd-consent-preview" id="rmd_eng_title">' + esc(cd.title) + '</div></div>');
      h.push('        <div class="rmd-field"><label>Purpose:</label><div class="rmd-consent-preview" id="rmd_eng_purpose">' + esc(cd.purpose) + '</div></div>');
      h.push('        <div class="rmd-field"><label>Procedures:</label><div class="rmd-consent-preview">' + esc(cd.procedures) + '</div></div>');
      h.push('      </div>');

      var td = st.consentTransData;
      h.push('      <div class="rmd-sub-card" style="margin-top:10px;">');
      h.push('        <h4 style="margin:0;font-size:14px;color:var(--rmd-acc);">' + esc(st.consentLang) + ' version</h4>');
      h.push('        <div class="rmd-field"><label>Title:</label><input type="text" id="rmd_trans_title" data-consent-trans="title" value="' + esc(td.title) + '">' + noteBadge(st.consentDrafted, "trans_title", td.title) + '</div>');
      h.push('        <div class="rmd-field"><label>Purpose:</label><textarea id="rmd_trans_purpose" data-consent-trans="purpose" rows="2">' + esc(td.purpose) + '</textarea>' + noteBadge(st.consentDrafted, "trans_purpose", td.purpose) + '</div>');
      h.push('        <div class="rmd-field"><label>Procedures:</label><textarea id="rmd_trans_proc" data-consent-trans="procedures" rows="2">' + esc(td.procedures) + '</textarea>' + noteBadge(st.consentDrafted, "trans_procedures", td.procedures) + '</div>');
      h.push('        <div class="rmd-field"><label>Risks:</label><textarea data-consent-trans="risks" rows="2">' + esc(td.risks) + '</textarea></div>');
      h.push('        <div class="rmd-field"><label>Benefits:</label><textarea data-consent-trans="benefits" rows="2">' + esc(td.benefits) + '</textarea></div>');
      h.push('        <div class="rmd-field"><label>Voluntary participation:</label><textarea data-consent-trans="voluntary" rows="2">' + esc(td.voluntary) + '</textarea></div>');
      h.push('        <div class="rmd-field"><label>Contact details:</label><input type="text" data-consent-trans="contact" value="' + esc(td.contact) + '">' + noteBadge(st.consentDrafted, "contact", td.contact) + '</div>');
      h.push('        <div class="rmd-field"><label>Statements:</label><textarea data-consent-trans="statements" rows="3">' + esc(td.statements) + '</textarea></div>');
      h.push('        <div class="rmd-field"><label>Signature block:</label><input type="text" data-consent-trans="signatureBlock" value="' + esc(td.signatureBlock) + '"></div>');
      h.push('      </div>');
    } else {
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_title">Information sheet title <span class="rmd-req">*</span></label>');
      h.push('        <input type="text" id="rmd_consent_title" data-consent="title" value="' + esc(cd.title) + '">' + noteBadge(st.consentDrafted, "title", cd.title));
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_purpose">Purpose of study</label>');
      h.push('        <textarea id="rmd_consent_purpose" data-consent="purpose" rows="2">' + esc(cd.purpose) + '</textarea>' + noteBadge(st.consentDrafted, "purpose", cd.purpose));
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_proc">Study procedures</label>');
      h.push('        <textarea id="rmd_consent_proc" data-consent="procedures" rows="2">' + esc(cd.procedures) + '</textarea>' + noteBadge(st.consentDrafted, "procedures", cd.procedures));
      h.push('      </div>');
      h.push('      <div class="rmd-form-row">');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_dur">Duration of participation</label>');
      h.push('          <input type="text" id="rmd_consent_dur" data-consent="duration" value="' + esc(cd.duration) + '">' + noteBadge(st.consentDrafted, "duration", cd.duration));
      h.push('        </div>');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_contact">Contact for queries</label>');
      h.push('          <input type="text" id="rmd_consent_contact" data-consent="contact" value="' + esc(cd.contact) + '">' + noteBadge(st.consentDrafted, "contact", cd.contact));
      h.push('        </div>');
      h.push('      </div>');
      h.push('      <div class="rmd-form-row">');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_risks">Potential risks / discomforts</label>');
      h.push('          <textarea id="rmd_consent_risks" data-consent="risks" rows="2">' + esc(cd.risks) + '</textarea>' + noteBadge(st.consentDrafted, "risks", cd.risks));
      h.push('        </div>');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_ben">Potential benefits</label>');
      h.push('          <textarea id="rmd_consent_ben" data-consent="benefits" rows="2">' + esc(cd.benefits) + '</textarea>' + noteBadge(st.consentDrafted, "benefits", cd.benefits));
      h.push('        </div>');
      h.push('      </div>');
      h.push('      <div class="rmd-form-row">');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_alt">Alternative treatments</label>');
      h.push('          <input type="text" id="rmd_consent_alt" data-consent="alternatives" value="' + esc(cd.alternatives) + '">' + noteBadge(st.consentDrafted, "alternatives", cd.alternatives));
      h.push('        </div>');
      h.push('        <div class="rmd-field">');
      h.push('          <label for="rmd_consent_conf">Confidentiality assurance</label>');
      h.push('          <input type="text" id="rmd_consent_conf" data-consent="confidentiality" value="' + esc(cd.confidentiality) + '">' + noteBadge(st.consentDrafted, "confidentiality", cd.confidentiality));
      h.push('        </div>');
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_vol">Voluntary participation statement</label>');
      h.push('        <textarea id="rmd_consent_vol" data-consent="voluntary" rows="2">' + esc(cd.voluntary) + '</textarea>' + noteBadge(st.consentDrafted, "voluntary", cd.voluntary));
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_stmts">Consent statements (one per line)</label>');
      h.push('        <textarea id="rmd_consent_stmts" data-consent="statements" rows="3">' + esc(cd.statements) + '</textarea>' + noteBadge(st.consentDrafted, "statements", cd.statements));
      h.push('      </div>');
      h.push('      <div class="rmd-field">');
      h.push('        <label for="rmd_consent_sig">Signature block</label>');
      h.push('        <input type="text" id="rmd_consent_sig" data-consent="signatureBlock" value="' + esc(cd.signatureBlock) + '">' + noteBadge(st.consentDrafted, "signatureBlock", cd.signatureBlock));
      h.push('      </div>');
    }
    h.push('      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="consent-copy">Copy</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="consent-docx">Download (DOCX)</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="consent-save">Save</button>');
    h.push('      </div>');
    h.push('    </div>');
    h.push('  </div>'); // End Card 3

    // CARD 4: CTRI registration
    h.push('  <div class="rmd-card" id="rmdCardCtri">');
    h.push('    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;flex-wrap:wrap;">');
    h.push('      <h3 class="rmd-card-heading">CTRI registration</h3>');
    h.push('      <span class="rmd-badge rmd-badge-neutral">Clinical Trials Registry - India</span>');
    h.push('    </div>');
    h.push(SMD.ai ? SMD.ai.barHtml(st.ctriAi, { task: "ctri_fields", label: "CTRI fields", cost: 2 }) : "");
    h.push('    <div class="rmd-ctri-form rmd-form"' + (st.ctriOpen ? '' : ' style="display:none;"') + '>');
    var ctd = st.ctriData;
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ctri_pub">Public title <span class="rmd-req">*</span></label>');
    h.push('        <input type="text" id="rmd_ctri_pub" data-ctri="publicTitle" value="' + esc(ctd.publicTitle) + '">' + noteBadge(st.ctriDrafted, "publicTitle", ctd.publicTitle));
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ctri_sci">Scientific title <span class="rmd-req">*</span></label>');
    h.push('        <input type="text" id="rmd_ctri_sci" data-ctri="scientificTitle" value="' + esc(ctd.scientificTitle) + '">' + noteBadge(st.ctriDrafted, "scientificTitle", ctd.scientificTitle));
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_type">Study type</label>');
    h.push('          <input type="text" id="rmd_ctri_type" data-ctri="studyType" value="' + esc(ctd.studyType) + '">' + noteBadge(st.ctriDrafted, "studyType", ctd.studyType));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_phase">Phase</label>');
    h.push('          <input type="text" id="rmd_ctri_phase" data-ctri="phase" value="' + esc(ctd.phase) + '">' + noteBadge(st.ctriDrafted, "phase", ctd.phase));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ctri_cond">Condition</label>');
    h.push('        <input type="text" id="rmd_ctri_cond" data-ctri="condition" value="' + esc(ctd.condition) + '">' + noteBadge(st.ctriDrafted, "condition", ctd.condition));
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_int">Intervention</label>');
    h.push('          <textarea id="rmd_ctri_int" data-ctri="intervention" rows="2">' + esc(ctd.intervention) + '</textarea>' + noteBadge(st.ctriDrafted, "intervention", ctd.intervention));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_cmp">Comparator</label>');
    h.push('          <textarea id="rmd_ctri_cmp" data-ctri="comparator" rows="2">' + esc(ctd.comparator) + '</textarea>' + noteBadge(st.ctriDrafted, "comparator", ctd.comparator));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_inc">Inclusion criteria</label>');
    h.push('          <textarea id="rmd_ctri_inc" data-ctri="inclusion" rows="2">' + esc(ctd.inclusion) + '</textarea>' + noteBadge(st.ctriDrafted, "inclusion", ctd.inclusion));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_exc">Exclusion criteria</label>');
    h.push('          <textarea id="rmd_ctri_exc" data-ctri="exclusion" rows="2">' + esc(ctd.exclusion) + '</textarea>' + noteBadge(st.ctriDrafted, "exclusion", ctd.exclusion));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_po_name">Primary outcome</label>');
    h.push('          <input type="text" id="rmd_ctri_po_name" data-ctri="primaryOutcomeName" value="' + esc(ctd.primaryOutcomeName) + '">' + noteBadge(st.ctriDrafted, "primaryOutcomeName", ctd.primaryOutcomeName));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_po_time">Primary outcome timepoint</label>');
    h.push('          <input type="text" id="rmd_ctri_po_time" data-ctri="primaryOutcomeTime" value="' + esc(ctd.primaryOutcomeTime) + '">' + noteBadge(st.ctriDrafted, "primaryOutcomeTime", ctd.primaryOutcomeTime));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ctri_so">Secondary outcomes</label>');
    h.push('        <textarea id="rmd_ctri_so" data-ctri="secondaryOutcomes" rows="2">' + esc(ctd.secondaryOutcomes) + '</textarea>' + noteBadge(st.ctriDrafted, "secondaryOutcomes", ctd.secondaryOutcomes));
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_n">Target sample size</label>');
    h.push('          <input type="text" id="rmd_ctri_n" data-ctri="targetSampleSize" value="' + esc(ctd.targetSampleSize || (st.ssResult ? (st.ssResult.withDropout ? st.ssResult.withDropout.total : st.ssResult.total) : "")) + '">' + noteBadge(st.ctriDrafted, "targetSampleSize", ctd.targetSampleSize));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_sites">Study sites</label>');
    h.push('          <input type="text" id="rmd_ctri_sites" data-ctri="sites" value="' + esc(ctd.sites) + '">' + noteBadge(st.ctriDrafted, "sites", ctd.sites));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_status">Recruitment status</label>');
    h.push('          <input type="text" id="rmd_ctri_status" data-ctri="recruitmentStatus" value="' + esc(ctd.recruitmentStatus) + '" readonly="readonly">');
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_fund">Funding source</label>');
    h.push('          <input type="text" id="rmd_ctri_fund" data-ctri="fundingSource" value="' + esc(ctd.fundingSource) + '">' + noteBadge(st.ctriDrafted, "fundingSource", ctd.fundingSource));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-form-row">');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_ec">Ethics committee approval details</label>');
    h.push('          <input type="text" id="rmd_ctri_ec" data-ctri="ethicsCommittee" placeholder="Approval number, committee name" value="' + esc(ctd.ethicsCommittee) + '">' + noteBadge(st.ctriDrafted, "ethicsCommittee", ctd.ethicsCommittee));
    h.push('        </div>');
    h.push('        <div class="rmd-field">');
    h.push('          <label for="rmd_ctri_reg">Regulatory clearance details</label>');
    h.push('          <input type="text" id="rmd_ctri_reg" data-ctri="regulatoryClearance" placeholder="DCGI approval number or exempt status" value="' + esc(ctd.regulatoryClearance) + '">' + noteBadge(st.ctriDrafted, "regulatoryClearance", ctd.regulatoryClearance));
    h.push('        </div>');
    h.push('      </div>');
    h.push('      <div class="rmd-field">');
    h.push('        <label for="rmd_ctri_sum">Brief summary (max 300 words)</label>');
    h.push('        <textarea id="rmd_ctri_sum" data-ctri="briefSummary" rows="3">' + esc(ctd.briefSummary) + '</textarea>' + noteBadge(st.ctriDrafted, "briefSummary", ctd.briefSummary));
    h.push('      </div>');
    h.push('      <div style="display:flex;gap:8px;justify-content:flex-end;margin-top:10px;flex-wrap:wrap;">');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="ctri-copy">Copy</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd="ctri-docx">Download (DOCX)</button>');
    h.push('        <button type="button" class="rmd-btn rmd-btn-primary" data-rmd="ctri-save">Save</button>');
    h.push('      </div>');
    h.push('    </div>');
    h.push('  </div>'); // End Card 4

    // Under CTRI card notice
    h.push('  <p class="rmd-field-hint" style="margin:2px 4px 16px;">Register on ctri.nic.in before enrolling the first patient (required for clinical trials in India).</p>');

    h.push('  <p class="rmd-next-line">Next: Protocol (the full study plan).</p>');

    h.push('</div>'); // End screen

    container.innerHTML = h.join("\n");
    bindEvents(container, proj);
  }

  function bindEvents(container, proj) {
    var on = function (sel, fn) {
      var els = container.querySelectorAll(sel);
      for (var i = 0; i < els.length; i++) els[i].onclick = fn;
    };

    // Global Save plan
    on('[data-rmd="plan-save"]', function () { saveCurrent(proj.id, container); });

    // Sample size aim change
    var aimSel = container.querySelector("#rmd_ss_aim");
    if (aimSel) {
      aimSel.onchange = function () {
        st.aim = this.value;
        render(container);
      };
    }

    // Sample size inputs
    var ssFields = [
      { id: "rmd_ss_p1", k: "p1" },
      { id: "rmd_ss_p2", k: "p2" },
      { id: "rmd_ss_diff", k: "diff" },
      { id: "rmd_ss_sd", k: "sd" },
      { id: "rmd_ss_p", k: "p" },
      { id: "rmd_ss_prec", k: "precision" },
      { id: "rmd_ss_r", k: "r" },
      { id: "rmd_ss_alpha", k: "alpha" },
      { id: "rmd_ss_power", k: "power" },
      { id: "rmd_ss_dropout", k: "dropout" },
      { id: "rmd_ss_pop", k: "population" },
      { id: "rmd_ss_p0", k: "p0" },
      { id: "rmd_ss_or", k: "or" },
      { id: "rmd_ss_ratio", k: "ratio" },
      { id: "rmd_ss_hr", k: "hr" },
      { id: "rmd_ss_probev", k: "probEvent" },
      { id: "rmd_ss_alloc", k: "allocation" }
    ];
    for (var i = 0; i < ssFields.length; i++) {
      (function (item) {
        var el = container.querySelector("#" + item.id);
        if (el) {
          el.oninput = function () {
            st.ssInputs[item.k] = this.value;
            st.ssResult = calculateSampleSize();
            render(container);
          };
        }
      })(ssFields[i]);
    }

    // Copy Sample Size synopsis
    on('[data-rmd="ss-copy"]', function () {
      if (st.ssResult && st.ssResult.paragraph) {
        copyToClipboard(st.ssResult.paragraph, container, "Synopsis paragraph copied.");
      }
    });

    // Copy Choosing controls methods paragraph
    on('[data-rmd="controls-copy"]', function () {
      copyToClipboard(controlsParagraph(), container, "Methods paragraph copied.");
    });

    // IEC Form inputs
    var iecInputs = container.querySelectorAll("[data-iec]");
    for (var j = 0; j < iecInputs.length; j++) {
      (function (inpEl) {
        inpEl.oninput = function () {
          var k = inpEl.getAttribute("data-iec");
          st.iecData[k] = inpEl.value;
          delete st.iecDrafted[k];
          var note = container.querySelector('[data-rmd-ai-note="' + k + '"]');
          if (note && note.parentNode) note.parentNode.removeChild(note);
          var fillNote = container.querySelector('[data-rmd-fillin="' + k + '"]');
          if (fillNote && fillNote.parentNode && inpEl.value.trim()) fillNote.parentNode.removeChild(fillNote);
        };
      })(iecInputs[j]);
    }

    // IEC AI Bind
    var cardIec = container.querySelector("#rmdCardIec");
    if (cardIec && SMD.ai) {
      var manualBtn = cardIec.querySelector('[data-rmd-ai="manual"]');
      if (manualBtn) {
        manualBtn.onclick = function () {
          st.iecOpen = true;
          render(container);
          var firstInp = container.querySelector("#rmd_iec_title");
          if (firstInp && firstInp.focus) firstInp.focus();
        };
      }
      var askBtn = cardIec.querySelector('[data-rmd-ai="ask"]');
      if (askBtn) {
        askBtn.onclick = function () {
          if (st.iecAi.busy) return;
          st.iecAi.busy = true;
          st.iecAi.error = null;
          render(container);
          var body = {
            task: "iec_application",
            input: {
              sampleSize: st.ssResult ? { n: st.ssResult.nPerGroup || st.ssResult.n, total: (st.ssResult.withDropout ? st.ssResult.withDropout.total : st.ssResult.total), paragraph: st.ssResult.paragraph } : null
            }
          };
          SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(proj.id) + "/ai-draft", body)
            .then(function (res) {
              st.iecAi.busy = false;
              st.iecOpen = true;
              var d = res && res.draft ? res.draft : res;
              if (d) {
                var keys = Object.keys(d);
                for (var k = 0; k < keys.length; k++) {
                  var key = keys[k];
                  if (st.iecData[key] !== undefined) {
                    var val = d[key];
                    if (Array.isArray(val)) val = val.join("\n");
                    st.iecData[key] = val || "";
                    if (val) st.iecDrafted[key] = true;
                  }
                }
              }
              render(container);
            })
            .catch(function (err) {
              st.iecAi.busy = false;
              st.iecAi.error = err || { message: "Could not draft ethics application." };
              render(container);
            });
        };
      }
    }

    // IEC Export DOCX
    on('[data-rmd="iec-docx"]', function () {
      var id = st.iecData;
      var sections = [
        { heading: "Investigators", text: id.investigators },
        { heading: "Background and Rationale", text: id.background },
        { heading: "Objectives", text: id.objectives },
        { heading: "Study Design and Setting", text: id.design + "\n" + id.setting },
        { heading: "Duration and Sample Size", text: id.duration + "\n" + id.sampleSize },
        { heading: "Inclusion Criteria", text: id.inclusion },
        { heading: "Exclusion Criteria", text: id.exclusion },
        { heading: "Methodology", text: id.methodology },
        { heading: "Statistical Analysis", text: id.statisticalAnalysis },
        { heading: "Risks and Benefits", text: id.risks + "\n" + id.benefits },
        { heading: "Confidentiality and Compensation", text: id.confidentiality + "\n" + id.compensation },
        { heading: "Conflict of Interest and Funding", text: id.conflictOfInterest + "\n" + id.funding },
        { heading: "Consent Process and Vulnerable Populations", text: id.consentProcess + "\n" + id.vulnerablePopulations }
      ];
      var bytes = createDocx(id.title || "Institutional Ethics Committee (IEC) Application", sections);
      var name = (p2().fileSlug ? p2().fileSlug(id.title, "iec-application") : "iec-application") + ".docx";
      p2().downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", id.title);
    });

    // IEC Copy
    on('[data-rmd="iec-copy"]', function () {
      var id = st.iecData;
      var lines = [
        "INSTITUTIONAL ETHICS COMMITTEE (IEC) APPLICATION",
        "Title: " + id.title,
        "Investigators: " + id.investigators,
        "Background: " + id.background,
        "Objectives:\n" + id.objectives,
        "Design: " + id.design,
        "Setting: " + id.setting,
        "Duration: " + id.duration,
        "Sample Size: " + id.sampleSize,
        "Inclusion Criteria:\n" + id.inclusion,
        "Exclusion Criteria:\n" + id.exclusion,
        "Methodology:\n" + id.methodology,
        "Statistical Analysis: " + id.statisticalAnalysis,
        "Risks: " + id.risks,
        "Benefits: " + id.benefits,
        "Confidentiality: " + id.confidentiality,
        "Compensation: " + id.compensation,
        "Conflict of Interest: " + id.conflictOfInterest,
        "Funding: " + id.funding,
        "Consent Process: " + id.consentProcess,
        "Vulnerable Populations: " + id.vulnerablePopulations
      ];
      copyToClipboard(lines.join("\n\n"), container, "Ethics application copied.");
    });
    on('[data-rmd="iec-save"]', function () { saveCurrent(proj.id, container); });

    // Consent Form Language change
    var langSel = container.querySelector("#rmd_consent_lang");
    if (langSel) {
      langSel.onchange = function () {
        st.consentLang = this.value;
        render(container);
      };
    }

    // Consent Form inputs
    var consentInputs = container.querySelectorAll("[data-consent]");
    for (var m = 0; m < consentInputs.length; m++) {
      (function (inpEl) {
        inpEl.oninput = function () {
          var k = inpEl.getAttribute("data-consent");
          st.consentData[k] = inpEl.value;
          delete st.consentDrafted[k];
          var note = container.querySelector('[data-rmd-ai-note="' + k + '"]');
          if (note && note.parentNode) note.parentNode.removeChild(note);
          var fillNote = container.querySelector('[data-rmd-fillin="' + k + '"]');
          if (fillNote && fillNote.parentNode && inpEl.value.trim()) fillNote.parentNode.removeChild(fillNote);
        };
      })(consentInputs[m]);
    }
    var transInputs = container.querySelectorAll("[data-consent-trans]");
    for (var n = 0; n < transInputs.length; n++) {
      (function (inpEl) {
        inpEl.oninput = function () {
          var k = inpEl.getAttribute("data-consent-trans");
          if (st.consentTransData) st.consentTransData[k] = inpEl.value;
          delete st.consentDrafted["trans_" + k];
        };
      })(transInputs[n]);
    }

    // Consent AI Bind
    var cardConsent = container.querySelector("#rmdCardConsent");
    if (cardConsent && SMD.ai) {
      var manualBtnC = cardConsent.querySelector('[data-rmd-ai="manual"]');
      if (manualBtnC) {
        manualBtnC.onclick = function () {
          st.consentOpen = true;
          render(container);
          var firstInp = container.querySelector("#rmd_consent_title");
          if (firstInp && firstInp.focus) firstInp.focus();
        };
      }
      var askBtnC = cardConsent.querySelector('[data-rmd-ai="ask"]');
      if (askBtnC) {
        askBtnC.onclick = function () {
          if (st.consentAi.busy) return;
          st.consentAi.busy = true;
          st.consentAi.error = null;
          render(container);
          var body = {
            task: "consent_form",
            input: { language: st.consentLang }
          };
          SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(proj.id) + "/ai-draft", body)
            .then(function (res) {
              st.consentAi.busy = false;
              st.consentOpen = true;
              var d = res && res.draft ? res.draft : res;
              if (d) {
                var engVersion = d.englishVersion || d;
                var pis = engVersion.participantInformationSheet || {};
                var cf = engVersion.consentForm || {};
                st.consentData.title = pis.title || "";
                st.consentData.purpose = pis.purpose || "";
                st.consentData.procedures = pis.procedures || "";
                st.consentData.duration = pis.duration || "";
                st.consentData.risks = pis.risks || "";
                st.consentData.benefits = pis.benefits || "";
                st.consentData.alternatives = pis.alternatives || "";
                st.consentData.confidentiality = pis.confidentiality || "";
                st.consentData.voluntary = pis.voluntary || "";
                st.consentData.contact = pis.contact || "";
                st.consentData.statements = Array.isArray(cf.statements) ? cf.statements.join("\n") : (cf.statements || "");
                st.consentData.signatureBlock = cf.signatureBlock || "";

                st.consentDrafted = {
                  title: true, purpose: true, procedures: true, duration: true,
                  risks: true, benefits: true, alternatives: true, confidentiality: true,
                  voluntary: true, contact: !pis.contact ? false : true,
                  statements: true, signatureBlock: true
                };

                if (d.translatedVersion) {
                  var tpis = d.translatedVersion.participantInformationSheet || {};
                  var tcf = d.translatedVersion.consentForm || {};
                  st.consentTransData = {
                    title: tpis.title || "",
                    purpose: tpis.purpose || "",
                    procedures: tpis.procedures || "",
                    duration: tpis.duration || "",
                    risks: tpis.risks || "",
                    benefits: tpis.benefits || "",
                    alternatives: tpis.alternatives || "",
                    confidentiality: tpis.confidentiality || "",
                    voluntary: tpis.voluntary || "",
                    contact: tpis.contact || "",
                    statements: Array.isArray(tcf.statements) ? tcf.statements.join("\n") : (tcf.statements || ""),
                    signatureBlock: tcf.signatureBlock || ""
                  };
                  st.consentDrafted.trans_title = true;
                  st.consentDrafted.trans_purpose = true;
                  st.consentDrafted.trans_procedures = true;
                } else {
                  st.consentTransData = null;
                }
              }
              render(container);
            })
            .catch(function (err) {
              st.consentAi.busy = false;
              st.consentAi.error = err || { message: "Could not draft consent form." };
              render(container);
            });
        };
      }
    }

    // Consent DOCX
    on('[data-rmd="consent-docx"]', function () {
      var cd = st.consentData;
      var sections = [
        { heading: "Participant Information Sheet", text: cd.title + "\n\nPurpose: " + cd.purpose + "\nProcedures: " + cd.procedures + "\nDuration: " + cd.duration + "\nRisks: " + cd.risks + "\nBenefits: " + cd.benefits + "\nAlternatives: " + cd.alternatives + "\nConfidentiality: " + cd.confidentiality + "\nVoluntary Participation: " + cd.voluntary + "\nContact: " + cd.contact },
        { heading: "Informed Consent Form", text: "Statements of consent:\n" + cd.statements + "\n\n" + cd.signatureBlock }
      ];
      if (st.consentLang !== "English" && st.consentTransData) {
        var td = st.consentTransData;
        sections.push({
          heading: "Participant Information Sheet (" + st.consentLang + ")",
          text: td.title + "\n\n" + td.purpose + "\n" + td.procedures + "\n" + td.risks + "\n" + td.benefits + "\n" + td.voluntary + "\n" + td.contact
        });
        sections.push({
          heading: "Informed Consent Form (" + st.consentLang + ")",
          text: td.statements + "\n\n" + td.signatureBlock
        });
      }
      var bytes = createDocx(cd.title || "Participant Information Sheet and Informed Consent Form", sections);
      var name = (p2().fileSlug ? p2().fileSlug(cd.title, "consent-form") : "consent-form") + ".docx";
      p2().downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", cd.title);
    });

    // Consent Copy
    on('[data-rmd="consent-copy"]', function () {
      var cd = st.consentData;
      var lines = [
        "PARTICIPANT INFORMATION SHEET",
        "Title: " + cd.title,
        "Purpose: " + cd.purpose,
        "Procedures: " + cd.procedures,
        "Duration: " + cd.duration,
        "Risks: " + cd.risks,
        "Benefits: " + cd.benefits,
        "Alternatives: " + cd.alternatives,
        "Confidentiality: " + cd.confidentiality,
        "Voluntary: " + cd.voluntary,
        "Contact: " + cd.contact,
        "\nINFORMED CONSENT FORM",
        "Statements:\n" + cd.statements,
        "Signature: " + cd.signatureBlock
      ];
      if (st.consentLang !== "English" && st.consentTransData) {
        var td = st.consentTransData;
        lines.push("\n\n--- " + st.consentLang.toUpperCase() + " VERSION ---");
        lines.push("Title: " + td.title);
        lines.push("Purpose: " + td.purpose);
        lines.push("Procedures: " + td.procedures);
        lines.push("Risks: " + td.risks);
        lines.push("Benefits: " + td.benefits);
        lines.push("Voluntary: " + td.voluntary);
        lines.push("Contact: " + td.contact);
        lines.push("Statements:\n" + td.statements);
        lines.push("Signature: " + td.signatureBlock);
      }
      copyToClipboard(lines.join("\n"), container, "Consent document copied.");
    });
    on('[data-rmd="consent-save"]', function () { saveCurrent(proj.id, container); });

    // CTRI Form inputs
    var ctriInputs = container.querySelectorAll("[data-ctri]");
    for (var p = 0; p < ctriInputs.length; p++) {
      (function (inpEl) {
        inpEl.oninput = function () {
          var k = inpEl.getAttribute("data-ctri");
          st.ctriData[k] = inpEl.value;
          delete st.ctriDrafted[k];
          var note = container.querySelector('[data-rmd-ai-note="' + k + '"]');
          if (note && note.parentNode) note.parentNode.removeChild(note);
          var fillNote = container.querySelector('[data-rmd-fillin="' + k + '"]');
          if (fillNote && fillNote.parentNode && inpEl.value.trim()) fillNote.parentNode.removeChild(fillNote);
        };
      })(ctriInputs[p]);
    }

    // CTRI AI Bind
    var cardCtri = container.querySelector("#rmdCardCtri");
    if (cardCtri && SMD.ai) {
      var manualBtnCt = cardCtri.querySelector('[data-rmd-ai="manual"]');
      if (manualBtnCt) {
        manualBtnCt.onclick = function () {
          st.ctriOpen = true;
          render(container);
          var firstInp = container.querySelector("#rmd_ctri_pub");
          if (firstInp && firstInp.focus) firstInp.focus();
        };
      }
      var askBtnCt = cardCtri.querySelector('[data-rmd-ai="ask"]');
      if (askBtnCt) {
        askBtnCt.onclick = function () {
          if (st.ctriAi.busy) return;
          st.ctriAi.busy = true;
          st.ctriAi.error = null;
          render(container);
          var body = {
            task: "ctri_fields",
            input: {
              sampleSize: st.ssResult ? { n: st.ssResult.nPerGroup || st.ssResult.n, total: (st.ssResult.withDropout ? st.ssResult.withDropout.total : st.ssResult.total) } : null
            }
          };
          SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(proj.id) + "/ai-draft", body)
            .then(function (res) {
              st.ctriAi.busy = false;
              st.ctriOpen = true;
              var d = res && res.draft ? res.draft : res;
              if (d) {
                st.ctriData.publicTitle = d.publicTitle || "";
                st.ctriData.scientificTitle = d.scientificTitle || "";
                st.ctriData.studyType = d.studyType || "";
                st.ctriData.phase = d.phase || "";
                st.ctriData.condition = d.condition || "";
                st.ctriData.intervention = d.intervention || "";
                st.ctriData.comparator = d.comparator || "";
                st.ctriData.inclusion = d.inclusion || "";
                st.ctriData.exclusion = d.exclusion || "";
                var po = d.primaryOutcome || {};
                st.ctriData.primaryOutcomeName = po.outcome || "";
                st.ctriData.primaryOutcomeTime = po.timepoint || "";
                st.ctriData.secondaryOutcomes = Array.isArray(d.secondaryOutcomes) ? d.secondaryOutcomes.join("\n") : (d.secondaryOutcomes || "");
                st.ctriData.targetSampleSize = d.targetSampleSize != null ? String(d.targetSampleSize) : "";
                st.ctriData.sites = d.sites || "";
                st.ctriData.recruitmentStatus = d.recruitmentStatus || "Not Yet Recruiting";
                st.ctriData.ethicsCommittee = d.ethicsCommittee || "";
                st.ctriData.regulatoryClearance = d.regulatoryClearance || "";
                st.ctriData.fundingSource = d.fundingSource || "";
                st.ctriData.briefSummary = d.briefSummary || "";

                st.ctriDrafted = {};
                var ctriKeys = Object.keys(st.ctriData);
                for (var ci = 0; ci < ctriKeys.length; ci++) {
                  var ck = ctriKeys[ci];
                  if (st.ctriData[ck]) st.ctriDrafted[ck] = true;
                }
              }
              render(container);
            })
            .catch(function (err) {
              st.ctriAi.busy = false;
              st.ctriAi.error = err || { message: "Could not draft CTRI fields." };
              render(container);
            });
        };
      }
    }

    // CTRI DOCX
    on('[data-rmd="ctri-docx"]', function () {
      var ctd = st.ctriData;
      var sections = [
        { heading: "Titles and Classification", text: "Public Title: " + ctd.publicTitle + "\nScientific Title: " + ctd.scientificTitle + "\nStudy Type: " + ctd.studyType + "\nPhase: " + ctd.phase + "\nCondition: " + ctd.condition },
        { heading: "Intervention and Comparator", text: "Intervention: " + ctd.intervention + "\nComparator: " + ctd.comparator },
        { heading: "Eligibility", text: "Inclusion: " + ctd.inclusion + "\nExclusion: " + ctd.exclusion },
        { heading: "Outcomes", text: "Primary: " + ctd.primaryOutcomeName + " (" + ctd.primaryOutcomeTime + ")\nSecondary:\n" + ctd.secondaryOutcomes },
        { heading: "Sample Size and Sites", text: "Target Sample Size: " + ctd.targetSampleSize + "\nSites: " + ctd.sites + "\nRecruitment Status: " + ctd.recruitmentStatus },
        { heading: "Ethics and Clearance", text: "Ethics Committee: " + (ctd.ethicsCommittee || "Fill this in") + "\nRegulatory Clearance: " + (ctd.regulatoryClearance || "Fill this in") + "\nFunding: " + ctd.fundingSource },
        { heading: "Brief Summary", text: ctd.briefSummary }
      ];
      var bytes = createDocx(ctd.publicTitle || "CTRI Registration Fields", sections);
      var name = (p2().fileSlug ? p2().fileSlug(ctd.publicTitle, "ctri-registration") : "ctri-registration") + ".docx";
      p2().downloadBytes(name, bytes, "application/vnd.openxmlformats-officedocument.wordprocessingml.document", ctd.publicTitle);
    });

    // CTRI Copy
    on('[data-rmd="ctri-copy"]', function () {
      var ctd = st.ctriData;
      var lines = [
        "CLINICAL TRIALS REGISTRY - INDIA (CTRI) REGISTRATION",
        "Public Title: " + ctd.publicTitle,
        "Scientific Title: " + ctd.scientificTitle,
        "Study Type: " + ctd.studyType,
        "Phase: " + ctd.phase,
        "Condition: " + ctd.condition,
        "Intervention: " + ctd.intervention,
        "Comparator: " + ctd.comparator,
        "Inclusion Criteria:\n" + ctd.inclusion,
        "Exclusion Criteria:\n" + ctd.exclusion,
        "Primary Outcome: " + ctd.primaryOutcomeName + " (" + ctd.primaryOutcomeTime + ")",
        "Secondary Outcomes:\n" + ctd.secondaryOutcomes,
        "Target Sample Size: " + ctd.targetSampleSize,
        "Sites: " + ctd.sites,
        "Recruitment Status: " + ctd.recruitmentStatus,
        "Ethics Committee: " + (ctd.ethicsCommittee || "Fill this in"),
        "Regulatory Clearance: " + (ctd.regulatoryClearance || "Fill this in"),
        "Funding Source: " + ctd.fundingSource,
        "Brief Summary:\n" + ctd.briefSummary
      ];
      copyToClipboard(lines.join("\n\n"), container, "CTRI fields copied.");
    });
    on('[data-rmd="ctri-save"]', function () { saveCurrent(proj.id, container); });
  }

  SMD.screens.plan = { render: render };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { render: render };
  }
})(typeof window !== "undefined" ? window : globalThis);
