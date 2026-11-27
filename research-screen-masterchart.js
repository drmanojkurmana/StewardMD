/* StewardMD - ResearchMD Master Chart screen (window.SMD_RESEARCH.screens.masterchart).
 * ES5 only, buildless, mobile-first.
 * Original-study analysis of an uploaded master chart (one row per patient).
 * Everything runs ON DEVICE via window.SMD_RESEARCH_STATS. Patient rows are
 * never sent anywhere; they live in memory and, only if the user taps
 * "Save on this phone", in localStorage under the project id.
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

  var MC_KEY = "smd_rmd_masterchart_v1";
  var STORE_KIND = "masterchart";
  var STORE_ID = "chart";
  var GROUP_COLORS = ["var(--rmd-acc)", "var(--rmd-warn)", "var(--rmd-bad)", "var(--rmd-mut)"];
  var TYPE_TOKENS = ["numeric", "binary", "categorical", "id", "date", "text"];
  var TYPE_LABELS = {
    numeric: "Number", binary: "Yes-no", categorical: "Categories",
    id: "ID", date: "Date", text: "Text"
  };

  var view = null;
  var runSeq = 0;
  var mc = freshState("");

  function freshState(pid) {
    return {
      pid: pid, stage: "upload", fileName: "", sample: false, fromCasefiles: false,
      columns: [], rows: [], types: {}, infer: {}, phiCols: [],
      analysis: "", showMean: false, matched: false, running: false,
      ctri: null, iecStatus: null, journey: [],
      isSeries: false, isRct: false, isStudy: false, isCohort: false,
      form: {
        group: "", outcomes: [], variables: [], outcome: "", predictors: [], robustHc3: false, a: "", b: "",
        time: "", event: "", sgroup: "", cox: [],
        mgroup: "", caseLevel: "", exposure: "", matchSet: "",
        truth: "", posLevel: "", tests: []
      },
      results: null, error: "", notice: ""
    };
  }

  function stats() { return G.SMD_RESEARCH_STATS; }
  function onDeviceStats() { return G.SMD_RMD_ONDEVICE_STATS; }
  function onDeviceV2Enabled() {
    var OD = onDeviceStats();
    if (!OD || typeof OD.run !== "function") return false;
    if (typeof OD.isEnabled === "function") return !!OD.isEnabled();
    try {
      if (typeof localStorage !== "undefined") return localStorage.getItem("smd_rmd_ondevice_stats_v2") !== "0";
    } catch (e) {}
    return true;
  }
  function explain() { return G.SMD_RESEARCH_EXPLAIN; }
  function rocView() { return G.SMD_RESEARCH_ROC_VIEW; }
  function rocEnabled() {
    var V = rocView(), S = stats();
    return !!(V && S && typeof S.roc === "function" && (typeof V.isEnabled !== "function" || V.isEnabled()));
  }
  function rocHelpers() { return { esc: esc, fmt: fmt, pStr: pStr, pGloss: pGloss }; }
  function rocLevels(col) {
    return (mc.infer[col] && mc.infer[col].levels) || [];
  }
  function rmdStore() { return G.RMDStore; }
  function contracts() { return G.SMD_RESEARCH_CONTRACTS; }

  function project() {
    try { return SMD.store && SMD.store.getProject ? SMD.store.getProject(mc.pid) : null; } catch (e) { return null; }
  }

  function updateFlags() {
    var proj = project();
    var journey = [];
    try { journey = (SMD.journeyFor && proj) ? SMD.journeyFor(proj) : []; } catch (e) { journey = []; }
    var t = ((proj && proj.studyType) || "").toLowerCase();
    mc.journey = journey || [];
    mc.isSeries = mc.journey.indexOf("casefile") >= 0 && mc.journey.indexOf("masterchart") >= 0;
    mc.isRct = mc.journey.indexOf("ctri") >= 0 || mc.journey.indexOf("randomise") >= 0;
    mc.isStudy = mc.journey.indexOf("plan") >= 0;
    mc.isCohort = /cohort|survival|time to event/.test(t);
  }

  function fmt(x, d) {
    if (x == null || !isFinite(x)) return "";
    /* fixed decimals, so an OR of 1.00 never shows as "1" and 7.0 never as "7" */
    return (Math.round(x * Math.pow(10, d == null ? 2 : d)) / Math.pow(10, d == null ? 2 : d)).toFixed(d == null ? 2 : d);
  }

  function calm(msg) {
    return String(msg || "Something went wrong.").replace(/^research:\s*/i, "");
  }

  function colValues(name) {
    var idx = mc.columns.indexOf(name);
    if (idx < 0) return [];
    var out = [];
    for (var i = 0; i < mc.rows.length; i++) out.push(mc.rows[i][idx]);
    return out;
  }

  function isPhi(name) { return mc.phiCols.indexOf(name) >= 0; }

  function eligible() {
    var out = [];
    for (var i = 0; i < mc.columns.length; i++) {
      var c = mc.columns[i];
      if (!isPhi(c) && mc.types[c] !== "id") out.push(c);
    }
    return out;
  }

  function groupOptions() {
    return eligible().filter(function (c) { return mc.types[c] === "binary" || mc.types[c] === "categorical"; });
  }
  function numericOptions() {
    return eligible().filter(function (c) { return mc.types[c] === "numeric"; });
  }
  function binaryOptions() {
    return eligible().filter(function (c) { return mc.types[c] === "binary"; });
  }

  function typesMap() {
    var m = {};
    for (var i = 0; i < mc.columns.length; i++) m[mc.columns[i]] = mc.types[mc.columns[i]];
    return m;
  }

  function inferAll() {
    var S = stats();
    mc.infer = {};
    mc.phiCols = [];
    for (var i = 0; i < mc.columns.length; i++) {
      var name = mc.columns[i];
      var inf = S.inferColumn(name, colValues(name));
      mc.infer[name] = inf;
      if (!mc.types[name]) mc.types[name] = inf.type;
      if (inf.phi) mc.phiCols.push(name);
    }
  }

  /* ---------- Local persistence (only on explicit user tap) ---------- */

  function loadLocal(pid) {
    try {
      var all = JSON.parse(localStorage.getItem(MC_KEY) || "{}") || {};
      return all[pid] || null;
    } catch (e) { return null; }
  }

  function chartPayload() {
    return {
      fileName: mc.fileName, sample: mc.sample, fromCasefiles: mc.fromCasefiles,
      columns: mc.columns, rows: mc.rows, types: mc.types
    };
  }

  function saveLocal() {
    try {
      var all = JSON.parse(localStorage.getItem(MC_KEY) || "{}") || {};
      all[mc.pid] = {
        fileName: mc.fileName, sample: mc.sample,
        columns: mc.columns, rows: mc.rows, types: mc.types
      };
      localStorage.setItem(MC_KEY, JSON.stringify(all));
      mc.notice = "Saved on this phone. Nothing was uploaded.";
    } catch (e) {
      mc.notice = "Could not save on this phone (storage is full). Your chart is still open here.";
    }
    var st = rmdStore();
    if (st && st.put) {
      try { st.put(mc.pid, STORE_KIND, STORE_ID, chartPayload()); } catch (e) {}
    }
    draw();
  }

  function loadChart(pid) {
    var st = rmdStore();
    if (st && st.get) {
      return st.get(pid, STORE_KIND, STORE_ID).then(function (saved) {
        if (saved && saved.columns && saved.rows) { return saved; }
        return loadLocal(pid);
      }, function () { return loadLocal(pid); });
    }
    return Promise.resolve(loadLocal(pid));
  }

  function adoptSaved(saved) {
    mc.fileName = saved.fileName || "Saved chart";
    mc.sample = !!saved.sample;
    mc.fromCasefiles = !!saved.fromCasefiles;
    mc.columns = saved.columns.slice();
    mc.rows = saved.rows;
    mc.types = saved.types || {};
    mc.results = null;
    if (stats()) inferAll();
  }

  /* ---------- Sample thesis (synthetic, deterministic) ---------- */

  function pad3(n) { return ("00" + n).slice(-3); }

  function sampleChart() {
    var seed = 20261124;
    function rnd() {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    }
    function norm() {
      var u = rnd() || 0.0001;
      var v = rnd();
      return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    }
    var columns = ["Sl No", "Name", "Mobile", "Age", "Sex", "Group", "Diabetes", "BMI",
      "Baseline HbA1c", "HbA1c at 12 weeks", "Hospital stay days", "Complication"];
    var rows = [];
    for (var i = 0; i < 200; i++) {
      var group = i % 2 === 0 ? "Drug A" : "Drug B";
      var age = Math.round(45 + norm() * 12);
      if (age < 18) age = 18;
      if (age > 80) age = 80;
      var sex = rnd() < 0.52 ? "Male" : "Female";
      var diabetes = rnd() < 0.4 ? "Yes" : "No";
      var bmi = Math.round((26 + norm() * 4) * 10) / 10;
      if (bmi < 15) bmi = 15;
      var base = Math.round((8.6 + norm() * 1.1) * 10) / 10;
      if (base < 5.5) base = 5.5;
      var drop = group === "Drug A" ? 1.6 : 0.7;
      var h12 = Math.round((base - drop + norm() * 0.8) * 10) / 10;
      if (h12 < 4.5) h12 = 4.5;
      var stay = Math.max(1, Math.round(2 + Math.pow(rnd(), 3) * 25));
      var pComp = 0.10 + (diabetes === "Yes" ? 0.18 : 0) + (age > 60 ? 0.10 : 0) + (group === "Drug B" ? 0.08 : 0);
      var comp = rnd() < pComp ? "Yes" : "No";
      var mobile = "98" + String(10000000 + Math.floor(rnd() * 90000000));
      rows.push([String(i + 1), "Patient " + pad3(i + 1), mobile, String(age), sex, group,
        diabetes, String(bmi), String(base), String(h12), String(stay), comp]);
    }
    return { columns: columns, rows: rows };
  }

  /* ---------- On-device XLSX reader (zip + DecompressionStream) ---------- */

  function utf8Decode(u8) {
    var out = "";
    for (var i = 0; i < u8.length; i += 8192) {
      out += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + 8192, u8.length)));
    }
    try { return decodeURIComponent(escape(out)); } catch (e) { return out; }
  }

  function colFromRef(ref, fallback) {
    var m = /^([A-Za-z]+)/.exec(ref || "");
    if (!m) return fallback;
    var letters = m[1].toUpperCase();
    var n = 0;
    for (var i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
    return n - 1;
  }

  var XLSX_CSV_HINT = "Save the sheet as CSV (File > Save As > CSV) and upload that.";

  function parseXlsx(buf) {
    return new Promise(function (resolve, reject) {
      if (!G.DecompressionStream) {
        reject(new Error("This phone cannot open Excel files directly. " + XLSX_CSV_HINT));
        return;
      }
      var u8 = new Uint8Array(buf);
      var dv = new DataView(buf);
      var eocd = -1;
      var minAt = Math.max(0, u8.length - 22 - 65536);
      for (var i = u8.length - 22; i >= minAt; i--) {
        if (u8[i] === 0x50 && u8[i + 1] === 0x4b && u8[i + 2] === 0x05 && u8[i + 3] === 0x06) { eocd = i; break; }
      }
      if (eocd < 0) {
        reject(new Error("This does not look like an .xlsx file. " + XLSX_CSV_HINT));
        return;
      }
      var count = dv.getUint16(eocd + 10, true);
      var cd = dv.getUint32(eocd + 16, true);
      var entries = {};
      var p = cd;
      for (var e = 0; e < count; e++) {
        if (p + 46 > u8.length || dv.getUint32(p, true) !== 0x02014b50) break;
        var method = dv.getUint16(p + 10, true);
        var compSize = dv.getUint32(p + 20, true);
        var nameLen = dv.getUint16(p + 28, true);
        var extraLen = dv.getUint16(p + 30, true);
        var commentLen = dv.getUint16(p + 32, true);
        var lho = dv.getUint32(p + 42, true);
        var name = utf8Decode(u8.subarray(p + 46, p + 46 + nameLen));
        entries[name] = { method: method, offset: lho, size: compSize };
        p += 46 + nameLen + extraLen + commentLen;
      }
      function readEntry(name) {
        var en = entries[name];
        if (!en) return Promise.resolve(null);
        var nl = dv.getUint16(en.offset + 26, true);
        var el = dv.getUint16(en.offset + 28, true);
        var start = en.offset + 30 + nl + el;
        var data = u8.subarray(start, start + en.size);
        if (en.method === 0) return Promise.resolve(data);
        if (en.method !== 8) {
          return Promise.reject(new Error("This Excel file uses a compression we cannot read on this phone. " + XLSX_CSV_HINT));
        }
        var stream = new Blob([data]).stream().pipeThrough(new G.DecompressionStream("deflate-raw"));
        return new Response(stream).arrayBuffer().then(function (b) { return new Uint8Array(b); });
      }
      Promise.all([readEntry("xl/sharedStrings.xml"), readEntry("xl/worksheets/sheet1.xml")]).then(function (res) {
        if (!res[1]) throw new Error("Could not find the first sheet in this Excel file. " + XLSX_CSV_HINT);
        var shared = [];
        if (res[0]) {
          var sdoc = new DOMParser().parseFromString(utf8Decode(res[0]), "application/xml");
          var sis = sdoc.getElementsByTagName("si");
          for (var s = 0; s < sis.length; s++) {
            var ts = sis[s].getElementsByTagName("t");
            var txt = "";
            for (var t = 0; t < ts.length; t++) txt += ts[t].textContent;
            shared.push(txt);
          }
        }
        var doc = new DOMParser().parseFromString(utf8Decode(res[1]), "application/xml");
        if (doc.getElementsByTagName("parsererror").length) {
          throw new Error("Could not read the first sheet of this Excel file. " + XLSX_CSV_HINT);
        }
        var rowEls = doc.getElementsByTagName("row");
        var grid = [];
        for (var r = 0; r < rowEls.length; r++) {
          var cells = rowEls[r].getElementsByTagName("c");
          var arr = [];
          for (var c = 0; c < cells.length; c++) {
            var cell = cells[c];
            var idx = colFromRef(cell.getAttribute("r"), c);
            var ty = cell.getAttribute("t");
            var val = "";
            if (ty === "inlineStr") {
              var its = cell.getElementsByTagName("t");
              for (var q = 0; q < its.length; q++) val += its[q].textContent;
            } else {
              var vs = cell.getElementsByTagName("v");
              var raw = vs.length ? vs[0].textContent : "";
              val = ty === "s" ? (shared[parseInt(raw, 10)] || "") : raw;
            }
            while (arr.length < idx) arr.push("");
            arr[idx] = val;
          }
          grid.push(arr);
        }
        var headerAt = -1;
        for (var h = 0; h < grid.length; h++) {
          for (var k = 0; k < grid[h].length; k++) {
            if (String(grid[h][k] || "").trim() !== "") { headerAt = h; break; }
          }
          if (headerAt >= 0) break;
        }
        if (headerAt < 0) throw new Error("The first sheet is empty. " + XLSX_CSV_HINT);
        var headers = [];
        for (var hc = 0; hc < grid[headerAt].length; hc++) {
          headers.push(String(grid[headerAt][hc] || "").trim() || ("Column " + (hc + 1)));
        }
        var rows = [];
        for (var rr = headerAt + 1; rr < grid.length; rr++) {
          var row = [];
          var any = false;
          for (var cc = 0; cc < headers.length; cc++) {
            var v = String(grid[rr][cc] == null ? "" : grid[rr][cc]);
            if (v.trim() !== "") any = true;
            row.push(v);
          }
          if (any) rows.push(row);
        }
        resolve({ columns: headers, rows: rows });
      }).then(resolve, reject);
    });
  }

  /* ---------- Table adoption ---------- */

  function adoptTable(table, fileName, sample) {
    if (!table || !table.columns || !table.columns.length || !table.rows || !table.rows.length) {
      mc.error = "No rows found in that file. Check that the first row holds the column names.";
      draw();
      return;
    }
    mc.fileName = fileName;
    mc.sample = sample;
    mc.columns = table.columns.slice();
    mc.rows = table.rows;
    mc.types = {};
    mc.results = null;
    mc.analysis = "";
    mc.error = "";
    inferAll();
    mc.stage = "identifiers";
    draw();
  }

  function handleFile(file) {
    if (!file) return;
    mc.error = "";
    mc.notice = "";
    var name = file.name || "master chart";
    var reader = new FileReader();
    reader.onerror = function () {
      mc.error = "Could not read that file. Try again, or save the sheet as CSV and upload that.";
      draw();
    };
    if (/\.xlsx$/i.test(name)) {
      reader.onload = function () {
        parseXlsx(reader.result).then(function (table) {
          adoptTable(table, name, false);
        }, function (err) {
          mc.error = calm(err && err.message);
          draw();
        });
      };
      reader.readAsArrayBuffer(file);
    } else {
      reader.onload = function () {
        try {
          adoptTable(stats().parseCsv(String(reader.result || "")), name, false);
        } catch (err) {
          mc.error = calm(err && err.message);
          draw();
        }
      };
      reader.readAsText(file);
    }
  }

  /* ---------- Analysis ---------- */

  function sentenceFor(result, outcome, groupLabels) {
    try {
      return stats().resultsSentence(result, { outcome: outcome, groupLabels: groupLabels || [] }) || "";
    } catch (e) { return ""; }
  }

  function groupLevels(name) {
    var inf = mc.infer[name];
    return (inf && inf.levels) || [];
  }

  function calmDeviceError(err) {
    var code = err && err.code;
    if (code === "ceiling_rows") return "This chart has too many rows to run on this device.";
    if (code === "ceiling_seconds") return "This calculation took too long and was stopped.";
    if (code === "no_events") return "No events yet, so the groups cannot be compared.";
    if (code === "cox_not_converged") return "The model did not settle on an answer. Do not report a hazard ratio; ask your statistician.";
    if (code === "too_few_rows") return "Not enough complete rows for this model.";
    if (code === "singular_design") return "Two or more selected factors carry the same information. Try removing one.";
    return calm(err && err.message);
  }

  function subTable(colNames) {
    var seen = {}, cols = [], idxs = [], i, j, rows = [];
    for (j = 0; j < colNames.length; j++) {
      var c = colNames[j];
      if (!c || seen[c]) continue;
      var idx = mc.columns.indexOf(c);
      if (idx < 0) continue;
      seen[c] = 1;
      cols.push(c);
      idxs.push(idx);
    }
    for (i = 0; i < mc.rows.length; i++) {
      var row = [];
      for (j = 0; j < idxs.length; j++) row.push(mc.rows[i][idxs[j]]);
      rows.push(row);
    }
    return { columns: cols, rows: rows };
  }

  function linearParagraph(res, outcome) {
    if (!res || !res.coefficients || res.coefficients.length < 2) return "";
    var best = null;
    for (var i = 1; i < res.coefficients.length; i++) {
      var c = res.coefficients[i];
      if (best === null || (c.p != null && c.p < best.p)) best = c;
    }
    var s = "In linear regression for " + outcome + " (n = " + res.n + ", R2 = " + fmt(res.r2, 2);
    if (res.robust === "HC3") s += ", HC3 robust errors";
    s += ")";
    if (best && isFinite(best.estimate)) {
      s += ", " + best.term + " had estimate " + fmt(best.estimate, 2) + " (95% CI " + fmt(best.ciLower, 2) + " to " + fmt(best.ciUpper, 2) + ", " + pStr(best.p) + ")";
    }
    return s + ".";
  }

  function adaptLogisticFromDevice(res) {
    var coefs = [];
    var raw = (res && res.coefficients) || [];
    for (var i = 0; i < raw.length; i++) {
      var c = raw[i];
      coefs.push({
        name: c.term,
        estimate: c.estimate,
        se: c.se,
        z: c.z,
        or: Math.exp(c.estimate),
        ciLower: Math.exp(c.ciLower),
        ciUpper: Math.exp(c.ciUpper),
        p: c.p
      });
    }
    return {
      n: res.n,
      events: res.events,
      converged: true,
      iterations: res.iterations,
      warning: res.warning || "",
      aic: res.aic,
      deviance: res.deviance,
      nullDeviance: res.nullDeviance,
      coefficients: coefs
    };
  }

  function adaptKmFromDevice(res) {
    if (res.groups && res.groups.length) {
      return { ok: true, warnings: res.warnings || [], nExcluded: res.nExcluded || 0, groups: res.groups };
    }
    var steps = [];
    var rawSteps = res.steps || [];
    for (var i = 0; i < rawSteps.length; i++) {
      var st = rawSteps[i];
      steps.push({
        t: st.time,
        atRisk: st.nRisk,
        events: st.nEvent,
        censored: st.nCensor,
        survival: st.surv,
        seLogS: st.se,
        ciLower: st.ciLower,
        ciUpper: st.ciUpper
      });
    }
    return {
      ok: true,
      warnings: res.warnings || [],
      nExcluded: res.nExcluded || 0,
      groups: [{
        name: "All",
        n: res.n,
        nEvents: res.events,
        steps: steps,
        median: { value: res.median, lower: res.medianCiLower, upper: res.medianCiUpper }
      }]
    };
  }

  function jobsRunner() {
    var j = G && G.SMD_RMD_JOBS;
    return (j && typeof j.runWithFallback === "function") ? j : null;
  }

  var IPD_TIERS = { anonymised_deid: 1, hipaa_lds: 1, coded_pseudonymised: 1 };

  function ipdRequiredGroups(cfg) {
    var jurisdictions = Array.isArray(cfg.jurisdictions) ? cfg.jurisdictions : [];
    var tier = cfg.identifiabilityTier;
    var basis = (cfg.legalBasis && typeof cfg.legalBasis === "object") ? cfg.legalBasis : {};
    var groups = [["irb_approval", "exemption_waiver"]];
    if (jurisdictions.indexOf("IN") >= 0 && basis.IN === "consent") {
      groups.push(["consent_basis"]);
    }
    if (jurisdictions.indexOf("EU") >= 0) {
      groups.push(["dpa"]);
      if (basis.EU === "9_2_a_explicit_consent") groups.push(["consent_basis"]);
    }
    if (jurisdictions.indexOf("US") >= 0) {
      if (tier === "anonymised_deid") groups.push(["safe_harbor", "expert_determination"]);
      else {
        groups.push(["baa"]);
        if (tier === "hipaa_lds") groups.push(["dua"]);
        else groups.push(["dua", "exemption_waiver", "authorization"]);
      }
    }
    if (!jurisdictions.length) {
      groups.push(["safe_harbor", "expert_determination"]);
    }
    return groups;
  }

  function isIpdComplianceSatisfied(cfg, list, now) {
    if (!cfg || typeof cfg !== "object" || !IPD_TIERS[cfg.identifiabilityTier]) return false;
    var jurisdictions = Array.isArray(cfg.jurisdictions) ? cfg.jurisdictions : [];
    var basis = (cfg.legalBasis && typeof cfg.legalBasis === "object") ? cfg.legalBasis : {};
    var att = (cfg.attestation && typeof cfg.attestation === "object") ? cfg.attestation : {};
    var agreements = (cfg.agreements && typeof cfg.agreements === "object") ? cfg.agreements : {};
    if (att.responsibility !== true) return false;
    if (jurisdictions.indexOf("IN") >= 0) {
      if (basis.IN === "dpdp_s17_2_b_research" && att.noIndividualDecisions !== true) return false;
      if (att.pediatric === true && att.guardianConsent !== true) return false;
    }
    if (jurisdictions.indexOf("EU") >= 0) {
      if (agreements.dpa !== true) return false;
      if (att.dpia !== true) return false;
      if (basis.EU === "9_2_j_scientific_research" &&
        !(typeof att.memberStateLaw === "string" && att.memberStateLaw.replace(/^\s+|\s+$/g, ""))) {
        return false;
      }
    }
    if (jurisdictions.indexOf("US") >= 0 && cfg.identifiabilityTier !== "anonymised_deid" && agreements.baa !== true) {
      return false;
    }
    if ((jurisdictions.indexOf("US") >= 0 && cfg.identifiabilityTier === "anonymised_deid") || !jurisdictions.length) {
      if (att.noActualKnowledge !== true) return false;
    }
    var groups = ipdRequiredGroups(cfg);
    var evList = Array.isArray(list) ? list : [];
    var t = typeof now === "number" ? now : Date.now();
    for (var gi = 0; gi < groups.length; gi++) {
      var kinds = groups[gi];
      var satisfied = false;
      for (var ei = 0; ei < evList.length; ei++) {
        var ev = evList[ei];
        if (!ev || ev.status !== "approved") continue;
        if (kinds.indexOf(ev.kind) < 0) continue;
        var exp = ev.expiresTs != null ? ev.expiresTs : ev.expires_ts;
        if (exp != null && !(Number(exp) > t)) continue;
        satisfied = true;
        break;
      }
      if (!satisfied) return false;
    }
    return true;
  }

  /* NOTE (MasterChart cloud stats): MasterChart runs over in-memory table rows
   * (mc.columns/mc.rows) and has no inline uploadIpd client flow. Only projects
   * with an uploaded server dataset (mc.ipdDatasetId) can submit /stats-jobs;
   * otherwise we show the patient-data privacy notice (Continue gated by ethics
   * approval on file) and then "Cloud analysis isn't available for this dataset yet". */
  function checkMcEthicsApproval(pid) {
    if (!pid || !SMD || !SMD.api || typeof SMD.api.request !== "function") {
      return Promise.resolve(false);
    }
    var base = "/v1/projects/" + encodeURIComponent(pid);
    return Promise.all([
      SMD.api.request("GET", base + "/ipd-config").catch(function () { return null; }),
      SMD.api.request("GET", base + "/ipd-evidence").catch(function () { return null; })
    ]).then(function (pair) {
      var cfg = pair[0] && pair[0].config;
      if (!cfg || !pair[1]) return false;
      var list = pair[1].evidence || pair[1].items || [];
      return isIpdComplianceSatisfied(cfg, list, Date.now());
    }, function () { return false; });
  }

  function runMcCloudFallback(targetPid, spec, fallbackMeta) {
    var datasetId = mc.ipdDatasetId || (spec && spec.datasetId);
    if (!datasetId || !targetPid || !SMD || !SMD.api || typeof SMD.api.request !== "function") {
      return Promise.resolve({
        unavailable: true,
        message: "Cloud analysis isn't available for this dataset yet"
      });
    }
    var modelSpec = spec;
    if (spec && (spec.family === "linear" || spec.family === "logistic") && !spec.formula && spec.outcome && spec.predictors) {
      modelSpec = {
        family: spec.family,
        formula: spec.outcome + " ~ " + spec.predictors.join(" + "),
        outcome: spec.outcome,
        predictors: spec.predictors.slice(),
        types: spec.types
      };
      if (spec.family === "linear") modelSpec.robust = spec.robust || null;
    }
    var key = "mc_" + Date.now() + "_" + Math.random().toString(36).slice(2, 8);
    return SMD.api.request("POST", "/v1/projects/" + encodeURIComponent(targetPid) + "/stats-jobs", {
      datasetId: datasetId,
      model: modelSpec,
      idempotencyKey: key,
      fallback: fallbackMeta
    });
  }

  function runWithDeviceFallback(targetId, spec, runDeviceFn, onSuccessFn) {
    var seqNow = ++runSeq;
    var pidNow = mc.pid;
    var JR = jobsRunner();
    mc.running = true;
    mc.retryText = "";
    draw();

    var p;
    if (!JR) {
      p = Promise.resolve().then(function () {
        return runDeviceFn({ signal: null });
      }).then(function (res) {
        return { ok: true, source: "device", result: res };
      });
    } else {
      p = JR.runWithFallback("stats", runDeviceFn, function (cpIgnored, fallbackMeta) {
        return runMcCloudFallback(pidNow, spec, fallbackMeta);
      }, {
        jobKey: "stats:" + (pidNow || "local") + ":" + targetId,
        projectId: pidNow || "local",
        targetId: targetId,
        engine: "ondevice:stats",
        hasEthicsApproval: function () { return checkMcEthicsApproval(pidNow); },
        onStatus: function (info) {
          if (seqNow !== runSeq || mc.pid !== pidNow) return;
          if (info && info.state === "retrying" && info.message) {
            mc.retryText = info.message;
            draw();
          }
        }
      });
    }

    p.then(function (out) {
      if (seqNow !== runSeq || mc.pid !== pidNow) return;
      mc.running = false;
      mc.retryText = "";
      if (out && out.ok && out.source === "device") {
        onSuccessFn(out.result);
        return;
      }
      if (out && out.ok && out.source === "cloud") {
        if (out.result && out.result.unavailable) {
          mc.error = out.result.message;
        } else {
          mc.error = "Cloud stats job queued. Results will appear once finished.";
        }
        draw();
        return;
      }
      mc.error = (out && out.message) || "Saved on this device. Try again later.";
      draw();
    }, function (err) {
      if (seqNow !== runSeq || mc.pid !== pidNow) return;
      mc.running = false;
      mc.retryText = "";
      if (err && err.code === "logistic_not_converged") {
        var lgFail = {
          n: mc.rows.length, events: 0, converged: false,
          warning: "The model could not settle on stable numbers (a factor perfectly predicts the outcome). Try fewer factors.",
          coefficients: []
        };
        mc.results = {
          kind: "logistic", outcome: spec.outcome, log: lgFail,
          warnings: [lgFail.warning], paragraph: "", onDevice: true
        };
        mc.stage = "results";
        draw();
        return;
      }
      mc.error = calmDeviceError(err);
      draw();
    });
  }

  /* ROC curves run on this device in research-stats.js (n log n, fast enough
     for the main thread even at the 100 000-row ceiling). */
  function runRoc() {
    var f = mc.form;
    if (!f.truth || !f.tests.length) {
      mc.error = "Pick the condition column and tick 1 to 4 test columns.";
      draw();
      return;
    }
    if (f.tests.length > 4) {
      mc.error = "Tick at most 4 tests.";
      draw();
      return;
    }
    try {
      var tbl = subTable([f.truth].concat(f.tests));
      var res = stats().roc(tbl.rows, tbl.columns, f.truth, f.tests.slice(), { positiveLevel: f.posLevel || null });
      var w = [];
      for (var i = 0; i < res.tests.length; i++) {
        if (res.tests[i].dropped > 0) w.push(res.tests[i].name + ": " + res.tests[i].dropped + " rows were left out (missing values).");
      }
      mc.results = {
        kind: "roc", outcome: f.truth, roc: res, warnings: w,
        paragraph: rocView().paragraph(res, rocHelpers()), onDevice: true
      };
      mc.stage = "results";
    } catch (err) {
      mc.error = calm(err && err.message);
    }
    draw();
  }

  function runAnalysis() {
    var S = stats();
    var f = mc.form;
    mc.error = "";
    mc.notice = "";
    if (mc.analysis === "describe") { runDescribe(); return; }
    if (mc.analysis === "survival") { runSurvival(); return; }
    if (mc.analysis === "matched") { runMatched(); return; }
    if (mc.analysis === "roc") { runRoc(); return; }
    try {
      if (mc.analysis === "compare") {
        if (!f.group || !f.outcomes.length) {
          mc.error = "Pick a group column and tick at least one outcome.";
          draw();
          return;
        }
        var items = [];
        var warnings = [];
        var sentences = [];
        for (var i = 0; i < f.outcomes.length; i++) {
          var name = f.outcomes[i];
          try {
            var r = S.compare(colValues(name), colValues(f.group), { outcomeType: mc.types[name], paired: false });
            var sentence = sentenceFor(r, name, groupLevels(f.group));
            if (sentence) sentences.push(sentence);
            if (r.dropped > 0) warnings.push(name + ": " + r.dropped + " rows were left out (missing values).");
            items.push({ name: name, result: r, sentence: sentence });
          } catch (e) {
            items.push({ name: name, error: calm(e && e.message) });
            warnings.push(name + ": " + calm(e && e.message));
          }
        }
        mc.results = { kind: "compare", group: f.group, items: items, warnings: warnings, paragraph: sentences.join(" ") };
      } else if (mc.analysis === "related") {
        if (!f.a || !f.b || f.a === f.b) {
          mc.error = "Pick two different number columns.";
          draw();
          return;
        }
        var rr = S.compare(colValues(f.b), colValues(f.a), { outcomeType: "numeric" });
        var relSentence = sentenceFor(rr, f.b + " vs " + f.a, [f.a]);
        mc.results = {
          kind: "related", a: f.a, b: f.b,
          items: [{ name: f.b + " vs " + f.a, result: rr, sentence: relSentence }],
          warnings: rr.dropped > 0 ? [rr.dropped + " rows were left out (missing values)."] : [],
          paragraph: relSentence
        };
      } else if (mc.analysis === "table1") {
        if (!f.group || !f.variables.length) {
          mc.error = "Pick a group column and tick at least one variable.";
          draw();
          return;
        }
        var t = S.table1(mc.rows, mc.columns, f.group, f.variables, typesMap());
        mc.results = { kind: "table1", group: f.group, table: t, warnings: [], paragraph: "" };
      } else if (mc.analysis === "linear") {
        if (!onDeviceV2Enabled()) {
          mc.stage = "question";
          draw();
          return;
        }
        if (!f.outcome || !f.predictors.length) {
          mc.error = "Pick a number outcome and tick 1 to 6 factors.";
          draw();
          return;
        }
        if (f.predictors.length > 6) {
          mc.error = "Tick at most 6 factors.";
          draw();
          return;
        }
        var linCols = [f.outcome].concat(f.predictors);
        var linSpec = {
          family: "linear",
          outcome: f.outcome,
          predictors: f.predictors.slice(),
          types: typesMap(),
          robust: f.robustHc3 ? "HC3" : null
        };
        var linRows = subTable(linCols);
        runWithDeviceFallback("linear:" + f.outcome, linSpec, function (resumeCtx) {
          return onDeviceStats().run(linSpec, linRows, { signal: resumeCtx && resumeCtx.signal });
        }, function (res) {
          var w = [];
          if (res.dropped > 0) w.push(res.dropped + " rows were left out (missing values).");
          mc.results = {
            kind: "linear", outcome: f.outcome, robust: linSpec.robust, lin: res, warnings: w,
            paragraph: linearParagraph(res, f.outcome), onDevice: true
          };
          mc.stage = "results";
          draw();
        });
        return;
      } else if (mc.analysis === "logistic") {
        if (!f.outcome || !f.predictors.length) {
          mc.error = "Pick a yes-no outcome and tick 1 to 6 risk factors.";
          draw();
          return;
        }
        if (f.predictors.length > 6) {
          mc.error = "Tick at most 6 risk factors.";
          draw();
          return;
        }
        if (onDeviceV2Enabled()) {
          var logCols = [f.outcome].concat(f.predictors);
          var logSpec = {
            family: "logistic",
            outcome: f.outcome,
            predictors: f.predictors.slice(),
            types: typesMap()
          };
          var logRows = subTable(logCols);
          runWithDeviceFallback("logistic:" + f.outcome, logSpec, function (resumeCtx) {
            return onDeviceStats().run(logSpec, logRows, { signal: resumeCtx && resumeCtx.signal });
          }, function (res) {
            var lgDev = adaptLogisticFromDevice(res);
            var lwDev = [];
            if (lgDev.warning) lwDev.push(lgDev.warning);
            mc.results = {
              kind: "logistic", outcome: f.outcome, log: lgDev, warnings: lwDev,
              paragraph: sentenceFor(lgDev, f.outcome, []), onDevice: true
            };
            mc.stage = "results";
            draw();
          });
          return;
        }
        var lg = S.logistic(mc.rows, mc.columns, f.outcome, f.predictors, typesMap());
        var lw = [];
        if (lg.warning) lw.push(lg.warning);
        if (!lg.converged) lw.push("The model could not settle on stable numbers (a factor perfectly predicts the outcome). Try fewer factors.");
        mc.results = {
          kind: "logistic", outcome: f.outcome, log: lg, warnings: lw,
          paragraph: sentenceFor(lg, f.outcome, [])
        };
      } else {
        mc.stage = "question";
        draw();
        return;
      }
      mc.stage = "results";
      draw();
    } catch (err) {
      mc.error = calm(err && err.message);
      draw();
    }
  }

  /* ---------- Case series: describe mode (pure helpers, engine does the maths) ---------- */

  function describeRule(n) {
    if (n <= 5) return "list";
    if (n < 15) return "median-range";
    return "median-mean";
  }

  function isMissingVal(v) {
    if (v == null) return true;
    var s = String(v).replace(/^\s+|\s+$/g, "");
    return s === "" || s === "NA" || s === "N/A" || s === "na" || s === "null" || s === ".";
  }

  function presentNums(values) {
    var out = [];
    for (var i = 0; i < values.length; i++) {
      if (isMissingVal(values[i])) continue;
      var n = Number(values[i]);
      if (isFinite(n)) out.push(n);
    }
    return out;
  }

  function computeDescribeData(columns, rows, types) {
    var S = stats();
    var n = rows.length;
    var rule = describeRule(n);
    var items = [];
    for (var c = 0; c < columns.length; c++) {
      var name = columns[c];
      var values = [];
      for (var r = 0; r < rows.length; r++) values.push(rows[r][c]);
      var type = (types && types[name]) || null;
      var inf = null;
      try { inf = S.inferColumn(name, values); } catch (e) { inf = null; }
      if (inf && inf.phi) continue;
      if (!type) type = inf ? inf.type : "text";
      if (type === "id" || type === "date" || type === "text") continue;
      var d = null;
      try { d = S.describe(values, type); } catch (e) { d = null; }
      if (!d) continue;
      var item = { name: name, type: type, n: d.n, missing: d.missing || 0, rule: rule };
      if (type === "numeric") {
        item.median = d.median; item.q1 = d.q1; item.q3 = d.q3;
        item.min = d.min; item.max = d.max; item.mean = d.mean; item.sd = d.sd;
        if (rule === "list") item.values = presentNums(values);
      } else {
        item.counts = d.counts || [];
      }
      items.push(item);
    }
    return { n: n, rule: rule, items: items, common: commonFeaturesFrom(items) };
  }

  function commonFeaturesFrom(items) {
    var out = [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (it.type === "numeric" || !it.counts || !it.counts.length) continue;
      var top = it.counts[0];
      for (var j = 1; j < it.counts.length; j++) {
        if (it.counts[j].pct > top.pct) top = it.counts[j];
      }
      out.push({ name: it.name, level: top.level, n: top.n, pct: top.pct, of: it.n });
    }
    out.sort(function (a, b) { return b.pct - a.pct; });
    return out;
  }

  function describeParagraph(data) {
    if (!data || !data.n) return "";
    var s = "In this series of " + data.n + " patients";
    if (data.common && data.common.length) {
      var c = data.common[0];
      s += ", the most common feature was " + c.name + " (" + c.level + "), seen in " + c.n + " of " + c.of + " (" + fmt(c.pct, 1) + "%).";
    } else {
      s += ".";
    }
    return s;
  }

  function runDescribe() {
    mc.error = "";
    try {
      var data = computeDescribeData(mc.columns, mc.rows, mc.types);
      mc.results = { kind: "describe", data: data, paragraph: describeParagraph(data), warnings: [] };
      mc.stage = "results";
    } catch (e) {
      mc.error = calm(e && e.message);
    }
    draw();
  }

  /* ---------- Survival (Kaplan-Meier, log-rank, Cox): engine does the maths ---------- */

  function buildKmPath(steps, maxT, x0, x1, y0, y1) {
    function X(t) { return x0 + (maxT > 0 ? (t / maxT) : 0) * (x1 - x0); }
    function Y(s) { return y1 - s * (y1 - y0); }
    var d = "M " + X(0).toFixed(1) + " " + Y(1).toFixed(1);
    for (var i = 0; i < steps.length; i++) {
      var st = steps[i];
      d += " H " + X(st.t).toFixed(1) + " V " + Y(st.survival).toFixed(1);
    }
    return d;
  }

  function riskAtTime(group, T) {
    var n = group.n;
    var steps = group.steps || [];
    for (var i = 0; i < steps.length; i++) {
      if (steps[i].t <= T) n -= (steps[i].events || 0) + (steps[i].censored || 0);
    }
    return n;
  }

  function runSurvival() {
    var S = stats();
    var f = mc.form;
    mc.error = "";
    if (!f.time || !f.event) { mc.error = "Choose a time column and an event column."; draw(); return; }
    if (onDeviceV2Enabled()) {
      var OD = onDeviceStats();
      var svSpec = (f.cox && f.cox.length)
        ? { family: "cox", time: f.time, event: f.event, covariates: f.cox.slice(), types: typesMap() }
        : { family: "km", time: f.time, event: f.event, group: f.sgroup || null };
      function catchDataOnly(err) {
        var JR = jobsRunner();
        var cls = (JR && typeof JR.classifyError === "function") ? JR.classifyError(err, {}) : { counted: false };
        if (cls.counted) throw err;
        return { ok: false, warnings: [calmDeviceError(err)] };
      }
      var kmCols = f.sgroup ? [f.time, f.event, f.sgroup] : [f.time, f.event];
      var kmRows = subTable(kmCols);
      var lrRows = f.sgroup ? subTable([f.time, f.event, f.sgroup]) : null;
      var coxRows = (f.cox && f.cox.length) ? subTable([f.time, f.event].concat(f.cox)) : null;

      runWithDeviceFallback("survival:" + f.time + ":" + f.event, svSpec, function (resumeCtx) {
        var sig = resumeCtx && resumeCtx.signal;
        var kmP = OD.run({ family: "km", time: f.time, event: f.event, group: f.sgroup || null }, kmRows, { signal: sig }).then(
          adaptKmFromDevice,
          catchDataOnly
        );
        var lrP = lrRows
          ? OD.run({ family: "logrank", time: f.time, event: f.event, group: f.sgroup }, lrRows, { signal: sig }).then(
              function (res) { return { ok: true, chi2: res.chisq, df: res.df, p: res.p, table: res.groups, warnings: res.warnings || [] }; },
              catchDataOnly
            )
          : Promise.resolve(null);
        var coxP = coxRows
          ? OD.run({ family: "cox", time: f.time, event: f.event, covariates: f.cox.slice(), types: typesMap() }, coxRows, { signal: sig }).then(
              function (res) {
                var coefs = [];
                for (var j = 0; j < res.coefficients.length; j++) {
                  var c = res.coefficients[j];
                  coefs.push({
                    term: c.term,
                    hr: c.hr,
                    ciLower: c.hrCiLower,
                    ciUpper: c.hrCiUpper,
                    p: c.p,
                    estimable: c.estimable !== false,
                    predictor: c.predictor,
                    level: c.level
                  });
                }
                return { ok: true, converged: true, coefficients: coefs, phTest: res.phTest || null, warnings: res.warnings || [] };
              },
              catchDataOnly
            )
          : Promise.resolve(null);
        return Promise.all([kmP, lrP, coxP]);
      }, function (all) {
        var km = all[0], lr = all[1], cox = all[2];
        var warnings = [];
        if (km && km.warnings) warnings = warnings.concat(km.warnings);
        if (lr && lr.warnings) warnings = warnings.concat(lr.warnings);
        if (cox && cox.warnings) warnings = warnings.concat(cox.warnings);
        var ok = !!(km && km.ok);
        var paragraph = "";
        if (cox && cox.ok && cox.coefficients) {
          for (var k = 0; k < cox.coefficients.length; k++) {
            var co = cox.coefficients[k];
            if (co.estimable === false || co.hr == null || !isFinite(co.hr)) continue;
            var EX = explain();
            if (EX && EX.effect) {
              try {
                paragraph = EX.effect({ measure: "HR", estimate: co.hr, ciLower: co.ciLower, ciUpper: co.ciUpper, p: co.p, outcome: f.event, group: co.term });
              } catch (e) { paragraph = ""; }
            }
            break;
          }
        }
        mc.results = { kind: "survival", ok: ok, km: km, lr: lr, cox: cox, warnings: warnings, paragraph: paragraph, onDevice: true };
        mc.stage = "results";
        draw();
      });
      return;
    }
    var times = colValues(f.time);
    var events = colValues(f.event);
    var groups = f.sgroup ? colValues(f.sgroup) : null;
    var warnings = [];
    var km = null, lr = null, cox = null;
    try { km = S.kaplanMeier(times, events, groups, {}); } catch (e) { km = { ok: false, warnings: [calm(e && e.message)] }; }
    if (km && km.warnings) warnings = warnings.concat(km.warnings);
    if (groups) {
      try { lr = S.logRank(times, events, groups); } catch (e) { lr = { ok: false, warnings: [calm(e && e.message)] }; }
      if (lr && lr.warnings) warnings = warnings.concat(lr.warnings);
    }
    if (f.cox && f.cox.length) {
      var rows = [];
      for (var i = 0; i < mc.rows.length; i++) {
        var row = { time: times[i], event: events[i] };
        for (var p = 0; p < f.cox.length; p++) row[f.cox[p]] = colValues(f.cox[p])[i];
        rows.push(row);
      }
      var predictors = f.cox.map(function (name) {
        return { name: name, type: mc.types[name] === "numeric" ? "numeric" : "categorical" };
      });
      try { cox = S.cox(rows, { time: "time", event: "event", predictors: predictors }); } catch (e) { cox = { ok: false, warnings: [calm(e && e.message)] }; }
      if (cox && cox.warnings) warnings = warnings.concat(cox.warnings);
    }
    var ok = !!(km && km.ok);
    var paragraph = "";
    if (cox && cox.ok && cox.coefficients) {
      for (var k = 0; k < cox.coefficients.length; k++) {
        var co = cox.coefficients[k];
        if (co.estimable === false || co.hr == null || !isFinite(co.hr)) continue;
        var EX = explain();
        if (EX && EX.effect) {
          try {
            paragraph = EX.effect({ measure: "HR", estimate: co.hr, ciLower: co.ciLower, ciUpper: co.ciUpper, p: co.p, outcome: f.event, group: co.term });
          } catch (e) { paragraph = ""; }
        }
        break;
      }
    }
    mc.results = { kind: "survival", ok: ok, km: km, lr: lr, cox: cox, warnings: warnings, paragraph: paragraph };
    mc.stage = "results";
    draw();
  }

  /* ---------- Matched case-control (conditional odds ratio) ---------- */

  function coerceExposed(v) {
    var s = String(v == null ? "" : v).replace(/^\s+|\s+$/g, "").toLowerCase();
    if (s === "1" || s === "yes" || s === "y" || s === "true" || s === "exposed" || s === "case") return 1;
    if (s === "0" || s === "no" || s === "n" || s === "false" || s === "unexposed" || s === "control") return 0;
    return null;
  }

  function buildMatchedPairs(rows, groupCol, exposureCol, setCol, caseLevel) {
    var sets = {};
    var order = [];
    for (var i = 0; i < rows.length; i++) {
      var row = rows[i];
      var key = String(row[setCol]);
      if (!sets[key]) { sets[key] = []; order.push(key); }
      sets[key].push(row);
    }
    var pairs = [];
    var multiControl = false;
    for (var s = 0; s < order.length; s++) {
      var members = sets[order[s]];
      var cases = [], controls = [];
      for (var m = 0; m < members.length; m++) {
        var isCase = String(members[m][groupCol]) === String(caseLevel);
        if (isCase) cases.push(members[m]); else controls.push(members[m]);
      }
      if (cases.length === 1 && controls.length === 1) {
        pairs.push({ caseExposed: coerceExposed(cases[0][exposureCol]), controlExposed: coerceExposed(controls[0][exposureCol]) });
      } else if (cases.length === 1 && controls.length > 1) {
        multiControl = true;
      }
    }
    return { pairs: pairs, multiControl: multiControl };
  }

  function runMatched() {
    var S = stats();
    var f = mc.form;
    mc.error = "";
    if (!f.mgroup || !f.exposure || !f.matchSet) {
      mc.error = "Choose the case/control column, the exposure column and the match-set column.";
      draw(); return;
    }
    var rows = [];
    for (var i = 0; i < mc.rows.length; i++) {
      var obj = {};
      for (var c = 0; c < mc.columns.length; c++) obj[mc.columns[c]] = mc.rows[i][c];
      rows.push(obj);
    }
    var caseLevel = f.caseLevel || (mc.infer[f.mgroup] && mc.infer[f.mgroup].levels && mc.infer[f.mgroup].levels[0]) || "";
    var built = buildMatchedPairs(rows, f.mgroup, f.exposure, f.matchSet, caseLevel);
    if (built.multiControl) {
      mc.results = { kind: "matched", ok: false, warnings: ["Matched analysis for more than one control per case comes in the next update; ask your statistician."], built: built, paragraph: "" };
      mc.stage = "results"; draw(); return;
    }
    var res = null;
    try { res = S.matchedOr(built.pairs); } catch (e) { res = { ok: false, warnings: [calm(e && e.message)] }; }
    var paragraph = "";
    if (res && res.ok && res.or != null && isFinite(res.or)) {
      var EX = explain();
      if (EX && EX.effect) {
        try { paragraph = EX.effect({ measure: "OR", estimate: res.or, ciLower: res.ciLower, ciUpper: res.ciUpper, p: res.p, outcome: f.exposure }); } catch (e) { paragraph = ""; }
      }
    }
    mc.results = { kind: "matched", ok: !!(res && res.ok), res: res, warnings: (res && res.warnings) || [], built: built, paragraph: paragraph };
    mc.stage = "results";
    draw();
  }

  function pickAnalysis(key) {
    mc.analysis = key;
    mc.error = "";
    mc.notice = "";
    var groups = groupOptions();
    var f = mc.form;
    if (key === "compare" || key === "table1") {
      if (!f.group || groups.indexOf(f.group) < 0) f.group = groups[0] || "";
    }
    if (key === "compare") f.outcomes = [];
    if (key === "table1") {
      f.variables = eligible().filter(function (c) { return c !== f.group; });
    }
    if (key === "logistic") {
      f.outcome = binaryOptions()[0] || "";
      f.predictors = [];
    }
    if (key === "linear") {
      f.outcome = numericOptions()[0] || "";
      f.predictors = [];
      f.robustHc3 = false;
    }
    if (key === "related") {
      var nums = numericOptions();
      f.a = nums[0] || "";
      f.b = nums[1] || nums[0] || "";
    }
    if (key === "describe") { runDescribe(); return; }
    if (key === "survival") {
      var sn = numericOptions();
      f.time = f.time || sn[0] || "";
      f.event = f.event || binaryOptions()[0] || "";
      f.sgroup = f.sgroup || groups[0] || "";
      f.cox = f.cox || [];
    }
    if (key === "roc") {
      f.truth = (f.truth && binaryOptions().indexOf(f.truth) >= 0) ? f.truth : (binaryOptions()[0] || "");
      f.posLevel = stats().defaultPositiveLevel(rocLevels(f.truth)) || "";
      f.tests = [];
    }
    if (key === "matched") {
      f.mgroup = f.mgroup || groups[0] || "";
      f.exposure = f.exposure || binaryOptions()[0] || "";
      f.matchSet = f.matchSet || "";
      f.caseLevel = f.caseLevel || (mc.infer[f.mgroup] && mc.infer[f.mgroup].levels && mc.infer[f.mgroup].levels[0]) || "";
    }
    mc.stage = "form";
    draw();
  }

  /* ---------- Plain-language glosses (research-explain.js) ---------- */

  /* Table 1 row name: "Age, mean ± SD" or "Sex: Female" (the label alone does not say which variable) */
  function t1Label(row) {
    if (!row.label) return row.variable;
    return row.type === "numeric" ? row.variable + ", " + row.label : row.variable + ": " + row.label;
  }

  function effectGloss(effect, p, groupLabel) {
    if (!effect || effect.estimate == null) return "";
    var m = effect.measure;
    if (m !== "MD" && m !== "OR" && m !== "RR" && m !== "HR" && m !== "SMD") return "";
    if (!isFinite(effect.estimate) || !isFinite(effect.ciLower) || !isFinite(effect.ciUpper)) return "";
    var EX = G.SMD_RESEARCH_EXPLAIN;
    if (!EX || !EX.effect) return "";
    try {
      var opts = {
        measure: m, estimate: effect.estimate,
        ciLower: effect.ciLower, ciUpper: effect.ciUpper
      };
      if (p != null && isFinite(p) && p >= 0 && p <= 1) opts.p = p;
      if (groupLabel) opts.group = groupLabel;
      return EX.effect(opts);
    } catch (e) { return ""; }
  }

  function pGloss(p) {
    var EX = G.SMD_RESEARCH_EXPLAIN;
    if (!EX || !EX.pValue || p == null || !isFinite(p) || p < 0 || p > 1) return "";
    try { return EX.pValue(p); } catch (e) { return ""; }
  }

  function correlationLine(result) {
    var e = result.effect;
    if (!e || e.estimate == null || !isFinite(e.estimate)) return "";
    var s = (e.measure === "rho" ? "Spearman rho" : "Pearson r") + " = " + fmt(e.estimate, 3);
    if (isFinite(e.ciLower) && isFinite(e.ciUpper)) {
      s += ", 95% CI " + fmt(e.ciLower) + " to " + fmt(e.ciUpper);
    }
    return s;
  }

  function describeSummary(d) {
    if (!d) return "";
    if (d.mean != null && isFinite(d.mean)) {
      var s = fmt(d.mean) + " ± " + fmt(d.sd);
      if (d.median != null && isFinite(d.median)) s += " (median " + fmt(d.median) + ")";
      return s;
    }
    if (d.counts && d.counts.length) {
      var parts = [];
      for (var i = 0; i < d.counts.length; i++) {
        var c = d.counts[i];
        parts.push(esc(c.level) + ": " + c.n + " (" + fmt(c.pct) + "%)");
      }
      return parts.join(", ");
    }
    return "n = " + (d.n != null ? d.n : "");
  }

  function pStr(p) {
    if (typeof p === "string") return p;
    if (p == null || !isFinite(p)) return "";
    try { return stats().formatP(p); } catch (e) { return String(p); }
  }

  /* ---------- Export text builders ---------- */

  function table1Text(t, group) {
    var lines = ["Table 1. Baseline characteristics by " + group + "."];
    var head = ["Variable", "Overall"];
    for (var i = 0; i < t.groups.length; i++) {
      head.push(t.groups[i].name + " (n=" + t.groups[i].n + ")");
    }
    head.push("p");
    lines.push(head.join(" | "));
    for (var r = 0; r < t.rows.length; r++) {
      var row = t.rows[r];
      var cells = [t1Label(row), row.overall];
      for (var c = 0; c < row.cells.length; c++) cells.push(row.cells[c]);
      cells.push(pStr(row.p));
      lines.push(cells.join(" | "));
    }
    return lines.join("\n");
  }

  function compareText(r) {
    var lines = [];
    for (var i = 0; i < r.items.length; i++) {
      var it = r.items[i];
      if (!it.result) continue;
      var res = it.result;
      var line = it.name + ": " + res.label + "; " + res.statisticName + " = " + fmt(res.statistic, 3) + ", " + pStr(res.p);
      var e = res.effect;
      if (e && e.estimate != null && isFinite(e.estimate)) {
        line += "; " + e.measure + " " + fmt(e.estimate);
        if (isFinite(e.ciLower) && isFinite(e.ciUpper)) line += " (95% CI " + fmt(e.ciLower) + " to " + fmt(e.ciUpper) + ")";
      }
      lines.push(line);
    }
    return lines.join("\n");
  }

  function linearText(r) {
    var ln = r.lin;
    var lines = ["Linear regression for " + r.outcome + " (n = " + ln.n + ", R2 = " + fmt(ln.r2, 3) + ", AIC = " + fmt(ln.aic, 2) + (r.robust === "HC3" ? ", HC3 robust errors" : "") + ")."];
    for (var i = 0; i < ln.coefficients.length; i++) {
      var c = ln.coefficients[i];
      lines.push(c.term + ": estimate " + fmt(c.estimate, 3) + " (SE " + fmt(c.se, 3) + ", 95% CI " + fmt(c.ciLower, 3) + " to " + fmt(c.ciUpper, 3) + "), " + pStr(c.p));
    }
    return lines.join("\n");
  }

  function logisticText(r) {
    var lg = r.log;
    var lines = ["Logistic regression for " + r.outcome + " (n = " + lg.n + ", events = " + lg.events + ")."];
    for (var i = 0; i < lg.coefficients.length; i++) {
      var c = lg.coefficients[i];
      if (c.name === "Intercept") continue;
      var line = c.name + ": OR " + fmt(c.or);
      if (isFinite(c.ciLower) && isFinite(c.ciUpper)) line += " (95% CI " + fmt(c.ciLower) + " to " + fmt(c.ciUpper) + ")";
      line += ", " + pStr(c.p);
      lines.push(line);
    }
    return lines.join("\n");
  }

  function describeText(r) {
    var data = r.data;
    var lines = ["Case series description (n = " + data.n + ")."];
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i];
      if (it.type === "numeric") {
        if (it.rule === "list") {
          lines.push(it.name + ": " + (it.values || []).join(", "));
        } else {
          lines.push(it.name + ": median " + fmt(it.median, 1) + " (IQR " + fmt(it.q1, 1) + " to " + fmt(it.q3, 1) + "), range " + fmt(it.min, 1) + " to " + fmt(it.max, 1));
        }
      } else {
        var parts = [];
        for (var j = 0; j < it.counts.length; j++) parts.push(it.counts[j].level + " " + it.counts[j].n + " (" + fmt(it.counts[j].pct, 1) + "%)");
        lines.push(it.name + ": " + parts.join(", "));
      }
    }
    return lines.join("\n");
  }

  function survivalText(r) {
    var lines = ["Time to event (survival analysis)."];
    if (r.km && r.km.groups) {
      for (var i = 0; i < r.km.groups.length; i++) {
        var g = r.km.groups[i];
        var med = g.median && g.median.value != null ? fmt(g.median.value, 1) : "not reached";
        lines.push(g.name + ": n = " + g.n + ", events = " + g.nEvents + ", median survival " + med);
      }
    }
    if (r.lr && r.lr.ok && r.lr.p != null) lines.push("Log-rank p = " + pStr(r.lr.p));
    if (r.cox && r.cox.ok && r.cox.coefficients) {
      for (var k = 0; k < r.cox.coefficients.length; k++) {
        var co = r.cox.coefficients[k];
        if (co.estimable === false) { lines.push(co.term + ": hazard ratio could not be estimated (separation)."); continue; }
        lines.push(co.term + ": HR " + fmt(co.hr) + " (95% CI " + fmt(co.ciLower) + " to " + fmt(co.ciUpper) + "), " + pStr(co.p));
      }
      if (r.cox.phTest && r.cox.phTest.global) {
        lines.push("Proportional hazards check (Schoenfeld): global chi-square = " + fmt(r.cox.phTest.global.chisq, 2) + ", df = " + r.cox.phTest.global.df + ", " + pStr(r.cox.phTest.global.p) + ".");
      }
    }
    return lines.join("\n");
  }

  function matchedText(r) {
    if (!r.res || !r.res.ok) return "Matched case-control analysis.";
    var res = r.res;
    var orStr = isFinite(res.or) ? fmt(res.or) : "very large (report only the lower limit)";
    return "Matched case-control: " + res.b + " pairs exposed only in the case, " + res.c + " only in the control. Conditional odds ratio " + orStr + " (95% CI " + fmt(res.ciLower) + " to " + (isFinite(res.ciUpper) ? fmt(res.ciUpper) : "not estimable") + "), " + pStr(res.p) + " (" + res.method + ").";
  }

  function manuscriptText() {
    var r = mc.results;
    var parts = [];
    if (r.paragraph) parts.push(r.paragraph);
    if (r.kind === "table1") parts.push(table1Text(r.table, r.group));
    else if (r.kind === "linear") parts.push(linearText(r));
    else if (r.kind === "logistic") parts.push(logisticText(r));
    else if (r.kind === "describe") parts.push(describeText(r));
    else if (r.kind === "survival") parts.push(survivalText(r));
    else if (r.kind === "matched") parts.push(matchedText(r));
    else if (r.kind === "roc") parts.push(rocView().manuscriptText(r.roc, rocHelpers()));
    else parts.push(compareText(r));
    return parts.join("\n\n");
  }

  function csvCell(v) {
    var s = v == null ? "" : String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function projectTitle() {
    var store = SMD.store;
    var proj = store && store.getProject ? store.getProject(mc.pid) : null;
    return (proj && proj.title) || "Master chart";
  }

  function exportCsv() {
    var r = mc.results;
    if (!r || !SMD.p2) return;
    var lines = [];
    var i;
    if (r.kind === "compare" || r.kind === "related") {
      lines.push(["Outcome", "Test", "Statistic", "Value", "df", "p", "Effect", "Estimate", "CI lower", "CI upper", "Rows dropped"]);
      for (i = 0; i < r.items.length; i++) {
        var it = r.items[i];
        if (!it.result) continue;
        var res = it.result;
        var e = res.effect || {};
        lines.push([it.name, res.label, res.statisticName, fmt(res.statistic, 3),
          res.df == null ? "" : res.df, pStr(res.p), e.measure || "",
          e.estimate == null ? "" : fmt(e.estimate), e.ciLower == null ? "" : fmt(e.ciLower),
          e.ciUpper == null ? "" : fmt(e.ciUpper), res.dropped || 0]);
      }
    } else if (r.kind === "table1") {
      var head = ["Variable", "Overall"];
      for (i = 0; i < r.table.groups.length; i++) head.push(r.table.groups[i].name);
      head.push("p");
      head.push("Test");
      lines.push(head);
      for (i = 0; i < r.table.rows.length; i++) {
        var row = r.table.rows[i];
        var cells = [t1Label(row), row.overall];
        for (var c = 0; c < row.cells.length; c++) cells.push(row.cells[c]);
        cells.push(pStr(row.p));
        cells.push(row.test || "");
        lines.push(cells);
      }
    } else if (r.kind === "linear") {
      lines.push(["Factor", "Estimate", "SE", "t", "CI lower", "CI upper", "p"]);
      for (i = 0; i < r.lin.coefficients.length; i++) {
        var cl = r.lin.coefficients[i];
        lines.push([cl.term, fmt(cl.estimate, 4), fmt(cl.se, 4), fmt(cl.t, 3), fmt(cl.ciLower, 4), fmt(cl.ciUpper, 4), pStr(cl.p)]);
      }
    } else if (r.kind === "logistic") {
      lines.push(["Factor", "OR", "CI lower", "CI upper", "p"]);
      for (i = 0; i < r.log.coefficients.length; i++) {
        var co = r.log.coefficients[i];
        if (co.name === "Intercept") continue;
        lines.push([co.name, fmt(co.or), fmt(co.ciLower), fmt(co.ciUpper), pStr(co.p)]);
      }
    } else if (r.kind === "describe") {
      lines.push(["Variable", "Type", "n", "Missing", "Summary"]);
      for (i = 0; i < r.data.items.length; i++) {
        var it = r.data.items[i];
        var sum = it.type === "numeric"
          ? (it.rule === "list" ? (it.values || []).join("; ") : "median " + fmt(it.median, 1) + " (IQR " + fmt(it.q1, 1) + " to " + fmt(it.q3, 1) + ")")
          : it.counts.map(function (x) { return x.level + " " + x.n + " (" + fmt(x.pct, 1) + "%)"; }).join("; ");
        lines.push([it.name, it.type, it.n, it.missing, sum]);
      }
    } else if (r.kind === "survival") {
      lines.push(["Group", "n", "Events", "Median survival", "CI lower", "CI upper"]);
      if (r.km && r.km.groups) {
        for (i = 0; i < r.km.groups.length; i++) {
          var g = r.km.groups[i];
          var med = g.median || {};
          lines.push([g.name, g.n, g.nEvents, med.value == null ? "not reached" : fmt(med.value, 1), med.lower == null ? "" : fmt(med.lower, 1), med.upper == null ? "" : fmt(med.upper, 1)]);
        }
      }
    } else if (r.kind === "roc") {
      lines = rocView().csvRows(r.roc, rocHelpers());
    } else if (r.kind === "matched") {
      lines.push(["b", "c", "OR", "CI lower", "CI upper", "p", "Method"]);
      if (r.res && r.res.ok) lines.push([r.res.b, r.res.c, isFinite(r.res.or) ? fmt(r.res.or) : "Inf", fmt(r.res.ciLower), isFinite(r.res.ciUpper) ? fmt(r.res.ciUpper) : "", pStr(r.res.p), r.res.method]);
    }
    var csv = lines.map(function (row) { return row.map(csvCell).join(","); }).join("\r\n");
    SMD.p2.downloadText(SMD.p2.fileSlug(projectTitle(), "master-chart") + "-results.csv", csv, "text/csv");
  }

  function exportDocx() {
    var r = mc.results;
    if (!r || r.kind !== "table1" || !SMD.docxFromSections || !SMD.p2) return;
    var title = projectTitle() + " Table 1";
    var bytes = SMD.docxFromSections(title, [
      { id: "table1", heading: "Table 1", level: 1, text: table1Text(r.table, r.group) }
    ]);
    SMD.p2.downloadBytes(
      SMD.p2.fileSlug(projectTitle(), "master-chart") + "-table1.docx",
      bytes,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      title
    );
  }

  function useInManuscript() {
    if (!mc.results) return;
    if (!SMD.appendManuscriptResults) {
      mc.error = "The manuscript screen is not available.";
      draw();
      return;
    }
    SMD.appendManuscriptResults(mc.pid, manuscriptText()).then(function () {
      mc.notice = "Added to the Results section of your manuscript. Nothing was overwritten.";
      draw();
    }, function () {
      mc.error = "Could not add to the manuscript just now. Try again.";
      draw();
    });
  }

  /* ---------- Rendering ---------- */

  function injectCss() {
    if (document.getElementById("rmdMasterchartCss")) return;
    var s = document.createElement("style");
    s.id = "rmdMasterchartCss";
    s.textContent = [
      "#researchMD .rmd-mc-screen { padding: 16px; max-width: 1100px; margin: 0 auto; width: 100%; box-sizing: border-box; }",
      "#researchMD .rmd-mc-head h2 { margin: 0 0 4px; font: 700 20px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-privacy { font: 500 13px var(--rmd-f); color: var(--rmd-mut); margin: 8px 0; }",
      "#researchMD .rmd-mc-samplebadge { display: inline-block; margin: 0 0 8px; }",
      "#researchMD .rmd-mc-upload { display: flex; flex-direction: column; gap: 10px; align-items: flex-start; padding: 16px; }",
      "#researchMD .rmd-mc-fileinput { position: absolute; width: 1px; height: 1px; opacity: 0; overflow: hidden; }",
      "#researchMD .rmd-mc-filelabel { cursor: pointer; display: inline-flex; align-items: center; }",
      "#researchMD .rmd-mc-grid { display: grid; grid-template-columns: 1fr; gap: 12px; margin: 12px 0; }",
      "#researchMD .rmd-mc-colcard { background: var(--rmd-panel); border: 1px solid var(--rmd-line); border-radius: 12px; padding: 12px; }",
      "#researchMD .rmd-mc-colname { display: flex; align-items: baseline; justify-content: space-between; gap: 8px; margin-bottom: 8px; }",
      "#researchMD .rmd-mc-colname strong { font: 600 14px var(--rmd-f); color: var(--rmd-ink); word-break: break-word; }",
      "#researchMD .rmd-mc-missing { font: 400 12px var(--rmd-f); color: var(--rmd-mut); white-space: nowrap; }",
      "#researchMD .rmd-mc-chips { display: flex; flex-wrap: wrap; gap: 6px; }",
      "#researchMD .rmd-mc-choices { display: flex; flex-direction: column; gap: 10px; margin: 12px 0; }",
      "#researchMD .rmd-mc-actions { display: flex; flex-wrap: wrap; gap: 8px; margin: 14px 0; }",
      "#researchMD .rmd-mc-result { padding: 14px 16px; margin: 12px 0; }",
      "#researchMD .rmd-mc-result h3 { margin: 0 0 6px; font: 700 15.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-test { margin: 4px 0; font: 400 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-why { color: var(--rmd-mut); }",
      "#researchMD .rmd-mc-stat { margin: 4px 0; font: 600 14px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-gloss { margin: 4px 0; font: 400 13px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-mc-sentence { background: var(--rmd-acc-soft); border-radius: 10px; padding: 10px 12px; font: 400 14px/1.5 var(--rmd-f); color: var(--rmd-ink); margin: 8px 0; }",
      "#researchMD .rmd-mc-tablewrap { overflow-x: auto; margin: 8px 0; }",
      "#researchMD .rmd-mc-table { width: 100%; border-collapse: collapse; font: 400 13px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-table th, #researchMD .rmd-mc-table td { text-align: left; padding: 7px 9px; border-bottom: 1px solid var(--rmd-line); white-space: nowrap; }",
      "#researchMD .rmd-mc-table th { font-weight: 600; background: var(--rmd-fill); }",
      "#researchMD .rmd-mc-checklist { display: flex; flex-direction: column; gap: 6px; margin: 8px 0; }",
      "#researchMD .rmd-mc-check { display: flex; align-items: center; gap: 8px; font: 400 14px var(--rmd-f); color: var(--rmd-ink); min-height: 32px; }",
      "#researchMD .rmd-mc-check input { width: 18px; height: 18px; }",
      "#researchMD .rmd-mc-toggle { display: flex; align-items: center; gap: 8px; min-height: 44px; font: 500 14px var(--rmd-f); color: var(--rmd-ink); margin: 10px 0; }",
      "#researchMD .rmd-mc-toggle input { width: 20px; height: 20px; }",
      "#researchMD .rmd-mc-km { width: 100%; height: auto; display: block; margin: 8px 0; }",
      "#researchMD .rmd-mc-roc { width: 100%; max-width: 560px; height: auto; display: block; margin: 8px 0; }",
      "#researchMD .rmd-mc-risk { font: 400 12px var(--rmd-f); color: var(--rmd-mut); }",
      "#researchMD .rmd-mc-atrisk { width: 100%; border-collapse: collapse; font: 400 12px var(--rmd-f); color: var(--rmd-mut); margin: 4px 0 10px; }",
      "#researchMD .rmd-mc-atrisk td, #researchMD .rmd-mc-atrisk th { padding: 3px 6px; text-align: center; border-bottom: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-mc-list { font: 400 14px/1.6 var(--rmd-f); color: var(--rmd-ink); margin: 6px 0; word-break: break-word; }",
      "#researchMD .rmd-mc-common { margin: 8px 0; }",
      "#researchMD .rmd-mc-ph { font: 400 13px/1.5 var(--rmd-f); color: var(--rmd-mut); margin: 8px 0; }",
      "#researchMD .rmd-mc-ph-warn { color: var(--rmd-warn); font-weight: 500; }",
      "#researchMD .rmd-mc-phtest { margin: 12px 0 4px; padding-top: 8px; border-top: 1px solid var(--rmd-line); }",
      "#researchMD .rmd-mc-phtest h4 { margin: 0 0 6px; font: 600 13.5px var(--rmd-f); color: var(--rmd-ink); }",
      "#researchMD .rmd-mc-ondevice { display: inline-block; margin: 2px 0 8px; }",
      "#researchMD .rmd-mc-cox-sep { color: var(--rmd-warn); }",
      /* Shared base only forces 44px targets at iPad width and skips date inputs; scope phone fixes here. */
      "#researchMD .rmd-mc-screen .rmd-btn, #researchMD .rmd-mc-screen label.rmd-btn { min-height: 44px; }",
      "#researchMD .rmd-mc-screen input[type=text], #researchMD .rmd-mc-screen input[type=number], #researchMD .rmd-mc-screen input[type=date], #researchMD .rmd-mc-screen select, #researchMD .rmd-mc-screen textarea { min-height: 44px; }",
      "#researchMD .rmd-mc-screen input[type=date] { width: 100%; border: 1px solid var(--rmd-line); border-radius: 8px; padding: 9px 12px; font: 400 14.5px var(--rmd-f); color: var(--rmd-ink); background: var(--rmd-panel); }",
      "#researchMD .rmd-mc-screen .rmd-mc-check { min-height: 44px; }",
      "#researchMD .rmd-mc-screen .rmd-mc-chips .rmd-chip { min-height: 44px; }",
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-mc-grid { grid-template-columns: 1fr 1fr; }",
      "  #researchMD .rmd-mc-chips .rmd-chip { min-height: 44px; }",
      "  #researchMD .rmd-mc-check { min-height: 44px; }",
      "}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function labelFor(key) {
    var C = contracts();
    return (C && C.STEP_LABELS && C.STEP_LABELS[key]) || key;
  }

  function mcStepHtml() {
    var j = mc.journey || [];
    var idx = j.indexOf("masterchart");
    if (idx < 0) return "";
    var h = '<div class="rmd-step-banner"><span class="rmd-step-line">Step ' + (idx + 1) + " of " + j.length + '</span>';
    h += '<span class="rmd-step-text">' + esc(labelFor("masterchart")) + "</span></div>";
    var nextKey = j[idx + 1];
    if (nextKey) h += '<p class="rmd-next-line">Next: ' + esc(labelFor(nextKey)) + "</p>";
    return h;
  }

  function bannerHtml() {
    var h = "";
    if (mc.isRct && mc.ctri === false) {
      h += '<div class="rmd-banner rmd-banner-warn" role="alert">Register on CTRI before you enrol the first patient.</div>';
    }
    if (mc.isStudy && mc.iecStatus !== "approved" && mc.iecStatus !== "waiver") {
      h += '<div class="rmd-banner rmd-banner-info" role="status">The ethics committee has not approved this study yet. Enter patient data only after approval or a waiver.</div>';
    }
    return h;
  }

  function headHtml(title, sub) {
    var h = mcStepHtml();
    h += '<div class="rmd-mc-head"><h2>' + esc(title) + '</h2>';
    if (sub) h += '<p class="rmd-screen-subtitle">' + esc(sub) + '</p>';
    h += '</div>';
    h += bannerHtml();
    h += '<p class="rmd-mc-privacy">Your master chart stays on this phone. Nothing is uploaded.</p>';
    if (mc.sample) h += '<span class="rmd-badge rmd-badge-pill rmd-mc-samplebadge">Sample data (not real patients)</span>';
    if (mc.notice) h += '<div class="rmd-banner rmd-banner-info" role="status">' + esc(mc.notice) + '</div>';
    if (mc.error) h += '<div class="rmd-banner rmd-banner-warn" role="alert">' + esc(mc.error) + '</div>';
    return h;
  }

  function selectHtml(id, options, selected) {
    var h = '<select id="' + id + '">';
    for (var i = 0; i < options.length; i++) {
      h += '<option value="' + esc(options[i]) + '"' + (options[i] === selected ? ' selected' : '') + '>' + esc(options[i]) + '</option>';
    }
    h += '</select>';
    return h;
  }

  function checkListHtml(listName, options, checked, max) {
    var h = '<div class="rmd-mc-checklist">';
    for (var i = 0; i < options.length; i++) {
      var on = checked.indexOf(options[i]) >= 0;
      var disabled = !on && max && checked.length >= max;
      h += '<label class="rmd-mc-check"><input type="checkbox" class="rmd-mc-check-input" data-rmd-mc-list="' + listName + '" value="' + esc(options[i]) + '"' +
        (on ? ' checked' : '') + (disabled ? ' disabled' : '') + '> ' + esc(options[i]) + '</label>';
    }
    h += '</div>';
    return h;
  }

  function drawUpload() {
    var h = headHtml("Analyse my master chart", "Upload the Excel sheet with one row per patient. We pick the right tests and write Table 1 and the results.");
    h += '<div class="rmd-card rmd-mc-upload">';
    h += '  <label class="rmd-btn rmd-btn-primary rmd-mc-filelabel" for="rmdMcFile">Upload master chart (.csv or .xlsx)</label>';
    h += '  <input type="file" id="rmdMcFile" class="rmd-mc-fileinput" accept=".csv,.xlsx,text/csv,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet">';
    h += '  <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-mc="sample">Try with a sample thesis</button>';
    if (loadLocal(mc.pid)) {
      h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="use-saved">Use the chart saved on this phone</button>';
    }
    h += '  <p class="rmd-muted">CSV works everywhere. Excel (.xlsx) is read on this phone when supported.</p>';
    h += '</div>';
    return h;
  }

  function drawIdentifiers() {
    var h = headHtml("Check for patient identifiers", mc.rows.length + " patients, " + mc.columns.length + " columns in " + mc.fileName + ".");
    if (mc.phiCols.length) {
      h += '<div class="rmd-banner rmd-banner-warn" role="alert"><strong>Patient identifiers (names, phone numbers, hospital numbers) found in: ' +
        esc(mc.phiCols.join(", ")) + '.</strong> They are left out of every analysis.</div>';
    } else {
      h += '<div class="rmd-banner rmd-banner-info" role="status">No patient identifier columns were found.</div>';
    }
    h += '<div class="rmd-mc-actions">';
    h += '  <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-mc="continue-identifiers">Continue to columns</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="back-upload">Upload a different chart</button>';
    h += '</div>';
    return h;
  }

  function drawColumns() {
    var h = headHtml("Check the column types", "Tap a type to change it. Identifier columns are left out of every analysis.");
    h += '<div class="rmd-mc-grid">';
    for (var i = 0; i < mc.columns.length; i++) {
      var name = mc.columns[i];
      var inf = mc.infer[name] || {};
      h += '<div class="rmd-mc-colcard" data-rmd-mc-colcard="' + esc(name) + '">';
      h += '  <div class="rmd-mc-colname"><strong>' + esc(name) + '</strong><span class="rmd-mc-missing">' + (inf.missing || 0) + ' missing</span></div>';
      if (isPhi(name)) {
        h += '  <span class="rmd-badge rmd-badge-pill">Left out (identifier)</span>';
      } else {
        h += '  <div class="rmd-mc-chips">';
        for (var t = 0; t < TYPE_TOKENS.length; t++) {
          var tok = TYPE_TOKENS[t];
          h += '<button type="button" class="rmd-chip' + (mc.types[name] === tok ? ' rmd-chip-active' : '') + '" data-rmd-mc-type="' + tok + '" data-rmd-mc-col="' + esc(name) + '">' + TYPE_LABELS[tok] + '</button>';
        }
        h += '  </div>';
      }
      h += '</div>';
    }
    h += '</div>';
    h += '<div class="rmd-mc-actions">';
    h += '  <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-mc="continue-columns">Continue</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-mc="save-phone">Save on this phone</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="back-upload">Upload a different chart</button>';
    h += '</div>';
    return h;
  }

  function drawQuestion() {
    var h = headHtml("What do you want to find?", "Pick one. You can come back and ask another question.");
    h += '<div class="rmd-mc-choices">';
    h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="compare">Compare groups<span>Does HbA1c at 12 weeks differ between Drug A and Drug B? Pick a group column and one or more outcomes.</span></button>';
    h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="table1">Table 1 (baseline characteristics)<span>Age, sex and BMI by group, with p values. The first table of most papers.</span></button>';
    h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="logistic">Risk factors (logistic regression)<span>Which factors raise the odds of a yes-no outcome, like a complication? Up to 6 factors.</span></button>';
    if (onDeviceV2Enabled()) {
      h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="linear">Linear regression (numeric outcome)<span>How much does a number outcome like HbA1c change for each factor? Up to 6 factors.</span></button>';
    }
    if (rocEnabled()) {
      h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="roc">How good is a test? (ROC curve and AUC)<span>How well does a lab value or score, like troponin or a CURB-65 score, pick out a yes-no diagnosis? Best cut-off with sensitivity and specificity. Compare up to 4 tests.</span></button>';
    }
    h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="related">Is it related?<span>Is BMI related to HbA1c? Correlation between two number columns.</span></button>';
    if (mc.isSeries) {
      h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="describe">Describe the series<span>List every value for a small series, or median (IQR) and range. Counts as n (%). No hypothesis test unless you ask.</span></button>';
    }
    if (mc.isCohort) {
      h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="survival">Time to event (survival analysis)<span>Kaplan-Meier curves, median survival, log-rank test and a Cox model for hazard ratios.</span></button>';
    }
    if (mc.matched) {
      h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="matched">Matched case-control (odds ratio)<span>Conditional odds ratio from matched pairs (pairs that differ in exposure).</span></button>';
    }
    h += '</div>';
    h += '<label class="rmd-mc-toggle"><input type="checkbox" id="rmdMcMatched"' + (mc.matched ? ' checked' : '') + '> My controls were matched</label>';
    return h;
  }

  function drawForm() {
    var f = mc.form;
    var h = "";
    var groups = groupOptions();
    var nums = numericOptions();
    var bins = binaryOptions();
    var elig = eligible();
    if (mc.analysis === "compare") {
      h += headHtml("Compare groups", "Pick the group column, then tick the outcomes to compare.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcGroup">Group column</label>' + selectHtml("rmdMcGroup", groups, f.group) + '</div>';
      h += '  <div class="rmd-field"><label>Outcomes to compare</label>' + checkListHtml("outcomes", elig.filter(function (c) { return mc.types[c] === "numeric" || mc.types[c] === "binary"; }), f.outcomes, 0) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "table1") {
      h += headHtml("Table 1 (baseline characteristics)", "Pick the group column and tick the variables for the table.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcGroup">Group column</label>' + selectHtml("rmdMcGroup", groups, f.group) + '</div>';
      h += '  <div class="rmd-field"><label>Variables</label>' + checkListHtml("variables", elig.filter(function (c) { return c !== f.group; }), f.variables, 0) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "linear") {
      h += headHtml("Linear regression (numeric outcome)", "Pick a number outcome and up to 6 factors.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcOutcome">Outcome (number)</label>' + selectHtml("rmdMcOutcome", nums, f.outcome) + '</div>';
      h += '  <div class="rmd-field"><label>Factors (up to 6)</label>' + checkListHtml("predictors", elig.filter(function (c) { return c !== f.outcome && mc.types[c] !== "text" && mc.types[c] !== "date"; }), f.predictors, 6) + '</div>';
      h += '  <label class="rmd-mc-toggle"><input type="checkbox" id="rmdMcHc3"' + (f.robustHc3 ? ' checked' : '') + '> HC3 robust errors</label>';
      h += '</div>';
    } else if (mc.analysis === "logistic") {
      h += headHtml("Risk factors (logistic regression)", "Pick a yes-no outcome and up to 6 risk factors.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcOutcome">Outcome (yes-no)</label>' + selectHtml("rmdMcOutcome", bins, f.outcome) + '</div>';
      h += '  <div class="rmd-field"><label>Risk factors (up to 6)</label>' + checkListHtml("predictors", elig.filter(function (c) { return c !== f.outcome && mc.types[c] !== "text" && mc.types[c] !== "date"; }), f.predictors, 6) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "related") {
      h += headHtml("Is it related?", "Pick two number columns. We compute the correlation.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcA">First number column</label>' + selectHtml("rmdMcA", nums, f.a) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcB">Second number column</label>' + selectHtml("rmdMcB", nums, f.b) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "survival") {
      h += headHtml("Time to event (survival analysis)", "Pick the time column, the event (yes-no) column and an optional group. Add Cox factors only if you need adjusted hazard ratios.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcTime">Time column (number)</label>' + selectHtml("rmdMcTime", nums, f.time) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcEvent">Event column (yes-no)</label>' + selectHtml("rmdMcEvent", bins, f.event) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcSgroup">Group column (optional)</label>' + selectHtml("rmdMcSgroup", [""].concat(groups), f.sgroup) + '</div>';
      h += '  <div class="rmd-field"><label>Cox factors (optional)</label>' + checkListHtml("cox", elig.filter(function (c) { return c !== f.time && c !== f.event && mc.types[c] !== "text" && mc.types[c] !== "date"; }), f.cox, 0) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "roc") {
      h += headHtml("How good is a test? (ROC curve)", "Pick the yes-no column that says who truly has the condition, then tick the test values to check.");
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcTruth">Who has the condition (yes-no, the reference standard)</label>' + selectHtml("rmdMcTruth", bins, f.truth) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcPosLevel">Which value means they have it?</label>' + selectHtml("rmdMcPosLevel", rocLevels(f.truth), f.posLevel) + '</div>';
      h += '  <div class="rmd-field"><label>Tests or scores (numbers, up to 4)</label>' + checkListHtml("tests", nums.filter(function (c) { return c !== f.truth; }), f.tests, 4) + '</div>';
      h += '</div>';
    } else if (mc.analysis === "matched") {
      h += headHtml("Matched case-control (odds ratio)", "Pick the case/control column, the exposure column and the match-set column that links each case to its controls.");
      var mlevels = (mc.infer[f.mgroup] && mc.infer[f.mgroup].levels) || [];
      h += '<div class="rmd-form">';
      h += '  <div class="rmd-field"><label for="rmdMcMgroup">Case/control column</label>' + selectHtml("rmdMcMgroup", groups, f.mgroup) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcCaseLevel">Which level is the case?</label>' + selectHtml("rmdMcCaseLevel", mlevels, f.caseLevel) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcExposure">Exposure column (yes-no)</label>' + selectHtml("rmdMcExposure", bins, f.exposure) + '</div>';
      h += '  <div class="rmd-field"><label for="rmdMcMatchSet">Match-set column</label>' + selectHtml("rmdMcMatchSet", elig, f.matchSet) + '</div>';
      h += '</div>';
    }
    h += '<div class="rmd-mc-actions">';
    h += '  <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-mc="run"' + (mc.running ? ' disabled' : '') + '>' + (mc.running ? (mc.retryText ? esc(mc.retryText) : 'Running on this device...') : 'Run the analysis') + '</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="to-question">Back</button>';
    h += '</div>';
    if (onDeviceV2Enabled()) {
      var privLine = (G && G.SMD_RMD_JOBS && G.SMD_RMD_JOBS.DEVICE_PRIVACY_LINE) || "Runs on this device. Your PDFs and patient data are read here and never uploaded. Works offline.";
      h += '<p class="rmd-muted rmd-device-privacy" style="font-size:12px;margin-top:6px;">' + esc(privLine) + '</p>';
    }
    return h;
  }

  function drawCompareItem(it, groupLabel) {
    var h = '<div class="rmd-card rmd-mc-result">';
    h += '<h3>' + esc(it.name) + '</h3>';
    if (it.error) {
      h += '<p class="rmd-mc-gloss">' + esc(it.error) + '</p></div>';
      return h;
    }
    var r = it.result;
    h += '<p class="rmd-mc-test"><strong>' + esc(r.label) + '</strong> <span class="rmd-mc-why">' + esc(r.why) + '</span></p>';
    var stat = esc(r.statisticName) + " = " + fmt(r.statistic, 3);
    if (r.df != null && isFinite(r.df)) stat += ", df = " + fmt(r.df, 1);
    stat += ", " + esc(pStr(r.p));
    h += '<p class="rmd-mc-stat">' + stat + '</p>';
    if (r.effect && (r.effect.measure === "r" || r.effect.measure === "rho")) {
      var cl = correlationLine(r);
      if (cl) h += '<p class="rmd-mc-stat">' + esc(cl) + '</p>';
    } else {
      /* the effect is group 1 minus (or over) group 2, so the plain sentence names group 1, e.g. "Drug A" */
      var g1 = r.byGroup && r.byGroup[0] && r.byGroup[0].group;
      var gloss = effectGloss(r.effect, r.p, g1 ? String(g1) : groupLabel);
      if (gloss) h += '<p class="rmd-mc-gloss">' + esc(gloss) + '</p>';
    }
    var pg = pGloss(r.p);
    if (pg) h += '<p class="rmd-mc-gloss">' + esc(pg) + '</p>';
    if (r.byGroup && r.byGroup.length) {
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Group</th><th>n</th><th>Summary</th></tr></thead><tbody>';
      for (var i = 0; i < r.byGroup.length; i++) {
        var bg = r.byGroup[i];
        var d = bg.describe || {};
        h += '<tr><td>' + esc(bg.group) + '</td><td>' + (d.n != null ? d.n : "") + '</td><td>' + describeSummary(d) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    }
    if (r.dropped > 0) h += '<p class="rmd-mc-gloss">' + r.dropped + ' rows were left out (missing values).</p>';
    if (it.sentence) h += '<p class="rmd-mc-sentence">' + esc(it.sentence) + '</p>';
    h += '</div>';
    return h;
  }

  function drawDescribe(r) {
    var data = r.data;
    var h = '<div class="rmd-card rmd-mc-result"><h3>Describe the series</h3>';
    h += '<p class="rmd-mc-stat">n = ' + data.n + "</p>";
    if (data.rule === "list") {
      h += '<div class="rmd-banner rmd-banner-info" role="status">With so few patients, each value is listed instead of an average.</div>';
    }
    for (var i = 0; i < data.items.length; i++) {
      var it = data.items[i];
      h += '<div class="rmd-mc-common"><strong>' + esc(it.name) + "</strong>";
      if (it.missing) h += ' <span class="rmd-muted">(' + it.missing + " missing)</span>";
      if (it.type === "numeric") {
        if (it.rule === "list") {
          h += '<p class="rmd-mc-list">' + esc((it.values || []).join(", ")) + "</p>";
        } else {
          var line = "median " + fmt(it.median, 1) + " (IQR " + fmt(it.q1, 1) + " to " + fmt(it.q3, 1) + "), range " + fmt(it.min, 1) + " to " + fmt(it.max, 1);
          h += '<p class="rmd-mc-list">' + esc(line) + "</p>";
          if (it.rule === "median-mean" && mc.showMean) {
            h += '<p class="rmd-mc-gloss">mean ' + fmt(it.mean, 1) + " ± " + fmt(it.sd, 1) + "</p>";
          }
        }
      } else {
        var parts = [];
        for (var j = 0; j < it.counts.length; j++) parts.push(esc(it.counts[j].level) + ": " + it.counts[j].n + " (" + fmt(it.counts[j].pct, 1) + "%)");
        h += '<p class="rmd-mc-list">' + parts.join(", ") + "</p>";
      }
      h += "</div>";
    }
    if (data.rule === "median-mean") {
      h += '<button type="button" class="rmd-btn rmd-btn-subtle rmd-btn-sm" data-rmd-mc="show-mean">' + (mc.showMean ? "Hide mean ± SD" : "Show mean ± SD") + "</button>";
    }
    if (data.common && data.common.length) {
      h += '<h3>Common features</h3><div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Feature</th><th>Most common</th><th>Count</th></tr></thead><tbody>';
      for (var k = 0; k < data.common.length; k++) {
        var c = data.common[k];
        h += "<tr><td>" + esc(c.name) + "</td><td>" + esc(c.level) + "</td><td>" + c.n + " of " + c.of + " (" + fmt(c.pct, 1) + "%)</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    h += '<p class="rmd-mc-gloss">For a surgical case series, many journals ask for PROCESS 2025. Check the journal\'s instructions.</p>';
    h += "</div>";
    return h;
  }

  function kmSvg(km) {
    var groups = km.groups || [];
    var maxT = 0;
    for (var i = 0; i < groups.length; i++) {
      var steps = groups[i].steps || [];
      for (var s = 0; s < steps.length; s++) if (steps[s].t > maxT) maxT = steps[s].t;
    }
    if (maxT <= 0) maxT = 1;
    var x0 = 46, x1 = 580, y0 = 16, y1 = 230;
    var svg = '<svg class="rmd-mc-km" viewBox="0 0 600 300" role="img" aria-label="Kaplan-Meier survival curves">';
    svg += '<line x1="' + x0 + '" y1="' + y1 + '" x2="' + x1 + '" y2="' + y1 + '" stroke="var(--rmd-line)" stroke-width="1"/>';
    svg += '<line x1="' + x0 + '" y1="' + y0 + '" x2="' + x0 + '" y2="' + y1 + '" stroke="var(--rmd-line)" stroke-width="1"/>';
    for (var g = 0; g < groups.length; g++) {
      var color = GROUP_COLORS[g % GROUP_COLORS.length];
      var grp = groups[g];
      svg += '<path d="' + buildKmPath(grp.steps || [], maxT, x0, x1, y0, y1) + '" fill="none" stroke="' + color + '" stroke-width="2"/>';
      var st = grp.steps || [];
      for (var c = 0; c < st.length; c++) {
        if (st[c].censored > 0) {
          var cx = x0 + (st[c].t / maxT) * (x1 - x0);
          var cy = y1 - st[c].survival * (y1 - y0);
          svg += '<line x1="' + cx.toFixed(1) + '" y1="' + (cy - 4).toFixed(1) + '" x2="' + cx.toFixed(1) + '" y2="' + (cy + 4).toFixed(1) + '" stroke="' + color + '" stroke-width="2"/>';
        }
      }
    }
    svg += "</svg>";
    var times = [0, 0.25, 0.5, 0.75, 1];
    svg += '<table class="rmd-mc-atrisk"><thead><tr><th>Number at risk</th>';
    for (var t = 0; t < times.length; t++) svg += "<th>" + fmt(times[t] * maxT, 0) + "</th>";
    svg += "</tr></thead><tbody>";
    for (var gg = 0; gg < groups.length; gg++) {
      svg += "<tr><td>" + esc(groups[gg].name) + "</td>";
      for (var tt = 0; tt < times.length; tt++) svg += "<td>" + riskAtTime(groups[gg], times[tt] * maxT) + "</td>";
      svg += "</tr>";
    }
    svg += "</tbody></table>";
    return svg;
  }

  function drawSurvival(r) {
    var h = '<div class="rmd-card rmd-mc-result"><h3>Time to event (survival analysis)</h3>';
    if (!r.ok) {
      h += '<div class="rmd-banner rmd-banner-warn" role="alert">This analysis is not available yet. No numbers are shown.</div>';
      h += "</div>";
      return h;
    }
    var km = r.km;
    if (km && km.groups && km.groups.length) {
      h += kmSvg(km);
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Group</th><th>n</th><th>Events</th><th>Median survival (95% CI)</th></tr></thead><tbody>';
      for (var i = 0; i < km.groups.length; i++) {
        var g = km.groups[i];
        var med = g.median || {};
        var medStr = "not reached";
        if (med.value != null) {
          medStr = fmt(med.value, 1);
          if (med.lower != null || med.upper != null) {
            medStr += " (" + (med.lower == null ? "not reached" : fmt(med.lower, 1)) + " to " + (med.upper == null ? "not reached" : fmt(med.upper, 1)) + ")";
          }
        }
        h += "<tr><td>" + esc(g.name) + "</td><td>" + g.n + "</td><td>" + g.nEvents + "</td><td>" + esc(medStr) + "</td></tr>";
      }
      h += "</tbody></table></div>";
    }
    if (r.lr && r.lr.ok && r.lr.p != null) {
      h += '<p class="rmd-mc-stat">Log-rank test: chi-square = ' + fmt(r.lr.chi2, 2) + ", df = " + (r.lr.df || 1) + ", " + esc(pStr(r.lr.p)) + "</p>";
      var pg = pGloss(r.lr.p);
      if (pg) h += '<p class="rmd-mc-gloss">' + esc(pg) + "</p>";
    }
    if (r.cox && r.cox.ok && r.cox.coefficients && r.cox.coefficients.length) {
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Factor</th><th>HR (95% CI)</th><th>p</th></tr></thead><tbody>';
      for (var k = 0; k < r.cox.coefficients.length; k++) {
        var co = r.cox.coefficients[k];
        if (co.estimable === false) {
          h += '<tr><td>' + esc(co.term) + '</td><td colspan="2" class="rmd-mc-cox-sep">One group had no events (or only events), so its hazard ratio cannot be estimated.</td></tr>';
        } else {
          h += "<tr><td>" + esc(co.term) + "</td><td>" + fmt(co.hr) + " (" + fmt(co.ciLower) + " to " + fmt(co.ciUpper) + ")</td><td>" + esc(pStr(co.p)) + "</td></tr>";
        }
      }
      h += "</tbody></table></div>";
      if (onDeviceV2Enabled() && r.cox.phTest && r.cox.phTest.terms && r.cox.phTest.global) {
        var ph = r.cox.phTest;
        var phBad = ph.global.p != null && ph.global.p < 0.05;
        h += '<div class="rmd-mc-phtest"><h4>Proportional hazards check</h4>';
        h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Term</th><th>Chi-square</th><th>df</th><th>p</th></tr></thead><tbody>';
        for (var pt = 0; pt < ph.terms.length; pt++) {
          var trm = ph.terms[pt];
          if (trm.p != null && trm.p < 0.05) phBad = true;
          h += "<tr><td>" + esc(trm.term) + "</td><td>" + fmt(trm.chisq, 2) + "</td><td>" + trm.df + "</td><td>" + esc(pStr(trm.p)) + "</td></tr>";
        }
        h += "<tr><td><strong>Global</strong></td><td><strong>" + fmt(ph.global.chisq, 2) + "</strong></td><td><strong>" + ph.global.df + "</strong></td><td><strong>" + esc(pStr(ph.global.p)) + "</strong></td></tr>";
        h += "</tbody></table></div>";
        if (phBad) {
          h += '<p class="rmd-mc-ph rmd-mc-ph-warn">The proportional hazards assumption may not hold (p &lt; 0.05), so the hazard ratio may change over time. Ask your statistician before reporting.</p>';
        } else {
          h += '<p class="rmd-mc-ph">Proportional hazards check found no clear change over time (global ' + esc(pStr(ph.global.p)) + ').</p>';
        }
        h += "</div>";
      } else {
        h += '<p class="rmd-mc-ph">Hazard ratios assume the effect stays the same over time. If the survival curves cross, ask your statistician before reporting.</p>';
      }
    }
    h += "</div>";
    return h;
  }

  function drawMatched(r) {
    var h = '<div class="rmd-card rmd-mc-result"><h3>Matched case-control (odds ratio)</h3>';
    if (!r.ok) {
      h += '<div class="rmd-banner rmd-banner-warn" role="alert">No matched odds ratio is shown.</div>';
      h += "</div>";
      return h;
    }
    var res = r.res;
    var orStr = isFinite(res.or) ? fmt(res.or) : "very large";
    h += '<p class="rmd-mc-stat">Discordant pairs: b = ' + res.b + ", c = " + res.c + "</p>";
    h += '<p class="rmd-mc-stat">Conditional odds ratio ' + esc(orStr) + " (95% CI " + fmt(res.ciLower) + " to " + (isFinite(res.ciUpper) ? fmt(res.ciUpper) : "not estimable") + "), " + esc(pStr(res.p)) + "</p>";
    h += '<p class="rmd-mc-gloss">Method: ' + esc(res.method) + ".</p>";
    h += "</div>";
    return h;
  }

  function drawResults() {
    var r = mc.results;
    var sub = "";
    if (r.kind === "compare") sub = "Comparing groups by " + r.group + ".";
    else if (r.kind === "related") sub = r.a + " vs " + r.b + ".";
    else if (r.kind === "table1") sub = "Baseline characteristics by " + r.group + ".";
    else if (r.kind === "linear") sub = "Linear regression for " + r.outcome + ".";
    else if (r.kind === "logistic") sub = "Risk factors for " + r.outcome + ".";
    else if (r.kind === "describe") sub = "Case series description.";
    else if (r.kind === "survival") sub = "Time to event.";
    else if (r.kind === "matched") sub = "Matched pairs.";
    else if (r.kind === "roc") sub = "How well each test picks out " + r.roc.positiveLevel + ".";
    var h = headHtml("Results", sub);
    if (onDeviceV2Enabled()) {
      h += '<span class="rmd-badge rmd-badge-pill rmd-mc-ondevice">On this device</span>';
    }
    if (r.warnings && r.warnings.length) {
      h += '<div class="rmd-banner rmd-banner-warn" role="alert"><strong>Check before you report:</strong><ul>';
      for (var w = 0; w < r.warnings.length; w++) h += '<li>' + esc(r.warnings[w]) + '</li>';
      h += '</ul></div>';
    }
    var i;
    if (r.kind === "compare" || r.kind === "related") {
      for (i = 0; i < r.items.length; i++) {
        h += drawCompareItem(r.items[i], r.kind === "compare" ? r.group : r.a);
      }
    } else if (r.kind === "table1") {
      var t = r.table;
      var total = 0;
      for (i = 0; i < t.groups.length; i++) total += t.groups[i].n;
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Variable</th><th>Overall (n=' + total + ')</th>';
      for (i = 0; i < t.groups.length; i++) h += '<th>' + esc(t.groups[i].name) + ' (n=' + t.groups[i].n + ')</th>';
      h += '<th>p</th></tr></thead><tbody>';
      for (i = 0; i < t.rows.length; i++) {
        var row = t.rows[i];
        h += '<tr><td>' + esc(t1Label(row)) + '</td><td>' + esc(row.overall) + '</td>';
        for (var c = 0; c < row.cells.length; c++) h += '<td>' + esc(row.cells[c]) + '</td>';
        h += '<td>' + esc(pStr(row.p)) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    } else if (r.kind === "linear") {
      var ln = r.lin;
      var statLine = "n = " + ln.n + ", R2 = " + fmt(ln.r2, 3) + ", adj R2 = " + fmt(ln.adjR2, 3) + ", AIC = " + fmt(ln.aic, 2);
      if (ln.fStatistic != null && ln.fDf) {
        statLine += ", F(" + ln.fDf[0] + ", " + ln.fDf[1] + ") = " + fmt(ln.fStatistic, 2) + ", " + pStr(ln.fP);
      }
      if (r.robust === "HC3") statLine += " (HC3 robust errors)";
      h += '<p class="rmd-mc-stat">' + esc(statLine) + '</p>';
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Factor</th><th>Estimate (95% CI)</th><th>SE</th><th>t</th><th>p</th></tr></thead><tbody>';
      for (i = 0; i < ln.coefficients.length; i++) {
        var cl = ln.coefficients[i];
        var estCell = fmt(cl.estimate, 3) + " (" + fmt(cl.ciLower, 3) + " to " + fmt(cl.ciUpper, 3) + ")";
        h += '<tr><td>' + esc(cl.term) + '</td><td>' + esc(estCell) + '</td><td>' + esc(fmt(cl.se, 3)) + '</td><td>' + esc(fmt(cl.t, 2)) + '</td><td>' + esc(pStr(cl.p)) + '</td></tr>';
      }
      h += '</tbody></table></div>';
    } else if (r.kind === "logistic") {
      var lg = r.log;
      h += '<p class="rmd-mc-stat">n = ' + lg.n + ', events = ' + lg.events + '</p>';
      h += '<div class="rmd-mc-tablewrap"><table class="rmd-mc-table"><thead><tr><th>Factor</th><th>OR (95% CI)</th><th>p</th></tr></thead><tbody>';
      for (i = 0; i < lg.coefficients.length; i++) {
        var co = lg.coefficients[i];
        if (co.name === "Intercept") continue;
        var orCell = "could not be estimated";
        if (co.or != null && isFinite(co.or)) {
          orCell = fmt(co.or);
          if (isFinite(co.ciLower) && isFinite(co.ciUpper)) orCell += " (" + fmt(co.ciLower) + " to " + fmt(co.ciUpper) + ")";
        }
        h += '<tr><td>' + esc(co.name) + '</td><td>' + esc(orCell) + '</td><td>' + esc(pStr(co.p)) + '</td></tr>';
      }
      h += '</tbody></table></div>';
      for (i = 0; i < lg.coefficients.length; i++) {
        var co2 = lg.coefficients[i];
        if (co2.name === "Intercept" || co2.or == null || !isFinite(co2.or) || !isFinite(co2.ciLower) || !isFinite(co2.ciUpper)) continue;
        /* a risk factor is not a treatment, so the plain line says "linked to", never "people who got" */
        var dir = co2.ciLower > 1 ? "linked to higher odds of the outcome" : (co2.ciUpper < 1 ? "linked to lower odds of the outcome" : "no clear link with the outcome (the 95% CI includes 1)");
        h += '<p class="rmd-mc-gloss"><strong>' + esc(co2.name) + ':</strong> adjusted odds ratio (aOR) ' + esc(fmt(co2.or)) + ', 95% CI ' + esc(fmt(co2.ciLower)) + ' to ' + esc(fmt(co2.ciUpper)) + ' (' + esc(dir) + ', after allowing for the other factors). ' + esc(pGloss(co2.p)) + '</p>';
      }
    } else if (r.kind === "describe") {
      h += drawDescribe(r);
    } else if (r.kind === "survival") {
      h += drawSurvival(r);
    } else if (r.kind === "matched") {
      h += drawMatched(r);
    } else if (r.kind === "roc") {
      h += rocView().resultsHtml(r.roc, rocHelpers());
    }
    if (r.paragraph) {
      h += '<div class="rmd-card rmd-mc-result"><h3>Results paragraph</h3>';
      h += '<p class="rmd-mc-sentence">' + esc(r.paragraph) + '</p>';
      h += '<p class="rmd-mc-gloss">Built from the computed numbers only. No AI.</p></div>';
    }
    h += '<div class="rmd-mc-actions">';
    h += '  <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-mc="export-csv">Download results (CSV)</button>';
    if (r.kind === "table1") h += '  <button type="button" class="rmd-btn rmd-btn-subtle" data-rmd-mc="export-docx">Download Table 1 (DOCX)</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-mc="use-manuscript">Use in my manuscript</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="open-manuscript">Open manuscript</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="ask-another">Ask another question</button>';
    h += '</div>';
    return h;
  }

  function draw() {
    if (!view) return;
    if (!stats()) {
      view.innerHTML = '<div class="rmd-mc-screen"><div class="rmd-banner rmd-banner-warn" role="alert">The statistics engine did not load. Close ResearchMD and open it again.</div></div>';
      return;
    }
    var body = "";
    if (mc.stage === "upload") body = drawUpload();
    else if (mc.stage === "identifiers") body = drawIdentifiers();
    else if (mc.stage === "columns") body = drawColumns();
    else if (mc.stage === "question") body = drawQuestion();
    else if (mc.stage === "form") body = drawForm();
    else if (mc.stage === "results") body = drawResults();
    view.innerHTML = '<div class="rmd-mc-screen">' + body + '</div>';
    bindControls();
  }

  function bindControls() {
    var file = view.querySelector("#rmdMcFile");
    if (file) {
      file.onchange = function () {
        if (file.files && file.files[0]) handleFile(file.files[0]);
      };
    }
    var group = view.querySelector("#rmdMcGroup");
    if (group) {
      group.onchange = function () {
        mc.form.group = group.value;
        if (mc.analysis === "table1") {
          mc.form.variables = mc.form.variables.filter(function (c) { return c !== group.value; });
        }
      };
    }
    var outcome = view.querySelector("#rmdMcOutcome");
    if (outcome) outcome.onchange = function () { mc.form.outcome = outcome.value; };
    var hc3 = view.querySelector("#rmdMcHc3");
    if (hc3) hc3.onchange = function () { mc.form.robustHc3 = hc3.checked; };
    var selA = view.querySelector("#rmdMcA");
    if (selA) selA.onchange = function () { mc.form.a = selA.value; };
    var selB = view.querySelector("#rmdMcB");
    if (selB) selB.onchange = function () { mc.form.b = selB.value; };
    var selTime = view.querySelector("#rmdMcTime");
    if (selTime) selTime.onchange = function () { mc.form.time = selTime.value; };
    var selEvent = view.querySelector("#rmdMcEvent");
    if (selEvent) selEvent.onchange = function () { mc.form.event = selEvent.value; };
    var selSgroup = view.querySelector("#rmdMcSgroup");
    if (selSgroup) selSgroup.onchange = function () { mc.form.sgroup = selSgroup.value; };
    var selTruth = view.querySelector("#rmdMcTruth");
    if (selTruth) selTruth.onchange = function () {
      mc.form.truth = selTruth.value;
      mc.form.posLevel = stats().defaultPositiveLevel(rocLevels(selTruth.value)) || "";
      draw();
    };
    var selPos = view.querySelector("#rmdMcPosLevel");
    if (selPos) selPos.onchange = function () { mc.form.posLevel = selPos.value; };
    var selMgroup = view.querySelector("#rmdMcMgroup");
    if (selMgroup) selMgroup.onchange = function () {
      mc.form.mgroup = selMgroup.value;
      var lv = (mc.infer[selMgroup.value] && mc.infer[selMgroup.value].levels) || [];
      mc.form.caseLevel = lv[0] || "";
      draw();
    };
    var selCaseLevel = view.querySelector("#rmdMcCaseLevel");
    if (selCaseLevel) selCaseLevel.onchange = function () { mc.form.caseLevel = selCaseLevel.value; };
    var selExposure = view.querySelector("#rmdMcExposure");
    if (selExposure) selExposure.onchange = function () { mc.form.exposure = selExposure.value; };
    var selMatchSet = view.querySelector("#rmdMcMatchSet");
    if (selMatchSet) selMatchSet.onchange = function () { mc.form.matchSet = selMatchSet.value; };
    var matchedToggle = view.querySelector("#rmdMcMatched");
    if (matchedToggle) matchedToggle.onchange = function () { mc.matched = matchedToggle.checked; draw(); };
    var checks = view.querySelectorAll(".rmd-mc-check-input");
    for (var i = 0; i < checks.length; i++) {
      checks[i].onchange = function () {
        var listName = this.getAttribute("data-rmd-mc-list");
        var arr = mc.form[listName] || [];
        if (this.checked) {
          if (listName === "predictors" && arr.length >= 6) {
            this.checked = false;
            return;
          }
          if (listName === "tests" && arr.length >= 4) {
            this.checked = false;
            return;
          }
          if (arr.indexOf(this.value) < 0) arr.push(this.value);
        } else {
          var at = arr.indexOf(this.value);
          if (at >= 0) arr.splice(at, 1);
        }
        mc.form[listName] = arr;
        if (listName === "predictors" || listName === "tests") {
          var cap = listName === "tests" ? 4 : 6;
          var boxes = view.querySelectorAll('.rmd-mc-check-input[data-rmd-mc-list="' + listName + '"]');
          for (var b = 0; b < boxes.length; b++) {
            boxes[b].disabled = !boxes[b].checked && arr.length >= cap;
          }
        }
      };
    }
  }

  function handleAction(act) {
    mc.notice = "";
    if (act === "sample") {
      adoptTable(sampleChart(), "Sample thesis master chart", true);
    } else if (act === "use-saved") {
      var saved = loadLocal(mc.pid);
      if (saved && saved.columns && saved.columns.length) {
        mc.fileName = saved.fileName || "Saved chart";
        mc.sample = !!saved.sample;
        mc.columns = saved.columns.slice();
        mc.rows = saved.rows;
        mc.types = saved.types || {};
        mc.results = null;
        inferAll();
        mc.stage = "identifiers";
        mc.notice = "Using the chart saved on this phone.";
        draw();
      }
    } else if (act === "continue-identifiers") {
      mc.stage = "columns";
      draw();
    } else if (act === "continue-columns") {
      mc.stage = "question";
      draw();
    } else if (act === "back-upload") {
      ++runSeq;
      var pid = mc.pid;
      mc = freshState(pid);
      draw();
    } else if (act === "save-phone") {
      saveLocal();
    } else if (act === "to-question" || act === "ask-another") {
      ++runSeq;
      mc.running = false;
      mc.stage = "question";
      mc.error = "";
      draw();
    } else if (act === "run") {
      if (!mc.running) runAnalysis();
    } else if (act === "show-mean") {
      mc.showMean = !mc.showMean;
      draw();
    } else if (act === "export-csv") {
      exportCsv();
    } else if (act === "export-docx") {
      exportDocx();
    } else if (act === "use-manuscript") {
      useInManuscript();
    } else if (act === "open-manuscript") {
      if (SMD.navigate) SMD.navigate("manuscript", { projectId: mc.pid });
    }
  }

  function onScreenClick(e) {
    var el = e.target;
    while (el && el !== view) {
      if (el.getAttribute) {
        var act = el.getAttribute("data-rmd-mc");
        if (act) { handleAction(act); return; }
        var choice = el.getAttribute("data-rmd-mc-choice");
        if (choice) { pickAnalysis(choice); return; }
        var tok = el.getAttribute("data-rmd-mc-type");
        if (tok) {
          var col = el.getAttribute("data-rmd-mc-col");
          if (col && mc.types[col] != null && !isPhi(col) && TYPE_TOKENS.indexOf(tok) >= 0) {
            mc.types[col] = tok;
            draw();
          }
          return;
        }
      }
      el = el.parentNode;
    }
  }

  function loadBanners(pid) {
    if (mc.isRct && G.RMDCtri && G.RMDCtri.registered) {
      try {
        G.RMDCtri.registered(pid).then(function (v) { mc.ctri = !!v; draw(); }, function () {});
      } catch (e) {}
    }
    if (mc.isStudy && G.RMDIec && G.RMDIec.status) {
      try {
        G.RMDIec.status(pid).then(function (v) { mc.iecStatus = v || "none"; draw(); }, function () {});
      } catch (e) {}
    }
  }

  function render(container, params) {
    view = container;
    var store = SMD.store;
    var active = store && store.getActiveProject ? store.getActiveProject() : null;
    var pid = (params && params.projectId) || (active && active.id) || "local";
    if (pid !== mc.pid) {
      mc = freshState(pid);
      var saved = loadLocal(pid);
      if (saved && saved.columns && saved.columns.length && saved.rows && saved.rows.length) {
        adoptSaved(saved);
        mc.stage = "identifiers";
        mc.notice = "Using the chart saved on this phone.";
      }
    }
    updateFlags();
    injectCss();
    container.onclick = onScreenClick;
    draw();
    var wantDescribe = !!(params && params.describe);
    if (wantDescribe) {
      loadChart(pid).then(function (saved) {
        if (saved && saved.columns && saved.rows && saved.rows.length) {
          adoptSaved(saved);
          if (mc.fromCasefiles) { runDescribe(); }
          else { mc.stage = "identifiers"; draw(); }
        }
      }, function () {});
    }
    loadBanners(pid);
  }

  SMD.screens.masterchart = { render: render };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = {
      render: render, describeRule: describeRule, computeDescribeData: computeDescribeData,
      commonFeaturesFrom: commonFeaturesFrom, describeParagraph: describeParagraph,
      buildKmPath: buildKmPath, riskAtTime: riskAtTime, buildMatchedPairs: buildMatchedPairs,
      checkMcEthicsApproval: checkMcEthicsApproval, runMcCloudFallback: runMcCloudFallback,
      isIpdComplianceSatisfied: isIpdComplianceSatisfied
    };
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
