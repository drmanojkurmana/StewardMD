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
  var TYPE_TOKENS = ["numeric", "binary", "categorical", "id", "date", "text"];
  var TYPE_LABELS = {
    numeric: "Number", binary: "Yes-no", categorical: "Categories",
    id: "ID", date: "Date", text: "Text"
  };

  var view = null;
  var mc = freshState("");

  function freshState(pid) {
    return {
      pid: pid, stage: "upload", fileName: "", sample: false,
      columns: [], rows: [], types: {}, infer: {}, phiCols: [],
      analysis: "",
      form: { group: "", outcomes: [], variables: [], outcome: "", predictors: [], a: "", b: "" },
      results: null, error: "", notice: ""
    };
  }

  function stats() { return G.SMD_RESEARCH_STATS; }

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

  /* Plan v2: the chart lives in RMDStore (IndexedDB, kind masterchart, id main).
   * localStorage is used only when IndexedDB is not available on this phone. */
  function rmdStore() {
    var S = G.RMDStore;
    return S && S.available && S.available() ? S : null;
  }

  function saveLocal() {
    var rec = {
      fileName: mc.fileName, sample: mc.sample,
      columns: mc.columns, rows: mc.rows, types: mc.types
    };
    var S = rmdStore(), pid = mc.pid;
    if (S) {
      S.put(pid, "masterchart", "main", rec).then(function () {
        try {
          var all = JSON.parse(localStorage.getItem(MC_KEY) || "{}") || {};
          if (all[pid]) { delete all[pid]; localStorage.setItem(MC_KEY, JSON.stringify(all)); }
        } catch (e) {}
        mc.notice = "Saved on this phone. Nothing was uploaded.";
        draw();
      }, function () {
        mc.notice = "Could not save on this phone (storage is full). Your chart is still open here.";
        draw();
      });
      return;
    }
    try {
      var all = JSON.parse(localStorage.getItem(MC_KEY) || "{}") || {};
      all[pid] = rec;
      localStorage.setItem(MC_KEY, JSON.stringify(all));
      mc.notice = "Saved on this phone. Nothing was uploaded.";
    } catch (e) {
      mc.notice = "Could not save on this phone (storage is full). Your chart is still open here.";
    }
    draw();
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

  function runAnalysis() {
    var S = stats();
    var f = mc.form;
    mc.error = "";
    mc.notice = "";
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
    if (key === "related") {
      var nums = numericOptions();
      f.a = nums[0] || "";
      f.b = nums[1] || nums[0] || "";
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

  function manuscriptText() {
    var r = mc.results;
    var parts = [];
    if (r.paragraph) parts.push(r.paragraph);
    if (r.kind === "table1") parts.push(table1Text(r.table, r.group));
    else if (r.kind === "logistic") parts.push(logisticText(r));
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
    } else if (r.kind === "logistic") {
      lines.push(["Factor", "OR", "CI lower", "CI upper", "p"]);
      for (i = 0; i < r.log.coefficients.length; i++) {
        var co = r.log.coefficients[i];
        if (co.name === "Intercept") continue;
        lines.push([co.name, fmt(co.or), fmt(co.ciLower), fmt(co.ciUpper), pStr(co.p)]);
      }
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
      "@media (min-width: 768px) {",
      "  #researchMD .rmd-mc-grid { grid-template-columns: 1fr 1fr; }",
      "  #researchMD .rmd-mc-chips .rmd-chip { min-height: 44px; }",
      "  #researchMD .rmd-mc-check { min-height: 44px; }",
      "}"
    ].join("\n");
    document.head.appendChild(s);
  }

  function headHtml(title, sub) {
    var h = '<div class="rmd-mc-head"><h2>' + esc(title) + '</h2>';
    if (sub) h += '<p class="rmd-screen-subtitle">' + esc(sub) + '</p>';
    h += '</div>';
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
    h += '<button type="button" class="rmd-start-choice" data-rmd-mc-choice="related">Is it related?<span>Is BMI related to HbA1c? Correlation between two number columns.</span></button>';
    h += '</div>';
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
    }
    h += '<div class="rmd-mc-actions">';
    h += '  <button type="button" class="rmd-btn rmd-btn-primary" data-rmd-mc="run">Run the analysis</button>';
    h += '  <button type="button" class="rmd-btn rmd-btn-quiet" data-rmd-mc="to-question">Back</button>';
    h += '</div>';
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

  function drawResults() {
    var r = mc.results;
    var sub = "";
    if (r.kind === "compare") sub = "Comparing groups by " + r.group + ".";
    else if (r.kind === "related") sub = r.a + " vs " + r.b + ".";
    else if (r.kind === "table1") sub = "Baseline characteristics by " + r.group + ".";
    else if (r.kind === "logistic") sub = "Risk factors for " + r.outcome + ".";
    var h = headHtml("Results", sub);
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
    var selA = view.querySelector("#rmdMcA");
    if (selA) selA.onchange = function () { mc.form.a = selA.value; };
    var selB = view.querySelector("#rmdMcB");
    if (selB) selB.onchange = function () { mc.form.b = selB.value; };
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
          if (arr.indexOf(this.value) < 0) arr.push(this.value);
        } else {
          var at = arr.indexOf(this.value);
          if (at >= 0) arr.splice(at, 1);
        }
        mc.form[listName] = arr;
        if (listName === "predictors") {
          var boxes = view.querySelectorAll('.rmd-mc-check-input[data-rmd-mc-list="predictors"]');
          for (var b = 0; b < boxes.length; b++) {
            boxes[b].disabled = !boxes[b].checked && arr.length >= 6;
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
      var pid = mc.pid;
      mc = freshState(pid);
      draw();
    } else if (act === "save-phone") {
      saveLocal();
    } else if (act === "to-question" || act === "ask-another") {
      mc.stage = "question";
      mc.error = "";
      draw();
    } else if (act === "run") {
      runAnalysis();
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

  function render(container, params) {
    view = container;
    var store = SMD.store;
    var active = store && store.getActiveProject ? store.getActiveProject() : null;
    var pid = (params && params.projectId) || (active && active.id) || "local";
    var reload = params && params.reload;
    if (pid !== mc.pid || reload) {
      mc = freshState(pid);
      var saved = loadLocal(pid);
      if (applySaved(saved) || !G.RMDStore || !G.RMDStore.get) {
        /* nothing more to load */
      } else {
        G.RMDStore.get(pid, "masterchart", "main").then(function (rec) {
          if (mc.pid !== pid || mc.columns.length) return;
          if (applySaved(rec)) draw();
        }, function () {});
      }
    }
    injectCss();
    container.onclick = onScreenClick;
    draw();
  }

  function applySaved(saved) {
    if (!(saved && saved.columns && saved.columns.length && saved.rows && saved.rows.length)) return false;
    mc.fileName = saved.fileName || "Saved chart";
    mc.sample = !!saved.sample;
    mc.columns = saved.columns.slice();
    mc.rows = saved.rows;
    mc.types = saved.types || {};
    if (stats()) {
      inferAll();
      mc.stage = "identifiers";
      mc.notice = "Using the chart saved on this phone.";
    }
    return true;
  }

  SMD.screens.masterchart = { render: render };

})(typeof window !== "undefined" ? window : globalThis);
