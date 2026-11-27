/* StewardMD - ResearchMD on-device statistics runner (window.SMD_RMD_ONDEVICE_STATS).
 * ES5 IIFE. Dual export for browser and Node tests.
 * Runs stats_model job specs in a dedicated Web Worker when Worker exists, else on
 * the main thread (Node tests). Output matches backend/research/stats/job.py
 * aggregate result shape + engine: "js", engineVersion, dataHash (never rows).
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var FLAG = "smd_rmd_ondevice_stats_v2";
  var DEFAULT_MAX_SECONDS = 120;
  var GLOBAL_MAX_SECONDS = 240;
  var GLOBAL_MAX_ROWS = 100000;
  var WORKER_URL = "/research-stats-worker.js?v=rod2";

  var _worker = null;
  var _nextId = 1;

  function isArray(x) {
    return Object.prototype.toString.call(x) === "[object Array]";
  }

  function isFin(n) {
    return typeof n === "number" && isFinite(n);
  }

  function trim(s) {
    return String(s).replace(/^\s+|\s+$/g, "");
  }

  function makeError(code, message) {
    var err = new Error(message || code);
    err.code = code;
    return err;
  }

  /* Feature flag: DEFAULT ON. Off per device with ?rmd_ondevice_stats_v2=0 or localStorage.smd_rmd_ondevice_stats_v2 = "0" */
  function isEnabled() {
    try {
      if (typeof location !== "undefined" && location.search) {
        var m = location.search.match(/[?&]rmd_ondevice_stats_v2=([^&]+)/);
        if (m != null) return m[1] === "1" || m[1] === "on" || m[1] === "true";
      }
    } catch (e) {}
    try {
      if (typeof localStorage !== "undefined") {
        return localStorage.getItem(FLAG) !== "0";
      }
    } catch (e) {}
    return true;
  }

  function getStats(opts) {
    if (opts && opts.stats) return opts.stats;
    if (G && G.SMD_RESEARCH_STATS) return G.SMD_RESEARCH_STATS;
    if (typeof require === "function") {
      try { return require("./research-stats.js"); } catch (e) {}
    }
    return null;
  }

  /* ---- Pure ES5 SHA-256 fallback + native crypto ---- */

  function utf8Bytes(str) {
    var out = [], i, c;
    for (i = 0; i < str.length; i++) {
      c = str.charCodeAt(i);
      if (c < 0x80) {
        out.push(c);
      } else if (c < 0x800) {
        out.push(0xc0 | (c >> 6), 0x80 | (c & 0x3f));
      } else if (c >= 0xd800 && c <= 0xdbff && i + 1 < str.length) {
        var c2 = str.charCodeAt(++i);
        var cp = 0x10000 + (((c & 0x3ff) << 10) | (c2 & 0x3ff));
        out.push(
          0xf0 | (cp >> 18),
          0x80 | ((cp >> 12) & 0x3f),
          0x80 | ((cp >> 6) & 0x3f),
          0x80 | (cp & 0x3f)
        );
      } else {
        out.push(0xe0 | (c >> 12), 0x80 | ((c >> 6) & 0x3f), 0x80 | (c & 0x3f));
      }
    }
    return out;
  }

  var SHA_K = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2
  ];

  function rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

  function sha256Pure(str) {
    var bytes = utf8Bytes(str);
    var bitLen = bytes.length * 8;
    bytes.push(0x80);
    while ((bytes.length % 64) !== 56) bytes.push(0);
    var hi = Math.floor(bitLen / 0x100000000);
    var lo = bitLen >>> 0;
    bytes.push((hi >>> 24) & 0xff, (hi >>> 16) & 0xff, (hi >>> 8) & 0xff, hi & 0xff);
    bytes.push((lo >>> 24) & 0xff, (lo >>> 16) & 0xff, (lo >>> 8) & 0xff, lo & 0xff);
    var H = [0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19];
    var W = new Array(64), i, t, a, b, c, d, e, f, g, h, S1, ch, temp1, S0, maj, temp2, s0, s1;
    for (i = 0; i < bytes.length; i += 64) {
      for (t = 0; t < 16; t++) {
        W[t] = ((bytes[i + t * 4] << 24) | (bytes[i + t * 4 + 1] << 16) |
          (bytes[i + t * 4 + 2] << 8) | bytes[i + t * 4 + 3]) >>> 0;
      }
      for (t = 16; t < 64; t++) {
        s0 = rotr(W[t - 15], 7) ^ rotr(W[t - 15], 18) ^ (W[t - 15] >>> 3);
        s1 = rotr(W[t - 2], 17) ^ rotr(W[t - 2], 19) ^ (W[t - 2] >>> 10);
        W[t] = (W[t - 16] + s0 + W[t - 7] + s1) >>> 0;
      }
      a = H[0]; b = H[1]; c = H[2]; d = H[3]; e = H[4]; f = H[5]; g = H[6]; h = H[7];
      for (t = 0; t < 64; t++) {
        S1 = rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25);
        ch = (e & f) ^ ((~e) & g);
        temp1 = (h + S1 + ch + SHA_K[t] + W[t]) >>> 0;
        S0 = rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22);
        maj = (a & b) ^ (a & c) ^ (b & c);
        temp2 = (S0 + maj) >>> 0;
        h = g; g = f; f = e; e = (d + temp1) >>> 0;
        d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
      }
      H[0] = (H[0] + a) >>> 0; H[1] = (H[1] + b) >>> 0;
      H[2] = (H[2] + c) >>> 0; H[3] = (H[3] + d) >>> 0;
      H[4] = (H[4] + e) >>> 0; H[5] = (H[5] + f) >>> 0;
      H[6] = (H[6] + g) >>> 0; H[7] = (H[7] + h) >>> 0;
    }
    var hex = "";
    for (i = 0; i < 8; i++) {
      var part = H[i].toString(16);
      while (part.length < 8) part = "0" + part;
      hex += part;
    }
    return hex;
  }

  function sha256Hex(str) {
    if (typeof require === "function") {
      try {
        var cryptoMod = require("crypto");
        if (cryptoMod && typeof cryptoMod.createHash === "function") {
          return Promise.resolve(cryptoMod.createHash("sha256").update(str, "utf8").digest("hex"));
        }
      } catch (e) {}
    }
    var subtle = G && G.crypto && G.crypto.subtle;
    if (subtle && typeof subtle.digest === "function") {
      try {
        var bytes = new Uint8Array(utf8Bytes(str));
        return Promise.resolve(subtle.digest("SHA-256", bytes)).then(function (buf) {
          var u8 = new Uint8Array(buf);
          var hex = "";
          for (var i = 0; i < u8.length; i++) {
            var h = u8[i].toString(16);
            hex += h.length < 2 ? "0" + h : h;
          }
          return hex;
        }, function () {
          return sha256Pure(str);
        });
      } catch (e2) {}
    }
    return Promise.resolve(sha256Pure(str));
  }

  /* ---- Dataset normalization and canonical CSV ---- */

  function normalizeDataset(input) {
    var cols = [], rows = [], colIdx = {}, i, j, r, len, keys, k;
    if (!input) throw makeError("dataset_invalid", "Dataset is empty");
    if (isArray(input)) {
      if (!input.length) throw makeError("dataset_invalid", "Dataset has no rows");
      if (!input[0] || typeof input[0] !== "object" || isArray(input[0])) {
        throw makeError("dataset_invalid", "Each row must be an object");
      }
      keys = Object.keys(input[0]);
      if (!keys.length) throw makeError("dataset_invalid", "Dataset has no columns");
      cols = keys.slice();
      for (j = 0; j < cols.length; j++) colIdx[cols[j]] = j;
      for (i = 0; i < input.length; i++) {
        r = input[i];
        if (!r || typeof r !== "object" || isArray(r)) throw makeError("dataset_invalid", "Invalid row at " + i);
        var rowArr = [];
        for (j = 0; j < cols.length; j++) rowArr.push(r[cols[j]]);
        rows.push(rowArr);
      }
      return { columns: cols, rows: rows, colIdx: colIdx };
    }
    if (typeof input === "object") {
      if (isArray(input.columns) && isArray(input.rows)) {
        if (!input.columns.length || !input.rows.length) throw makeError("dataset_invalid", "Dataset is empty");
        cols = input.columns.slice();
        for (j = 0; j < cols.length; j++) colIdx[cols[j]] = j;
        for (i = 0; i < input.rows.length; i++) {
          if (!isArray(input.rows[i])) throw makeError("dataset_invalid", "Invalid row array at " + i);
          rows.push(input.rows[i]);
        }
        return { columns: cols, rows: rows, colIdx: colIdx };
      }
      keys = Object.keys(input);
      if (!keys.length) throw makeError("dataset_invalid", "Dataset has no columns");
      len = null;
      for (j = 0; j < keys.length; j++) {
        k = keys[j];
        if (!isArray(input[k])) throw makeError("dataset_invalid", "Column " + k + " must be an array");
        if (len === null) len = input[k].length;
        else if (input[k].length !== len) throw makeError("dataset_invalid", "Column length mismatch");
        cols.push(k);
        colIdx[k] = j;
      }
      if (!len) throw makeError("dataset_invalid", "Dataset has no rows");
      for (i = 0; i < len; i++) {
        var r2 = [];
        for (j = 0; j < cols.length; j++) r2.push(input[cols[j]][i]);
        rows.push(r2);
      }
      return { columns: cols, rows: rows, colIdx: colIdx };
    }
    throw makeError("dataset_invalid", "Unsupported dataset format");
  }

  function csvCell(v) {
    if (v === null || v === undefined) return "";
    var s = String(v);
    if (/[",\n\r]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  /* Canonical CSV over the used columns in input row order (job.py never sorts rows). */
  function canonicalCsv(dataset, usedCols) {
    var seen = {}, cols = [], i, j, idxs = [], lines = [];
    for (i = 0; i < usedCols.length; i++) {
      var c = usedCols[i];
      if (!seen[c]) { seen[c] = 1; cols.push(c); }
    }
    cols.sort();
    for (j = 0; j < cols.length; j++) idxs.push(dataset.colIdx[cols[j]]);
    var hdr = [];
    for (j = 0; j < cols.length; j++) hdr.push(csvCell(cols[j]));
    lines.push(hdr.join(","));
    for (i = 0; i < dataset.rows.length; i++) {
      var row = dataset.rows[i];
      var cells = [];
      for (j = 0; j < idxs.length; j++) {
        cells.push(csvCell(row[idxs[j]]));
      }
      lines.push(cells.join(","));
    }
    return lines.join("\n");
  }

  /* ---- Formula & value checks (matching regression.py / survival.py) ---- */

  function isAlnumUnderscore(s) {
    return /^[A-Za-z0-9_]+$/.test(s);
  }

  function parseFormula(formula) {
    var parts, y, rhs, rawTerms, terms = [], seen = {}, i, t;
    if (typeof formula !== "string") throw makeError("invalid_formula", "Formula must be a string");
    parts = formula.split("~");
    if (parts.length !== 2) throw makeError("invalid_formula", "Formula must contain exactly one ~");
    y = trim(parts[0]);
    rhs = trim(parts[1]);
    if (!y) throw makeError("invalid_formula", "Formula outcome is empty");
    if (rhs !== "1") {
      rawTerms = rhs.split("+");
      for (i = 0; i < rawTerms.length; i++) {
        t = trim(rawTerms[i]);
        if (!t) throw makeError("invalid_formula", "Empty term in formula");
        if (seen[t] || t === y) throw makeError("invalid_formula", "Duplicate or cyclic term in formula");
        seen[t] = 1;
        terms.push(t);
      }
    }
    if (!isAlnumUnderscore(y)) throw makeError("invalid_formula", "Invalid outcome name in formula");
    for (i = 0; i < terms.length; i++) {
      if (!isAlnumUnderscore(terms[i])) throw makeError("invalid_formula", "Invalid term in formula");
    }
    return { outcome: y, predictors: terms };
  }

  function requireCol(dataset, name) {
    if (typeof name !== "string" || !name || !Object.prototype.hasOwnProperty.call(dataset.colIdx, name)) {
      throw makeError("invalid_spec", "Missing column: " + String(name));
    }
    return dataset.colIdx[name];
  }

  function toFiniteFloat(v) {
    if (typeof v === "boolean" || v === null || v === undefined) return null;
    if (typeof v === "number") return isFinite(v) ? v : null;
    if (typeof v === "string") {
      var s = trim(v);
      if (s === "") return null;
      var n = Number(s);
      return isFinite(n) ? n : null;
    }
    return null;
  }

  function assertAllFinite(dataset, colNames) {
    var i, j, idx, v;
    for (j = 0; j < colNames.length; j++) {
      idx = requireCol(dataset, colNames[j]);
      for (i = 0; i < dataset.rows.length; i++) {
        v = toFiniteFloat(dataset.rows[i][idx]);
        if (v === null) throw makeError("dataset_invalid", "Column " + colNames[j] + " contains non-finite values");
      }
    }
  }

  function sliceTable(dataset, colNames) {
    var seen = {}, cols = [], idxs = [], i, j, rows = [];
    for (j = 0; j < colNames.length; j++) {
      if (!seen[colNames[j]]) {
        seen[colNames[j]] = 1;
        cols.push(colNames[j]);
        idxs.push(requireCol(dataset, colNames[j]));
      }
    }
    for (i = 0; i < dataset.rows.length; i++) {
      var row = [];
      for (j = 0; j < idxs.length; j++) row.push(dataset.rows[i][idxs[j]]);
      rows.push(row);
    }
    return { columns: cols, rows: rows };
  }

  function sliceRowObjects(dataset, colNames) {
    var seen = {}, cols = [], idxs = [], i, j, out = [];
    for (j = 0; j < colNames.length; j++) {
      if (!seen[colNames[j]]) {
        seen[colNames[j]] = 1;
        cols.push(colNames[j]);
        idxs.push(requireCol(dataset, colNames[j]));
      }
    }
    for (i = 0; i < dataset.rows.length; i++) {
      var obj = {};
      for (j = 0; j < cols.length; j++) obj[cols[j]] = dataset.rows[i][idxs[j]];
      out.push(obj);
    }
    return out;
  }

  function columnArray(dataset, name) {
    var idx = requireCol(dataset, name), out = [], i;
    for (i = 0; i < dataset.rows.length; i++) out.push(dataset.rows[i][idx]);
    return out;
  }

  /* ---- Worker / main-thread execution with ceiling_seconds ---- */

  function terminateWorker() {
    if (_worker) {
      try { _worker.terminate(); } catch (e) {}
      _worker = null;
    }
  }

  function callStatsFn(fn, args, opts, startMs, maxMs) {
    var useWorker = !(opts && opts.useWorker === false);
    var WorkerCtor = (opts && opts.Worker) || (G && G.Worker);
    var workerUrl = (opts && opts.workerUrl) || WORKER_URL;
    if (useWorker && typeof WorkerCtor === "function") {
      return new Promise(function (resolve, reject) {
        var settled = false;
        var w;
        try {
          w = _worker || new WorkerCtor(workerUrl);
          _worker = w;
        } catch (err) {
          /* Worker creation failed (e.g. restricted environment); fall back to main thread */
          runMain();
          return;
        }
        var id = _nextId++;
        var remMs = Math.max(1, maxMs - (Date.now() - startMs));
        var timer = setTimeout(function () {
          if (settled) return;
          settled = true;
          cleanup();
          terminateWorker();
          reject(makeError("ceiling_seconds", "Analysis exceeded time limit"));
        }, remMs);

        function cleanup() {
          clearTimeout(timer);
          if (w && w.removeEventListener) {
            w.removeEventListener("message", onMsg);
            w.removeEventListener("error", onErr);
          } else if (w) {
            if (w.onmessage === onMsg) w.onmessage = null;
            if (w.onerror === onErr) w.onerror = null;
          }
        }
        function onMsg(ev) {
          var d = ev && ev.data;
          if (!d || d.id !== id) return;
          if (settled) return;
          settled = true;
          cleanup();
          if (Date.now() - startMs > maxMs) {
            reject(makeError("ceiling_seconds", "Analysis exceeded time limit"));
            return;
          }
          if (d.ok) resolve(d.result);
          else {
            var e = d.error || {};
            reject(makeError(e.code || "stats_failed", e.message || "Worker stats failed"));
          }
        }
        function onErr(ev) {
          if (settled) return;
          settled = true;
          cleanup();
          terminateWorker();
          reject(makeError("stats_failed", (ev && ev.message) || "Worker error"));
        }
        if (w.addEventListener) {
          w.addEventListener("message", onMsg);
          w.addEventListener("error", onErr);
        } else {
          w.onmessage = onMsg;
          w.onerror = onErr;
        }
        try {
          w.postMessage({ id: id, fn: fn, args: args });
        } catch (postErr) {
          if (!settled) {
            settled = true;
            cleanup();
            terminateWorker();
            reject(makeError("stats_failed", (postErr && postErr.message) || "postMessage failed"));
          }
        }
      });
    }

    function runMain() {
      var STATS = getStats(opts);
      if (!STATS || typeof STATS[fn] !== "function") {
        return Promise.reject(makeError("stats_unavailable", "SMD_RESEARCH_STATS is unavailable"));
      }
      return new Promise(function (resolve, reject) {
        try {
          var res = STATS[fn].apply(STATS, args);
          if (Date.now() - startMs > maxMs) {
            reject(makeError("ceiling_seconds", "Analysis exceeded time limit"));
            return;
          }
          resolve(res);
        } catch (err) {
          var code = (err && err.code) ? String(err.code) : "stats_failed";
          reject(makeError(code, (err && err.message) ? err.message : code));
        }
      });
    }
    return runMain();
  }

  /* ---- Public entry: run(spec, rows, opts) -> Promise<result> ---- */

  function normalQuantileLocal(p) {
    var STATS = getStats({});
    /* Acklam fallback if needed, or exact 0.95 Z */
    if (p === 0.975) return 1.959963984540054;
    if (STATS && STATS._rank) {
      /* compute from logistic or normal approximation if needed */
    }
    var a = [-39.69683028665376, 220.9460984245205, -275.9285104469687,
      138.3577518672690, -30.66479806614716, 2.506628277459239];
    var b = [-54.47609879822406, 161.5858368580409, -155.6989798598866,
      66.80131188771972, -13.28068155288572, 1];
    var c = [-0.007784894002430293, -0.3223964580411365, -2.400758277161838,
      -2.549732539343734, 4.374664141464968, 2.938163982698783];
    var d = [0.007784695709041462, 0.3224671290700398, 2.445134137142996,
      3.754408661907416, 1];
    function horner(co, x) { var s = co[0], i; for (i = 1; i < co.length; i++) s = s * x + co[i]; return s; }
    var plow = 0.02425, phigh = 1 - 0.02425, q, r;
    if (p < plow) { q = Math.sqrt(-2 * Math.log(p)); return horner(c, q) / horner(d, q); }
    if (p > phigh) { q = Math.sqrt(-2 * Math.log(1 - p)); return -horner(c, q) / horner(d, q); }
    q = p - 0.5; r = q * q;
    return horner(a, r) * q / horner(b, r);
  }

  function run(spec, rows, opts) {
    var startMs = Date.now();
    opts = opts || {};
    var STATS = getStats(opts);
    var engineVersion = (STATS && STATS.ENGINE_VERSION) || "rod2";

    return Promise.resolve().then(function () {
      if (!spec || typeof spec !== "object" || isArray(spec)) {
        throw makeError("invalid_spec", "Model spec must be an object");
      }
      var family = spec.family;
      if (family !== "linear" && family !== "logistic" && family !== "km" &&
          family !== "logrank" && family !== "cox" && family !== "diagnostic") {
        throw makeError("invalid_spec", "Unsupported model family: " + String(family));
      }
      var maxSeconds = opts.maxSeconds == null ? DEFAULT_MAX_SECONDS : opts.maxSeconds;
      if (typeof maxSeconds !== "number" || !isFinite(maxSeconds) || maxSeconds <= 0 || maxSeconds > GLOBAL_MAX_SECONDS) {
        throw makeError("invalid_spec", "Invalid maxSeconds ceiling");
      }
      var maxRows = opts.maxRows == null ? GLOBAL_MAX_ROWS : opts.maxRows;
      if (typeof maxRows !== "number" || !isFinite(maxRows) || Math.floor(maxRows) !== maxRows || maxRows < 1) {
        throw makeError("invalid_spec", "Invalid maxRows ceiling");
      }
      var rowLimit = Math.min(maxRows, GLOBAL_MAX_ROWS);
      var maxMs = maxSeconds * 1000;

      var level = spec.level == null ? 0.95 : spec.level;
      if (typeof level !== "number" || !isFinite(level) || level <= 0 || level >= 1) {
        throw makeError("invalid_spec", "level must be between 0 and 1");
      }

      var dataset = normalizeDataset(rows);
      if (dataset.rows.length > rowLimit) {
        throw makeError("ceiling_rows", "Dataset exceeds maximum of " + rowLimit + " rows");
      }

      var usedCols, csvStr, hashPromise;

      if (family === "linear" || family === "logistic") {
        var outcome, predictors, viaFormula = false;
        if (spec.formula != null) {
          var parsed = parseFormula(spec.formula);
          outcome = parsed.outcome;
          predictors = parsed.predictors;
          viaFormula = true;
        } else if (typeof spec.outcome === "string" && isArray(spec.predictors)) {
          outcome = spec.outcome;
          predictors = spec.predictors.slice();
        } else {
          throw makeError("invalid_spec", "linear/logistic requires formula or outcome + predictors");
        }
        if (family === "logistic" && !predictors.length) {
          throw makeError("invalid_formula", "logistic requires at least one predictor");
        }
        var robust = spec.robust == null ? null : spec.robust;
        if (family === "linear" && robust !== null && robust !== "HC3") {
          throw makeError("invalid_robust", "robust must be null or HC3");
        }
        usedCols = [outcome].concat(predictors);
        for (var c = 0; c < usedCols.length; c++) requireCol(dataset, usedCols[c]);
        if (viaFormula) {
          assertAllFinite(dataset, usedCols);
          if (dataset.rows.length <= predictors.length + 1) {
            throw makeError("too_few_rows", "Not enough rows for model degrees of freedom");
          }
        }
        if (family === "logistic" && viaFormula) {
          var yVals = columnArray(dataset, outcome);
          var ones = 0, zeros = 0;
          for (var yi = 0; yi < yVals.length; yi++) {
            var yNum = toFiniteFloat(yVals[yi]);
            if (yNum !== 0 && yNum !== 1) throw makeError("outcome_not_binary", "Outcome must be 0 or 1");
            if (yNum === 1) ones++; else zeros++;
          }
          if (ones === 0 || zeros === 0) throw makeError("outcome_constant", "Outcome has no variation");
        }
        var tbl = sliceTable(dataset, usedCols);
        var typesArg = spec.types || null;
        if (!typesArg && viaFormula) {
          typesArg = {};
          typesArg[outcome] = family === "logistic" ? "binary" : "numeric";
          for (var pi = 0; pi < predictors.length; pi++) typesArg[predictors[pi]] = "numeric";
        }
        csvStr = canonicalCsv(dataset, usedCols);
        hashPromise = sha256Hex(csvStr);
        var formulaOut = spec.formula || (outcome + " ~ " + (predictors.length ? predictors.join(" + ") : "1"));
        var cleanRegSpec = family === "linear"
          ? { family: "linear", formula: formulaOut, robust: robust, level: level }
          : { family: "logistic", formula: formulaOut, level: level };

        return hashPromise.then(function (dataHash) {
          var fn = family === "linear" ? "linear" : "logistic";
          var args = family === "linear"
            ? [tbl.rows, tbl.columns, outcome, predictors, typesArg, { robust: robust, level: level }]
            : [tbl.rows, tbl.columns, outcome, predictors, typesArg];
          return callStatsFn(fn, args, opts, startMs, maxMs).then(function (res) {
            if (family === "linear") {
              return {
                family: "linear",
                formula: formulaOut,
                robust: robust,
                level: level,
                coefficients: res.coefficients,
                n: res.n,
                dropped: res.dropped || 0,
                dfResidual: res.dfResidual,
                sigma: res.sigma,
                r2: res.r2,
                adjR2: res.adjR2,
                fStatistic: res.fStatistic,
                fDf: res.fDf,
                fP: res.fP,
                aic: res.aic,
                engine: "js",
                engineVersion: engineVersion,
                dataHash: dataHash,
                manifest: { engine: "js", engineVersion: engineVersion, model: cleanRegSpec, dataHash: dataHash, n: res.n }
              };
            }
            if (!res.converged) {
              throw makeError("logistic_not_converged", res.warning || "logistic_not_converged");
            }
            var zCrit = normalQuantileLocal((1 + level) / 2);
            var coefs = [], k, co, est, se;
            for (k = 0; k < res.coefficients.length; k++) {
              co = res.coefficients[k];
              est = co.estimate != null ? co.estimate : (co.or != null ? Math.log(co.or) : null);
              se = co.se;
              if (est == null || se == null || !isFin(est) || !isFin(se) || se > 1e6) {
                throw makeError("logistic_not_converged", "logistic_not_converged");
              }
              coefs.push({
                term: co.name,
                estimate: est,
                se: se,
                z: est / se,
                p: co.p,
                ciLower: est - zCrit * se,
                ciUpper: est + zCrit * se
              });
            }
            return {
              family: "logistic",
              formula: formulaOut,
              level: level,
              coefficients: coefs,
              n: res.n,
              events: res.events,
              aic: res.aic,
              deviance: res.deviance,
              nullDeviance: res.nullDeviance,
              iterations: res.iterations,
              warning: res.warning || "",
              engine: "js",
              engineVersion: engineVersion,
              dataHash: dataHash,
              manifest: { engine: "js", engineVersion: engineVersion, model: cleanRegSpec, dataHash: dataHash, n: res.n }
            };
          });
        });
      }

      if (family === "km" || family === "logrank" || family === "cox") {
        if (typeof spec.time !== "string" || typeof spec.event !== "string") {
          throw makeError("invalid_spec", "Survival models require time and event columns");
        }
        requireCol(dataset, spec.time);
        requireCol(dataset, spec.event);
        var times = columnArray(dataset, spec.time);
        var events = columnArray(dataset, spec.event);

        if (family === "km") {
          var groupArr = spec.group ? columnArray(dataset, spec.group) : null;
          usedCols = spec.group ? [spec.time, spec.event, spec.group] : [spec.time, spec.event];
          csvStr = canonicalCsv(dataset, usedCols);
          var cleanKmSpec = { family: "km", level: level };
          return sha256Hex(csvStr).then(function (dataHash) {
            return callStatsFn("kaplanMeier", [times, events, groupArr, { confType: "log", confLevel: level }], opts, startMs, maxMs).then(function (res) {
              if (!res || !res.ok || !res.groups || !res.groups.length) {
                throw makeError("stats_failed", (res && res.warnings && res.warnings[0]) || "Kaplan-Meier failed");
              }
              var g0 = res.groups[0];
              var totalEvents = 0, gi;
              for (gi = 0; gi < res.groups.length; gi++) totalEvents += res.groups[gi].nEvents;
              if (!spec.group && totalEvents === 0) throw makeError("no_events", "No events in survival data");
              var steps = [], si, st;
              for (si = 0; si < g0.steps.length; si++) {
                st = g0.steps[si];
                steps.push({
                  time: st.t,
                  nRisk: st.atRisk,
                  nEvent: st.events,
                  nCensor: st.censored,
                  surv: st.survival,
                  se: st.seLogS,
                  ciLower: st.ciLower,
                  ciUpper: st.ciUpper
                });
              }
              var out = {
                family: "km",
                level: level,
                steps: steps,
                median: g0.median ? g0.median.value : null,
                medianCiLower: g0.median ? g0.median.lower : null,
                medianCiUpper: g0.median ? g0.median.upper : null,
                n: g0.n,
                events: g0.nEvents,
                warnings: res.warnings || [],
                nExcluded: res.nExcluded || 0,
                engine: "js",
                engineVersion: engineVersion,
                dataHash: dataHash,
                manifest: { engine: "js", engineVersion: engineVersion, model: cleanKmSpec, dataHash: dataHash, n: g0.n }
              };
              if (spec.group) out.groups = res.groups;
              return out;
            });
          });
        }

        if (family === "logrank") {
          if (typeof spec.group !== "string" || !spec.group) {
            throw makeError("invalid_spec", "logrank requires group column");
          }
          var lrGroup = columnArray(dataset, spec.group);
          usedCols = [spec.time, spec.event, spec.group];
          csvStr = canonicalCsv(dataset, usedCols);
          var cleanLrSpec = { family: "logrank" };
          return sha256Hex(csvStr).then(function (dataHash) {
            return callStatsFn("logRank", [times, events, lrGroup], opts, startMs, maxMs).then(function (res) {
              if (!res || !res.ok) {
                var noEv = res && res.warnings && res.warnings.some(function (w) { return w.indexOf("No events") >= 0; });
                throw makeError(noEv ? "no_events" : "stats_failed", (res && res.warnings && res.warnings[0]) || "Log-rank failed");
              }
              if (!res.table || res.table.length < 2) {
                throw makeError("invalid_spec", "log_rank needs at least two groups");
              }
              return {
                family: "logrank",
                chisq: res.chi2,
                df: res.df,
                p: res.p,
                groups: res.table,
                warnings: res.warnings || [],
                engine: "js",
                engineVersion: engineVersion,
                dataHash: dataHash,
                manifest: { engine: "js", engineVersion: engineVersion, model: cleanLrSpec, dataHash: dataHash, n: dataset.rows.length }
              };
            });
          });
        }

        /* family === "cox" */
        var covNames = [], coxPreds = [], ci, item;
        var rawCovs = isArray(spec.predictors) && spec.predictors.length ? spec.predictors : spec.covariates;
        if (!isArray(rawCovs) || !rawCovs.length) {
          throw makeError("invalid_spec", "cox requires non-empty covariates");
        }
        var specTypes = spec.types || {};
        for (ci = 0; ci < rawCovs.length; ci++) {
          item = rawCovs[ci];
          if (typeof item === "string") {
            requireCol(dataset, item);
            covNames.push(item);
            var ct = specTypes[item] === "binary" || specTypes[item] === "categorical" ? "categorical" : "numeric";
            coxPreds.push({ name: item, type: ct });
          } else if (item && typeof item === "object" && typeof item.name === "string" && item.name) {
            requireCol(dataset, item.name);
            covNames.push(item.name);
            coxPreds.push({ name: item.name, type: item.type === "categorical" ? "categorical" : "numeric", reference: item.reference });
          } else {
            throw makeError("invalid_spec", "Invalid cox covariate entry");
          }
        }
        if (dataset.rows.length <= covNames.length) {
          throw makeError("too_few_rows", "Not enough rows for Cox covariates");
        }
        usedCols = [spec.time, spec.event].concat(covNames);
        var coxRows = sliceRowObjects(dataset, usedCols);
        var coxSpec = { time: spec.time, event: spec.event, predictors: coxPreds, ties: "efron", confLevel: level, maxIter: 100 };
        csvStr = canonicalCsv(dataset, usedCols);
        var cleanCoxSpec = { family: "cox", ties: "efron", covariates: covNames, level: level };
        return sha256Hex(csvStr).then(function (dataHash) {
          return callStatsFn("cox", [coxRows, coxSpec], opts, startMs, maxMs).then(function (fit) {
            if (!fit || fit.nEvents === 0) {
              throw makeError("no_events", (fit && fit.warnings && fit.warnings[0]) || "no_events");
            }
            if (!fit.ok || !fit.converged) {
              throw makeError("cox_not_converged", (fit.warnings && fit.warnings[0]) || "cox_not_converged");
            }
            return callStatsFn("schoenfeld", [fit, coxRows, coxSpec, { transform: "km" }], opts, startMs, maxMs).then(function (ph) {
              var coefs = [], j, co;
              for (j = 0; j < fit.coefficients.length; j++) {
                co = fit.coefficients[j];
                coefs.push({
                  term: co.term,
                  coef: co.beta,
                  se: co.se,
                  z: co.z,
                  p: co.p,
                  hr: co.hr,
                  hrCiLower: co.ciLower,
                  hrCiUpper: co.ciUpper,
                  estimable: co.estimable,
                  predictor: co.predictor,
                  level: co.level
                });
              }
              return {
                family: "cox",
                ties: "efron",
                covariates: covNames,
                level: level,
                coefficients: coefs,
                n: fit.n,
                events: fit.nEvents,
                nExcluded: fit.nExcluded || 0,
                logLik: fit.logLik,
                lrTest: fit.lrTest,
                phTest: ph && ph.ok ? { transform: ph.transform, terms: ph.terms, global: ph.global } : null,
                warnings: fit.warnings || [],
                engine: "js",
                engineVersion: engineVersion,
                dataHash: dataHash,
                manifest: { engine: "js", engineVersion: engineVersion, model: cleanCoxSpec, dataHash: dataHash, n: fit.n }
              };
            });
          });
        });
      }

      /* family === "diagnostic" */
      var mapping = spec.columns;
      if (!mapping || typeof mapping !== "object" ||
          typeof mapping.TP !== "string" || typeof mapping.FN !== "string" ||
          typeof mapping.FP !== "string" || typeof mapping.TN !== "string") {
        throw makeError("invalid_spec", "diagnostic requires columns { TP, FN, FP, TN }");
      }
      var diagModel = spec.model == null ? "reitsma" : spec.model;
      if (diagModel !== "reitsma" && diagModel !== "per-study") {
        throw makeError("invalid_spec", "diagnostic model must be reitsma or per-study");
      }
      var tpCol = columnArray(dataset, mapping.TP);
      var fnCol = columnArray(dataset, mapping.FN);
      var fpCol = columnArray(dataset, mapping.FP);
      var tnCol = columnArray(dataset, mapping.TN);
      var idCol = spec.id ? columnArray(dataset, spec.id) : null;
      usedCols = [mapping.TP, mapping.FN, mapping.FP, mapping.TN];
      if (spec.id) usedCols.push(spec.id);
      var studies = [], si, tpV, fnV, fpV, tnV;
      for (si = 0; si < dataset.rows.length; si++) {
        tpV = toFiniteFloat(tpCol[si]);
        fnV = toFiniteFloat(fnCol[si]);
        fpV = toFiniteFloat(fpCol[si]);
        tnV = toFiniteFloat(tnCol[si]);
        if (tpV === null || fnV === null || fpV === null || tnV === null ||
            tpV < 0 || fnV < 0 || fpV < 0 || tnV < 0) {
          throw makeError("dataset_invalid", "Diagnostic counts must be non-negative finite numbers");
        }
        var stObj = { id: idCol ? idCol[si] : ("study-" + (si + 1)), TP: tpV, FN: fnV, FP: fpV, TN: tnV };
        studies.push(stObj);
      }
      var correction = spec.correction == null ? 0.5 : spec.correction;
      var correctionControl = spec.correctionControl == null ? "all" : spec.correctionControl;
      csvStr = canonicalCsv(dataset, usedCols);
      var cleanDiagSpec = diagModel === "per-study"
        ? { family: "diagnostic", model: "per-study", correction: correction, correctionControl: correctionControl }
        : { family: "diagnostic", model: "reitsma", correction: correction, correctionControl: correctionControl, level: level };
      return sha256Hex(csvStr).then(function (dataHash) {
        var fn = diagModel === "per-study" ? "diagnosticPerStudy" : "reitsma";
        var diagOpts = { correction: correction, correctionControl: correctionControl, level: level };
        return callStatsFn(fn, [studies, diagOpts], opts, startMs, maxMs).then(function (res) {
          var out = {
            family: "diagnostic",
            model: res.model,
            correction: res.correction,
            correctionControl: res.correctionControl,
            correctionApplied: res.correctionApplied,
            k: res.k,
            engine: "js",
            engineVersion: engineVersion,
            dataHash: dataHash,
            manifest: { engine: "js", engineVersion: engineVersion, model: cleanDiagSpec, dataHash: dataHash, n: res.k }
          };
          if (diagModel === "per-study") {
            out.studies = res.studies;
          } else {
            out.level = res.level;
            out.coefficients = res.coefficients;
            out.psi = res.psi;
            out.pooledSens = res.pooledSens;
            out.pooledSensCiLower = res.pooledSensCiLower;
            out.pooledSensCiUpper = res.pooledSensCiUpper;
            out.pooledFpr = res.pooledFpr;
            out.pooledSpec = res.pooledSpec;
            out.pooledSpecCiLower = res.pooledSpecCiLower;
            out.pooledSpecCiUpper = res.pooledSpecCiUpper;
            out.sroc = res.sroc;
          }
          return out;
        });
      });
    });
  }

  var API = {
    isEnabled: isEnabled,
    run: run,
    parseFormula: parseFormula,
    canonicalCsv: canonicalCsv,
    terminateWorker: terminateWorker
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.SMD_RMD_ONDEVICE_STATS = API;
  }

})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : undefined));
