/* StewardMD - ResearchMD PaperOrchestra client gates, PHI scan, loader & writer
 * (window.SMD_RMD_PO_GATES).
 * ES5 IIFE. Dual export: module.exports and the browser global.
 * Faithful JS ports of backend/research/paperorchestra/adapter/po_adapter/{phi,gates,loader,writer}.py
 * and response parsers from upstream/utils/gemini_utils.py.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  /* ==================== Helpers ==================== */

  function isPlainObject(v) {
    return !!v && typeof v === "object" && Object.prototype.toString.call(v) !== "[object Array]";
  }

  function isNonEmpty(v) {
    if (v === null || v === undefined || v === false) return false;
    if (typeof v === "string") return v.length > 0;
    if (Object.prototype.toString.call(v) === "[object Array]") return v.length > 0;
    if (typeof v === "object") return Object.keys(v).length > 0;
    return Boolean(v);
  }

  function makeError(code, detail, extra) {
    var err = new Error(code + (detail ? ": " + detail : ""));
    err.code = code;
    if (extra) {
      var keys = Object.keys(extra);
      for (var i = 0; i < keys.length; i++) err[keys[i]] = extra[keys[i]];
    }
    return err;
  }

  function stableJson(value) {
    if (value === null || typeof value !== "object") return JSON.stringify(value);
    if (Object.prototype.toString.call(value) === "[object Array]") {
      var items = [];
      for (var i = 0; i < value.length; i++) items.push(stableJson(value[i]));
      return "[" + items.join(", ") + "]";
    }
    var keys = Object.keys(value).sort();
    var parts = [];
    for (var j = 0; j < keys.length; j++) {
      parts.push(JSON.stringify(keys[j]) + ": " + stableJson(value[keys[j]]));
    }
    return "{" + parts.join(", ") + "}";
  }

  function repeatStr(ch, n) {
    var out = "";
    for (var i = 0; i < n; i++) out += ch;
    return out;
  }

  /* ==================== PHI gate (po_adapter/phi.py) ==================== */

  var VERHOEFF_D = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 2, 3, 4, 0, 6, 7, 8, 9, 5],
    [2, 3, 4, 0, 1, 7, 8, 9, 5, 6],
    [3, 4, 0, 1, 2, 8, 9, 5, 6, 7],
    [4, 0, 1, 2, 3, 9, 5, 6, 7, 8],
    [5, 9, 8, 7, 6, 0, 4, 3, 2, 1],
    [6, 5, 9, 8, 7, 1, 0, 4, 3, 2],
    [7, 6, 5, 9, 8, 2, 1, 0, 4, 3],
    [8, 7, 6, 5, 9, 3, 2, 1, 0, 4],
    [9, 8, 7, 6, 5, 4, 3, 2, 1, 0]
  ];
  var VERHOEFF_P = [
    [0, 1, 2, 3, 4, 5, 6, 7, 8, 9],
    [1, 5, 7, 6, 2, 8, 3, 0, 9, 4],
    [5, 8, 0, 3, 7, 9, 6, 1, 4, 2],
    [8, 9, 1, 6, 0, 4, 3, 5, 2, 7],
    [9, 4, 5, 3, 1, 2, 6, 8, 7, 0],
    [4, 2, 8, 6, 5, 7, 3, 9, 0, 1],
    [2, 7, 9, 3, 8, 0, 6, 4, 1, 5],
    [7, 0, 4, 6, 9, 1, 3, 2, 5, 8]
  ];
  var VERHOEFF_INV = [0, 4, 3, 2, 1, 5, 6, 7, 8, 9];

  function verhoeffValid(digits) {
    var s = String(digits || "");
    if (!/^\d+$/.test(s)) return false;
    var c = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = Number(s.charAt(s.length - 1 - i));
      c = VERHOEFF_D[c][VERHOEFF_P[i % 8][ch]];
    }
    return c === 0;
  }

  function verhoeffCheckDigit(digits) {
    var s = String(digits || "");
    var c = 0;
    for (var i = 0; i < s.length; i++) {
      var ch = Number(s.charAt(s.length - 1 - i));
      c = VERHOEFF_D[c][VERHOEFF_P[(i + 1) % 8][ch]];
    }
    return VERHOEFF_INV[c];
  }

  function nhsMod11Valid(digits) {
    var s = String(digits || "");
    if (s.length !== 10 || !/^\d{10}$/.test(s)) return false;
    var total = 0;
    for (var i = 0; i < 9; i++) total += Number(s.charAt(i)) * (10 - i);
    var check = 11 - (total % 11);
    if (check === 11) check = 0;
    if (check === 10) return false;
    return check === Number(s.charAt(9));
  }

  var PHI_MONTH = "(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*";
  var PHI_FULL_DATE =
    "(?:\\d{1,2}[/-]\\d{1,2}[/-]\\d{2,4}" +
    "|\\d{4}-\\d{1,2}-\\d{1,2}" +
    "|\\d{1,2}\\s+" + PHI_MONTH + "\\s+\\d{2,4}" +
    "|" + PHI_MONTH + "\\s+\\d{1,2},?\\s+\\d{4})(?!\\d)";
  var PHI_PATIENT_LABEL =
    "\\b(?:patient|Mr\\.|Mrs\\.|Ms\\.|admitted|discharged|diagnosed" +
    "|ward|bed no|IP no|OP no)\\b";
  var PHI_NAME_BIGRAM = "\\b[A-Z][a-z]{1,20}\\s+[A-Z][a-z]{1,20}(?:\\s+[A-Z][a-z]{1,20})?\\b";
  var PHI_BIRTH_LABEL = "\\b(?:DOB|date of birth|born on|birth date)\\b";
  var PHI_ADMISSION_LABEL = "\\b(?:admitted on|admission date|discharged on)\\b";
  var PHI_STREET = "(?:road|street|nagar|colony|lane|avenue|apt|flat)";
  var PHI_HOUSE = "(?:\\b(?:" +
    "[Hh]\\.?\\s?[Nn][Oo]\\.?|[Hh]\\s+[Nn][Oo]\\.?|[Hh][Oo][Uu][Ss][Ee]\\s+[Nn][Oo]\\.?" +
    "|[Dd][Oo][Oo][Rr]\\s+[Nn][Oo]\\.?|[Dd]\\.?\\s?[Nn][Oo]\\.?|F[Ll][Aa][Tt](?:\\s+[Nn][Oo]\\.?)?" +
    ")[\\s:.#-]*\\d[A-Za-z0-9/-]*|#\\s*\\d[A-Za-z0-9/-]*)" +
    ",\\s*(?:[A-Z][A-Za-z]*|\\d+(?:st|nd|rd|th)\\b)";
  var PHI_WINDOW = 40;

  var PHI_BIRTH_RE = new RegExp(PHI_BIRTH_LABEL, "i");
  var PHI_PATIENT_RE = new RegExp(PHI_PATIENT_LABEL, "i");
  var PHI_ADMISSION_RE = new RegExp(PHI_ADMISSION_LABEL, "i");

  function phiNear(text, start, end, labelRe) {
    var lo = Math.max(0, start - PHI_WINDOW);
    var hi = Math.min(text.length, end + PHI_WINDOW);
    return labelRe.test(text.slice(lo, hi));
  }

  function phiSameSentence(text, start, end) {
    var lo = -1;
    if (start > 0) {
      lo = Math.max(
        text.lastIndexOf(".", start - 1),
        text.lastIndexOf("!", start - 1),
        text.lastIndexOf("?", start - 1)
      );
    }
    lo += 1;
    var stops = [];
    var punct = [".", "!", "?"];
    for (var i = 0; i < punct.length; i++) {
      var s = text.indexOf(punct[i], end);
      if (s !== -1) stops.push(s);
    }
    var hi = stops.length ? Math.min.apply(null, stops) + 1 : text.length;
    return text.slice(lo, hi);
  }

  function isHonorificDot(line, idx) {
    if (line.charAt(idx) !== ".") return false;
    return /\b(?:Mr|Mrs|Ms|Dr)$/i.test(line.slice(Math.max(0, idx - 4), idx));
  }

  function phiSameLineSentence(text, start, end) {
    var lineLo = Math.max(text.lastIndexOf("\n", start - 1), text.lastIndexOf("\r", start - 1)) + 1;
    var nIdx = text.indexOf("\n", end);
    var rIdx = text.indexOf("\r", end);
    var lineHi = text.length;
    if (nIdx !== -1 && nIdx < lineHi) lineHi = nIdx;
    if (rIdx !== -1 && rIdx < lineHi) lineHi = rIdx;
    var line = text.slice(lineLo, lineHi);
    var relStart = start - lineLo;
    var relEnd = end - lineLo;
    var sentLo = 0;
    for (var i = relStart - 1; i >= 0; i--) {
      var ch = line.charAt(i);
      if ((ch === "." || ch === "!" || ch === "?") && !isHonorificDot(line, i)) {
        sentLo = i + 1;
        break;
      }
    }
    var sentHi = line.length;
    for (var j = relEnd; j < line.length; j++) {
      var ch2 = line.charAt(j);
      if ((ch2 === "." || ch2 === "!" || ch2 === "?") && !isHonorificDot(line, j)) {
        sentHi = j + 1;
        break;
      }
    }
    return line.slice(sentLo, sentHi);
  }

  function phiValidNameNearLabel(m, text) {
    var phrase = m[0];
    if (/\s+(?:Patient|Patients)$/i.test(phrase)) return false;
    if (/^(?:Patient|Patients)\s+/i.test(phrase)) {
      var rest = phrase.replace(/^(?:Patient|Patients)\s+/i, "").trim().split(/\s+/);
      if (rest.length < 2) return false;
    }
    var end = m.index + phrase.length;
    if (!phiNear(text, m.index, end, PHI_PATIENT_RE)) return false;
    return PHI_PATIENT_RE.test(phiSameLineSentence(text, m.index, end));
  }

  var PHI_CITATION_MARKERS = [
    "--- INPUT: citation_map.json (Reference Library) ---",
    "--- CITATION MAP (Reference Truth) ---"
  ];

  function phiCitationLibrarySpans(text) {
    var spans = [];
    var endRe = /\n--- (?:INPUT:|CURRENT |EXPERIMENTAL |CONFERENCE |CITATION )/;
    for (var mi = 0; mi < PHI_CITATION_MARKERS.length; mi++) {
      var marker = PHI_CITATION_MARKERS[mi];
      var from = 0;
      while (from < text.length) {
        var idx = text.indexOf(marker, from);
        if (idx === -1) break;
        var tail = text.slice(idx + marker.length);
        var em = endRe.exec(tail);
        var spanEnd = em ? (idx + marker.length + em.index) : text.length;
        spans.push([idx, spanEnd]);
        from = spanEnd + 1;
      }
    }
    return spans;
  }

  function inSpans(start, end, spans) {
    for (var i = 0; i < spans.length; i++) {
      if (start >= spans[i][0] && end <= spans[i][1]) return true;
    }
    return false;
  }

  var PHI_RULES = [
    ["mrn", "labelled_id",
      new RegExp("\\b(?:MRN|UHID|medical\\s+record(?:\\s+(?:no|number|#))?|hospital\\s+no" +
        "|IP\\s+no|OP\\s+no|IP/OP\\s+no)\\b[\\s:.#-]*([A-Za-z0-9-]{4,16})", "gi"),
      function (m) { var v = m[1]; return /\d/.test(v) && v.length >= 4 && v.length <= 16; }, null],
    ["aadhaar", "verhoeff_12",
      /\d{4}[ -]?\d{4}[ -]?\d{4}(?!\d)/g,
      function (m) { return verhoeffValid(m[0].replace(/[ -]/g, "")); }, /\d/],
    ["abha", "addr",
      /\b[A-Za-z0-9._-]{2,}@(?:abdm|sbx)\b/gi, null, null],
    ["abha", "number_14",
      /\d{2}[ -]\d{4}[ -]\d{4}[ -]\d{4}(?!\d)/g, null, /\d/],
    ["abha", "labelled_number",
      /\bABHA(?:\s*(?:No\.?|Number|ID))?\b[\s:.#-]*(\d{14})(?!\d)/gi, null, null],
    ["ssn", "area_group_serial",
      /(?!000|666|9\d\d)\d{3}-(?!00)\d{2}-(?!0000)\d{4}(?!\d)/g, null, /\d/],
    ["nhs", "mod11_10", /\d{10}(?!\d)/g, function (m) { return nhsMod11Valid(m[0]); }, /\d/],
    ["phone", "e164", /\+[1-9]\d{7,14}(?!\d)/g, null, /[\w.]/],
    ["phone", "indian_mobile",
      /(?:\+91[ -]?|0)?[6-9]\d{9}(?![\dA-Za-z])/g, null, /[\w./]/],
    ["phone", "indian_mobile_spaced",
      /(?:\+91[ -]?|0)?[6-9]\d{4}[ -]?\d{5}(?![\dA-Za-z])/g, null, /[\w./]/],
    ["email", "addr_spec",
      /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, null, null],
    ["dob", "date_near_birth_label", new RegExp(PHI_FULL_DATE, "gi"),
      function (m, text) { return phiNear(text, m.index, m.index + m[0].length, PHI_BIRTH_RE); }, /\d/],
    ["address", "street_number",
      new RegExp("\\b\\d{1,5}[A-Za-z]?\\s+(?:[A-Za-z]+\\s+){0,3}" + PHI_STREET + "\\b", "gi"), null, null],
    ["address", "house_locality", new RegExp(PHI_HOUSE, "g"), null, null],
    ["address", "pin_with_label",
      /\b(?:PIN\s*code|PIN|postal\s+code|zip\s*code)\D{0,10}(\d{6})\b/gi, null, null],
    ["patient_name", "name_near_patient_label", new RegExp(PHI_NAME_BIGRAM, "g"),
      phiValidNameNearLabel, null],
    ["admission_date", "date_near_admission_label", new RegExp(PHI_FULL_DATE, "gi"),
      function (m, text) {
        return phiNear(text, m.index, m.index + m[0].length, PHI_ADMISSION_RE) &&
          PHI_PATIENT_RE.test(phiSameSentence(text, m.index, m.index + m[0].length));
      }, /\d/]
  ];

  var PHI_USER_ONLY_RULES = [
    ["dates", "full_date", new RegExp(PHI_FULL_DATE, "gi"), null, /\d/]
  ];

  function scanPhi(text, opts) {
    var s = String(text == null ? "" : text);
    var mode = typeof opts === "string" ? opts : (opts && opts.mode);
    var userMode = mode === "user";
    var allowCitationNames = !!(opts && typeof opts === "object" && opts.allowCitationLibraryNames);
    var citeSpans = allowCitationNames ? phiCitationLibrarySpans(s) : [];
    var rules = userMode ? PHI_RULES.concat(PHI_USER_ONLY_RULES) : PHI_RULES;
    var hits = [];
    var seen = {};
    for (var i = 0; i < rules.length; i++) {
      var ruleDef = rules[i];
      var category = ruleDef[0];
      var rule = ruleDef[1];
      var pattern = ruleDef[2];
      var validator = ruleDef[3];
      var prevDisallow = ruleDef[4];
      pattern.lastIndex = 0;
      var m;
      while ((m = pattern.exec(s)) !== null) {
        if (m[0].length === 0) { pattern.lastIndex++; continue; }
        if (prevDisallow && m.index > 0 && prevDisallow.test(s.charAt(m.index - 1))) {
          pattern.lastIndex = m.index + 1;
          continue;
        }
        if (validator && !validator(m, s)) continue;
        var hitEnd = m.index + m[0].length;
        if (category === "patient_name" && citeSpans.length && inSpans(m.index, hitEnd, citeSpans)) {
          continue;
        }
        var key = category + ":" + m.index + ":" + hitEnd;
        if (seen[key]) continue;
        seen[key] = true;
        hits.push({ category: category, rule: rule, start: m.index, end: hitEnd });
      }
    }
    hits.sort(function (a, b) {
      if (a.start !== b.start) return a.start - b.start;
      return a.category < b.category ? -1 : (a.category > b.category ? 1 : 0);
    });
    return { blocked: hits.length > 0, hits: hits };
  }

  function phiCategories(hits) {
    var set = {};
    var list = Array.isArray(hits) ? hits : [];
    for (var i = 0; i < list.length; i++) {
      if (list[i] && list[i].category) set[list[i].category] = true;
    }
    return Object.keys(set).sort();
  }

  /* ==================== Loader (po_adapter/loader.py) ==================== */

  var RATIO_MEASURES = { OR: 1, RR: 1, HR: 1, ROM: 1, IRR: 1, RRR: 1 };
  var LOG_RATIO_PATHS = {
    "pooled.effect": 1, "pooled.ciLower": 1, "pooled.ciUpper": 1,
    "wald.effect": 1, "wald.ciLower": 1, "wald.ciUpper": 1,
    "hksj.effect": 1, "hksj.ciLower": 1, "hksj.ciUpper": 1,
    "predictionInterval.lower": 1, "predictionInterval.upper": 1
  };
  var GRADE_CERTAINTIES = { high: 1, moderate: 1, low: 1, "very low": 1 };

  function nullForMeasure(measure) {
    return RATIO_MEASURES[String(measure || "").toUpperCase()] ? 1.0 : 0.0;
  }

  function flattenNumeric(result, prefix, out) {
    var keys = Object.keys(result);
    for (var i = 0; i < keys.length; i++) {
      var k = keys[i];
      var path = prefix + k;
      var v = result[k];
      if (isPlainObject(v)) {
        flattenNumeric(v, path + ".", out);
      } else if (typeof v === "number" && isFinite(v)) {
        out.push([path, v]);
      }
    }
  }

  var ALIAS_PAIRS = [
    ["estimate", "pooled.effect"],
    ["effect", "pooled.effect"],
    ["ciLower", "pooled.ciLower"],
    ["ciUpper", "pooled.ciUpper"],
    ["p", "pooled.p"],
    ["i2", "heterogeneity.i2"],
    ["tau2", "heterogeneity.tau2"],
    ["q", "heterogeneity.q"],
    ["df", "heterogeneity.df"]
  ];

  function buildTokenTable(runs) {
    var table = {};
    var list = Array.isArray(runs) ? runs : [];
    for (var i = 0; i < list.length; i++) {
      var run = list[i];
      var runId = run && run.runId;
      if (!runId || !isPlainObject(run.result)) {
        throw makeError("invalid_run", String(runId));
      }
      var measure = String(run.measure || "");
      var nullVal = nullForMeasure(measure);
      var isEngineRatio = !!(
        RATIO_MEASURES[measure.toUpperCase()] &&
        isPlainObject(run.result.pooled) &&
        run.result.scale !== "ratio"
      );
      var pairs = [];
      flattenNumeric(run.result, "", pairs);
      for (var j = 0; j < pairs.length; j++) {
        var path = pairs[j][0];
        var val = pairs[j][1];
        var outVal = (isEngineRatio && LOG_RATIO_PATHS[path]) ? Math.exp(val) : val;
        if (!isFinite(outVal)) outVal = val;
        table[runId + "." + path] = {
          value: outVal,
          "null": nullVal,
          measure: measure,
          runId: runId
        };
      }
      for (var ai = 0; ai < ALIAS_PAIRS.length; ai++) {
        var sk = runId + "." + ALIAS_PAIRS[ai][0];
        var nk = runId + "." + ALIAS_PAIRS[ai][1];
        if (!table[sk] && table[nk]) {
          var src = table[nk];
          table[sk] = {
            value: src.value,
            "null": src["null"],
            measure: src.measure,
            runId: src.runId
          };
        }
      }
    }
    return table;
  }

  function validateManifest(manifest) {
    if (!isPlainObject(manifest) || manifest.v !== 1) {
      throw makeError("invalid_manifest", "v must be 1");
    }
    var protocol = manifest.protocol || {};
    if (!protocol.lockHash) {
      throw makeError("protocol_unlocked", "the protocol must be locked (hash) before writing");
    }
    var evidence = manifest.evidence || [];
    for (var i = 0; i < evidence.length; i++) {
      var study = evidence[i] || {};
      var values = study.values || [];
      for (var j = 0; j < values.length; j++) {
        var value = values[j] || {};
        if (value.verified !== true) {
          throw makeError("unverified_value", study.studyId + "." + value.field);
        }
        if (!isNonEmpty(value.locator) || !isNonEmpty(value.quote)) {
          throw makeError("missing_provenance", study.studyId + "." + value.field);
        }
      }
    }
    var rob = manifest.rob || [];
    for (var r = 0; r < rob.length; r++) {
      var assessment = rob[r] || {};
      if (assessment.verified !== true) {
        throw makeError("unverified_rob", assessment.studyId + "." + assessment.domain);
      }
      if (!isNonEmpty(assessment.locator) || !isNonEmpty(assessment.quote)) {
        throw makeError("missing_provenance", "rob " + assessment.studyId + "." + assessment.domain);
      }
    }
    var grade = manifest.grade || [];
    for (var g = 0; g < grade.length; g++) {
      var row = grade[g] || {};
      if (!row.outcome) {
        throw makeError("invalid_grade", "GRADE row without outcome");
      }
      var cert = String(row.certainty == null ? "" : row.certainty).toLowerCase();
      if (!GRADE_CERTAINTIES[cert]) {
        throw makeError("invalid_grade", "unknown certainty " + JSON.stringify(row.certainty));
      }
    }
    var refs = manifest.references || [];
    for (var k = 0; k < refs.length; k++) {
      if (!refs[k] || !refs[k].key) {
        throw makeError("invalid_reference", "reference without key");
      }
    }
    buildTokenTable(manifest.runs || []);
  }

  function slugCiteKey(label, studyId, usedKeys) {
    var base = String(label || "").toLowerCase()
      .replace(/&/g, " ")
      .replace(/[^a-z0-9]+/g, "_")
      .replace(/^_+|_+$/g, "");
    if (!base) base = String(studyId || "study").toLowerCase().replace(/[^a-z0-9_]+/g, "_");
    if (!base) base = "study";
    var key = base;
    var suffix = 2;
    while (usedKeys[key]) {
      key = base + "_" + suffix;
      suffix++;
    }
    usedKeys[key] = true;
    return key;
  }

  function extractStudyLocatorInfo(study) {
    var src = (study && isPlainObject(study.source)) ? study.source : {};
    var vals = (study && Array.isArray(study.values)) ? study.values : [];
    var citation = typeof src.citation === "string" && src.citation.trim() ? src.citation.trim() : "";
    var doi = src.doi ? String(src.doi).trim() : "";
    var pmid = src.pmid ? String(src.pmid).trim() : "";
    var title = src.title ? String(src.title).trim() : "";
    var authors = Array.isArray(src.authors) ? src.authors.slice() : [];
    var year = src.year != null ? src.year : null;
    var venue = src.venue ? String(src.venue).trim() : "";
    for (var vi = 0; vi < vals.length; vi++) {
      var loc = vals[vi] && isPlainObject(vals[vi].locator) ? vals[vi].locator : null;
      if (!loc) continue;
      if (!citation && typeof loc.citation === "string" && loc.citation.trim()) citation = loc.citation.trim();
      if (!doi && typeof loc.doi === "string" && loc.doi.trim()) doi = loc.doi.trim();
      if (!pmid && typeof loc.pmid === "string" && loc.pmid.trim()) pmid = loc.pmid.trim();
      if (!title && typeof loc.title === "string" && loc.title.trim()) title = loc.title.trim();
      if (!authors.length && Array.isArray(loc.authors) && loc.authors.length) authors = loc.authors.slice();
      if (year == null && loc.year != null) year = loc.year;
      if (!venue && typeof loc.venue === "string" && loc.venue.trim()) venue = loc.venue.trim();
    }
    return {
      citation: citation,
      doi: doi,
      pmid: pmid,
      title: title,
      authors: authors,
      year: year,
      venue: venue
    };
  }

  function collectMergedReferences(manifest) {
    var baseRefs = (manifest && Array.isArray(manifest.references)) ? manifest.references : [];
    var out = [];
    var usedKeys = {};
    var byDoi = {};
    var byPmid = {};
    var byStudyId = {};
    for (var ri = 0; ri < baseRefs.length; ri++) {
      var r = baseRefs[ri];
      if (!r || !r.key) continue;
      var copy = {};
      var ks = Object.keys(r);
      for (var ki = 0; ki < ks.length; ki++) copy[ks[ki]] = r[ks[ki]];
      usedKeys[copy.key] = true;
      if (copy.doi) byDoi[String(copy.doi).toLowerCase()] = copy;
      if (copy.pmid) byPmid[String(copy.pmid).toLowerCase()] = copy;
      if (copy.studyId) byStudyId[copy.studyId] = copy;
      out.push(copy);
    }
    var evidence = (manifest && Array.isArray(manifest.evidence)) ? manifest.evidence : [];
    var studyKeysById = {};
    for (var ei = 0; ei < evidence.length; ei++) {
      var study = evidence[ei] || {};
      var info = extractStudyLocatorInfo(study);
      var existing = null;
      if (study.studyId && byStudyId[study.studyId]) existing = byStudyId[study.studyId];
      if (!existing && info.doi && byDoi[info.doi.toLowerCase()]) existing = byDoi[info.doi.toLowerCase()];
      if (!existing && info.pmid && byPmid[info.pmid.toLowerCase()]) existing = byPmid[info.pmid.toLowerCase()];
      if (existing) {
        existing.isIncludedStudy = true;
        if (study.label && !existing.label) existing.label = study.label;
        if (info.citation && !existing.citation) existing.citation = info.citation;
        if (study.studyId) {
          existing.studyId = study.studyId;
          studyKeysById[study.studyId] = existing.key;
        }
        continue;
      }
      if (!info.citation && !info.title && !info.doi && !info.pmid && !study.label) continue;
      var key = slugCiteKey(study.label, study.studyId, usedKeys);
      var entry = {
        key: key,
        isIncludedStudy: true,
        studyId: study.studyId || ""
      };
      if (study.label) entry.label = study.label;
      if (info.title) entry.title = info.title;
      if (info.citation) entry.citation = info.citation;
      if (info.authors.length) entry.authors = info.authors;
      if (info.year != null) entry.year = info.year;
      if (info.venue) entry.venue = info.venue;
      if (info.doi) entry.doi = info.doi;
      if (info.pmid) entry.pmid = info.pmid;
      if (study.studyId) studyKeysById[study.studyId] = key;
      out.push(entry);
    }
    return { references: out, studyKeysById: studyKeysById };
  }

  function renderIdea(manifest, studyKeysById) {
    var p = manifest.protocol || {};
    var lines = [
      "# Protocol: " + (p.title || ""),
      "",
      "Research question: " + (p.question || ""),
      "Design: " + (p.design || ""),
      "Eligibility: " + (p.eligibility || ""),
      "Protocol lock hash: " + (p.lockHash || ""),
      ""
    ];
    var pico = p.pico || {};
    var picoKeys = isPlainObject(pico) ? Object.keys(pico) : [];
    if (picoKeys.length) {
      lines.push("PICO:");
      for (var i = 0; i < picoKeys.length; i++) {
        lines.push("- " + picoKeys[i] + ": " + pico[picoKeys[i]]);
      }
      lines.push("");
    }
    var outcomes = p.outcomes || [];
    if (outcomes.length) {
      var oStr = [];
      for (var oi = 0; oi < outcomes.length; oi++) oStr.push(String(outcomes[oi]));
      lines.push("Outcomes: " + oStr.join(", "));
      lines.push("");
    }
    lines.push("## Verified evidence (study-level, human-verified)");
    var evidence = manifest.evidence || [];
    for (var ei = 0; ei < evidence.length; ei++) {
      var study = evidence[ei] || {};
      var info = extractStudyLocatorInfo(study);
      var idParts = [];
      if (studyKeysById && study.studyId && studyKeysById[study.studyId]) {
        idParts.push("citeKey:" + studyKeysById[study.studyId]);
      }
      if (info.doi) idParts.push(info.doi);
      if (info.pmid) idParts.push("PMID:" + info.pmid);
      if (info.citation) idParts.push("citation: \"" + info.citation + "\"");
      lines.push("### " + (study.label || study.studyId || "") + " [" + idParts.join("; ") + "]");
      var vals = study.values || [];
      for (var vi = 0; vi < vals.length; vi++) {
        var val = vals[vi] || {};
        var loc = val.locator || {};
        var locStr = loc.page || loc.section || loc.citation || stableJson(loc);
        lines.push("- " + val.field + ": " + val.value + " (locator: " + locStr + "; quote: \"" + val.quote + "\")");
      }
      lines.push("");
    }
    var rob = manifest.rob || [];
    if (rob.length) {
      lines.push("## Risk of bias (human-verified judgments)");
      for (var ri = 0; ri < rob.length; ri++) {
        var a = rob[ri] || {};
        var aloc = a.locator || {};
        var alocStr = aloc.page || aloc.section || stableJson(aloc);
        lines.push("- " + (a.studyId || "") + " [" + (a.tool || "") + "] " + (a.domain || "") + ": " +
          (a.judgment || "") + " (locator: " + alocStr + "; quote: \"" + (a.quote || "") + "\")");
      }
      lines.push("");
    }
    var grade = manifest.grade || [];
    if (grade.length) {
      lines.push("## GRADE certainty of evidence (Summary of Findings)");
      for (var gi = 0; gi < grade.length; gi++) {
        var row = grade[gi] || {};
        var line = "- " + (row.outcome || "") + ": " + (row.certainty || "") + " certainty. " + (row.rationale || "");
        lines.push(line.replace(/\s+$/, ""));
        var domains = row.domains || {};
        var dKeys = isPlainObject(domains) ? Object.keys(domains) : [];
        if (dKeys.length) {
          var dParts = [];
          for (var di = 0; di < dKeys.length; di++) dParts.push(dKeys[di] + "=" + domains[dKeys[di]]);
          lines.push("  domains: " + dParts.join(", "));
        }
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function renderLog(manifest, tokenTable) {
    var lines = [
      "# Analysis runs (deterministic engine output; insert as tokens)",
      "Formatting notes: all ratio effects (OR/RR/HR/ROM/IRR/RRR) below are already exponentiated on the ratio display scale (null = 1.0; < 1.0 favors intervention). I^2 tokens already render '%', so write I^2={{run:...i2}} without a trailing %. P-value tokens render APA format ('< .001' or '.023'), so write 'p {{run:...p}}' without '=' when p < 0.001.",
      ""
    ];
    var runs = manifest.runs || [];
    var tableKeys = Object.keys(tokenTable);
    for (var i = 0; i < runs.length; i++) {
      var run = runs[i] || {};
      var measure = String(run.measure || "");
      var isRatio = !!RATIO_MEASURES[measure.toUpperCase()];
      var scaleLabel = isRatio ? "ratio display scale (null 1.0)" : "difference scale (null 0.0)";
      lines.push("## Run " + run.runId);
      lines.push("Engine: " + (run.engine || "") + " " + (run.engineVersion || "") + "; measure " +
        measure + " (" + scaleLabel + "); method " + (run.method || ""));
      for (var j = 0; j < tableKeys.length; j++) {
        var path = tableKeys[j];
        var entry = tokenTable[path];
        if (entry.runId !== run.runId) continue;
        var fieldPath = path.slice(path.indexOf(".") + 1);
        var token = "{{run:" + entry.runId + "." + fieldPath + "}}";
        lines.push("- " + fieldPath + ": " + token + " (display value " + entry.value + "; null " + entry["null"] +
          "; " + scaleLabel + ". Insert the TOKEN in Abstract/Results, never the number.)");
      }
      lines.push("");
    }
    return lines.join("\n");
  }

  function buildInputs(manifest) {
    validateManifest(manifest);
    var tokenTable = buildTokenTable(manifest.runs || []);
    var merged = collectMergedReferences(manifest);
    var references = merged.references;
    var promptsMod = G && G.SMD_RMD_PO_PROMPTS;
    var templateTex = promptsMod ? promptsMod.IMRAD_TEMPLATE :
      "\\documentclass{article}\n\\begin{document}\n\\section*{Abstract}\n\\section{Introduction}\n\\section{Methods}\n\\section{Results}\n\\section{Discussion}\n\\section*{References}\n\\end{document}\n";
    var guidelinesMd = promptsMod ? promptsMod.GUIDELINES : "# ResearchMD manuscript guidelines (IMRAD, Vancouver)\n";
    return {
      ideaMd: renderIdea(manifest, merged.studyKeysById),
      experimentalLogMd: renderLog(manifest, tokenTable),
      templateTex: templateTex,
      guidelinesMd: guidelinesMd,
      figuresInfo: [],
      tokenTable: tokenTable,
      runs: manifest.runs || [],
      references: references,
      studyKeysById: merged.studyKeysById,
      manifest: manifest
    };
  }

  /* ==================== Writer (po_adapter/writer.py) ==================== */

  var IMRAD_ORDER = ["abstract", "introduction", "methods", "results", "discussion"];
  var MATH_SYMBOLS = {
    times: "\u00d7",
    pm: "\u00b1",
    le: "\u2264",
    leq: "\u2264",
    ge: "\u2265",
    geq: "\u2265",
    approx: "\u2248",
    tau: "\u03c4",
    chi: "\u03c7",
    alpha: "\u03b1",
    beta: "\u03b2",
    mu: "\u03bc",
    sigma: "\u03c3",
    Delta: "\u0394"
  };
  var STRIP_NOARG_CMDS = /\\(?:noindent|smallskip|medskip|bigskip|centering|maketitle|tableofcontents|newpage|clearpage|hline|toprule|midrule|bottomrule)(?![A-Za-z@])[ \t]*/g;
  var DROP_ARG_CMDS = {
    label: 1, vspace: 1, hspace: 1, setlength: 1, addtolength: 1, color: 1,
    usepackage: 1, documentclass: 1, bibliographystyle: 1, bibliography: 1,
    includegraphics: 1, cline: 1, cmidrule: 1
  };
  var TWO_ARG_KEEP_SECOND = { href: 1, textcolor: 1, colorbox: 1 };

  function slug(heading) {
    return String(heading || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  function parseLatexSections(tex) {
    var cleaned = String(tex || "").replace(/\\(?:begin|end)\{document\}/g, "");
    var sectionRe = /\\(section|subsection|subsubsection)\*?\{([^}]*)\}/g;
    var matches = [];
    var m;
    while ((m = sectionRe.exec(cleaned)) !== null) {
      matches.push({
        kind: m[1],
        heading: m[2].trim(),
        start: m.index,
        end: m.index + m[0].length
      });
    }
    var sections = [];
    for (var i = 0; i < matches.length; i++) {
      var cur = matches[i];
      var bodyStart = cur.end;
      var bodyEnd = i + 1 < matches.length ? matches[i + 1].start : cleaned.length;
      var text = cleaned.slice(bodyStart, bodyEnd).trim();
      text = text.replace(/\\(?:maketitle|tableofcontents|newpage|clearpage)\b/g, "").trim();
      var level = cur.kind === "section" ? 1 : (cur.kind === "subsection" ? 2 : 3);
      sections.push({
        id: slug(cur.heading),
        heading: cur.heading,
        level: level,
        text: text
      });
    }
    return sections;
  }

  function evenBackslashes(text, pos) {
    var count = 0;
    var i = pos - 1;
    while (i >= 0 && text.charAt(i) === "\\") {
      count++;
      i--;
    }
    return (count % 2) === 0;
  }

  function findMatchingBrace(text, openIdx) {
    var depth = 1;
    var i = openIdx + 1;
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === "\\" && i + 1 < n) { i += 2; continue; }
      if (ch === "{") depth++;
      else if (ch === "}") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  function findMatchingBracket(text, openIdx) {
    var depth = 1;
    var i = openIdx + 1;
    var n = text.length;
    while (i < n) {
      var ch = text.charAt(i);
      if (ch === "\\" && i + 1 < n) { i += 2; continue; }
      if (ch === "[") depth++;
      else if (ch === "]") {
        depth--;
        if (depth === 0) return i;
      }
      i++;
    }
    return -1;
  }

  function skipOptionalArgs(text, pos) {
    var n = text.length;
    while (pos < n && text.charAt(pos) === "[") {
      var end = findMatchingBracket(text, pos);
      if (end < 0) break;
      pos = end + 1;
    }
    return pos;
  }

  function wrapMarkdown(marker, content) {
    if (!content || !content.trim()) return content;
    var lead = content.slice(0, content.length - content.replace(/^[ \t]+/, "").length);
    var trail = content.slice(content.replace(/[ \t]+$/, "").length);
    var core = content.replace(/^[ \t]+|[ \t]+$/g, "");
    return lead + marker + core + marker + trail;
  }

  function unwrapMulticolumn(text) {
    var cmdRe = /\\(multicolumn|multirow)\{/g;
    var out = [];
    var pos = 0;
    while (true) {
      cmdRe.lastIndex = pos;
      var m = cmdRe.exec(text);
      while (m && !evenBackslashes(text, m.index)) {
        cmdRe.lastIndex = m.index + 1;
        m = cmdRe.exec(text);
      }
      if (!m) {
        out.push(text.slice(pos));
        break;
      }
      out.push(text.slice(pos, m.index));
      var endOfMatch = m.index + m[0].length;
      var c1End = findMatchingBrace(text, endOfMatch - 1);
      if (c1End < 0 || c1End + 1 >= text.length || text.charAt(c1End + 1) !== "{") {
        out.push(text.slice(m.index, endOfMatch));
        pos = endOfMatch;
        continue;
      }
      var c2End = findMatchingBrace(text, c1End + 1);
      if (c2End < 0 || c2End + 1 >= text.length || text.charAt(c2End + 1) !== "{") {
        out.push(text.slice(m.index, endOfMatch));
        pos = endOfMatch;
        continue;
      }
      var c3End = findMatchingBrace(text, c2End + 1);
      if (c3End < 0) {
        out.push(text.slice(m.index, endOfMatch));
        pos = endOfMatch;
        continue;
      }
      out.push(text.slice(c2End + 2, c3End));
      pos = c3End + 1;
    }
    return out.join("");
  }

  function splitOnUnescaped(text, re) {
    var pat = new RegExp(re.source, "g");
    var out = [];
    var pos = 0;
    var m;
    while ((m = pat.exec(text)) !== null) {
      if (m[0].length === 0) { pat.lastIndex++; continue; }
      if (m.index > 0 && text.charAt(m.index - 1) === "\\") {
        pat.lastIndex = m.index + 1;
        continue;
      }
      out.push(text.slice(pos, m.index));
      pos = m.index + m[0].length;
    }
    out.push(text.slice(pos));
    return out;
  }

  function convertTabularEnvs(text) {
    var beginRe = /\\begin\{(tabular\*?)\}/g;
    var out = [];
    var pos = 0;
    while (true) {
      beginRe.lastIndex = pos;
      var m = beginRe.exec(text);
      while (m && !evenBackslashes(text, m.index)) {
        beginRe.lastIndex = m.index + 1;
        m = beginRe.exec(text);
      }
      if (!m) {
        out.push(text.slice(pos));
        break;
      }
      out.push(text.slice(pos, m.index));
      var env = m[1];
      var cursor = m.index + m[0].length;
      if (env === "tabular*" && cursor < text.length && text.charAt(cursor) === "{") {
        var wEnd = findMatchingBrace(text, cursor);
        if (wEnd >= 0) cursor = wEnd + 1;
      }
      cursor = skipOptionalArgs(text, cursor);
      if (cursor < text.length && text.charAt(cursor) === "{") {
        var specEnd = findMatchingBrace(text, cursor);
        if (specEnd >= 0) cursor = specEnd + 1;
      }
      var endTag = "\\end{" + env + "}";
      var endIdx = text.indexOf(endTag, cursor);
      while (endIdx >= 0 && !evenBackslashes(text, endIdx)) {
        endIdx = text.indexOf(endTag, endIdx + 1);
      }
      if (endIdx < 0) {
        out.push(text.slice(m.index));
        break;
      }
      var body = text.slice(cursor, endIdx);
      pos = endIdx + endTag.length;

      body = body.replace(/\\(?:hline|toprule|midrule|bottomrule)(?![A-Za-z@])/g, "");
      body = body.replace(/\\cline\{[^}]*\}/g, "");
      body = body.replace(/\\cmidrule(?:\([^)]*\))?\{[^}]*\}/g, "");
      body = unwrapMulticolumn(body);
      var rawRows = splitOnUnescaped(body, /\\\\(?:\[[^\]]*\])?\*?|\\tabularnewline(?![A-Za-z@])/g);
      var rowLines = [];
      for (var ri = 0; ri < rawRows.length; ri++) {
        var rawCells = splitOnUnescaped(rawRows[ri], /&/g);
        var cells = [];
        var anyNonEmpty = false;
        for (var ci = 0; ci < rawCells.length; ci++) {
          var c = rawCells[ci].replace(/\s+/g, " ").trim();
          if (c) anyNonEmpty = true;
          cells.push(c);
        }
        if (anyNonEmpty) rowLines.push(cells.join(" | "));
      }
      if (rowLines.length) {
        out.push("\n" + rowLines.join("\n") + "\n");
      }
    }
    return out.join("");
  }

  function convertListEnvs(text) {
    var listRe = /\\begin\{(itemize|enumerate)\}(?:\[[^\]]*\])?((?:(?!\\begin\{(?:itemize|enumerate)\})[\s\S])*?)\\end\{\1\}/g;
    for (var iter = 0; iter < 12; iter++) {
      var changed = false;
      text = text.replace(listRe, function (_full, kind, body) {
        changed = true;
        var itemRe = /\\item(?![A-Za-z@])(?:\[([^\]]*)\])?/g;
        var parts = [];
        var lastPos = 0;
        var im;
        while ((im = itemRe.exec(body)) !== null) {
          if (im.index > 0 && body.charAt(im.index - 1) === "\\") {
            itemRe.lastIndex = im.index + 1;
            continue;
          }
          parts.push(body.slice(lastPos, im.index));
          parts.push(im[1]);
          lastPos = im.index + im[0].length;
        }
        parts.push(body.slice(lastPos));
        var lines = [];
        var idx = 1;
        for (var i = 1; i < parts.length; i += 2) {
          var opt = (parts[i] || "").trim();
          var itemBody = (i + 1 < parts.length ? parts[i + 1] : "") || "";
          var rawLines = itemBody.trim().split(/\r?\n/);
          var joinedParts = [];
          for (var li = 0; li < rawLines.length; li++) {
            var ln = rawLines[li].trim();
            if (!ln) continue;
            if (ln.indexOf("- ") === 0 || /^\d+\.\s/.test(ln)) {
              joinedParts.push("\n" + ln);
            } else if (joinedParts.length) {
              joinedParts.push(" " + ln);
            } else {
              joinedParts.push(ln);
            }
          }
          var itemText = joinedParts.join("").trim();
          if (opt) itemText = (opt + " " + itemText).trim();
          var prefix = kind === "itemize" ? "- " : (idx + ". ");
          idx++;
          if (itemText) lines.push(prefix + itemText);
        }
        return lines.length ? ("\n" + lines.join("\n") + "\n") : "\n";
      });
      if (!changed) break;
    }
    return text;
  }

  function replaceBracedCommands(text, refMap, maskUrl) {
    var cmdRe = /\\([A-Za-z@]+)\*?(?=(?:\[|\{))/g;
    var out = [];
    var pos = 0;
    var n = text.length;
    while (pos < n) {
      cmdRe.lastIndex = pos;
      var m = cmdRe.exec(text);
      while (m && !evenBackslashes(text, m.index)) {
        cmdRe.lastIndex = m.index + 1;
        m = cmdRe.exec(text);
      }
      if (!m) {
        out.push(text.slice(pos));
        break;
      }
      out.push(text.slice(pos, m.index));
      var cmd = m[1];
      var endOfMatch = m.index + m[0].length;
      var cursor = endOfMatch;
      if (cmd === "cmidrule" && cursor < n && text.charAt(cursor) === "(") {
        var pEnd = text.indexOf(")", cursor);
        if (pEnd >= 0) cursor = pEnd + 1;
      }
      cursor = skipOptionalArgs(text, cursor);
      if (cursor >= n || text.charAt(cursor) !== "{") {
        out.push(text.slice(m.index, endOfMatch));
        pos = endOfMatch;
        continue;
      }
      var b1End = findMatchingBrace(text, cursor);
      if (b1End < 0) {
        out.push(text.slice(m.index, endOfMatch));
        pos = endOfMatch;
        continue;
      }
      var arg1 = text.slice(cursor + 1, b1End);
      pos = b1End + 1;

      if (cmd === "begin" || cmd === "end") {
        var envName = arg1.trim();
        if (cmd === "begin") {
          pos = skipOptionalArgs(text, pos);
          if (envName === "minipage" && pos < n && text.charAt(pos) === "{") {
            var wEnd = findMatchingBrace(text, pos);
            if (wEnd >= 0) pos = wEnd + 1;
          }
        }
        continue;
      }
      if (DROP_ARG_CMDS[cmd]) {
        if ((cmd === "setlength" || cmd === "addtolength") && pos < n && text.charAt(pos) === "{") {
          var b2EndDrop = findMatchingBrace(text, pos);
          if (b2EndDrop >= 0) pos = b2EndDrop + 1;
        }
        continue;
      }
      if (cmd === "ref") {
        var lbl = arg1.trim();
        var colon = lbl.indexOf(":");
        var ns = colon >= 0 ? lbl.slice(0, colon) : "other";
        if (!refMap.labels[lbl]) {
          var num = (refMap.counters[ns] || 0) + 1;
          refMap.counters[ns] = num;
          refMap.labels[lbl] = String(num);
        }
        out.push(refMap.labels[lbl]);
        continue;
      }
      if (TWO_ARG_KEEP_SECOND[cmd]) {
        if (pos < n && text.charAt(pos) === "{") {
          var b2End = findMatchingBrace(text, pos);
          if (b2End >= 0) {
            var arg2 = text.slice(pos + 1, b2End);
            pos = b2End + 1;
            out.push(replaceBracedCommands(arg2, refMap, maskUrl));
            continue;
          }
        }
      }
      if (cmd === "url") {
        out.push(maskUrl(arg1));
        continue;
      }
      var inner = replaceBracedCommands(arg1, refMap, maskUrl);
      if (cmd === "textbf") {
        out.push(wrapMarkdown("**", inner));
      } else if (cmd === "textit" || cmd === "emph") {
        out.push(wrapMarkdown("*", inner));
      } else if (cmd === "caption") {
        out.push("\n" + inner.trim() + "\n");
      } else {
        out.push(inner);
      }
    }
    return out.join("");
  }

  function latexToText(text, refMap) {
    if (!text) return "";
    if (!refMap) refMap = { labels: {}, counters: {} };
    var s = String(text).replace(/\r\n/g, "\n");
    var prefix = "SMDMASK";
    while (s.indexOf(prefix) >= 0) prefix += "X";

    var protectedList = [];
    function mask(val) {
      var tok = prefix + "P" + protectedList.length + "Z";
      protectedList.push(val);
      return tok;
    }

    s = s.replace(/\{\{run:[^}]*\}\}|\\cite(?:\[[^\]]*\])?\{[^}]+\}|\[@[A-Za-z0-9_:-]+\]/g, function (m) {
      return mask(m);
    });

    var escapedBraces = [];
    s = s.replace(/\\([{}])/g, function (full, ch, offset) {
      if (!evenBackslashes(s, offset)) return full;
      var tok = prefix + "B" + escapedBraces.length + "Z";
      escapedBraces.push(ch);
      return tok;
    });

    s = convertTabularEnvs(s);
    s = convertListEnvs(s);

    function unwrapPairedDelim(text, openRe, closeRe) {
      var out = [];
      var pos = 0;
      var oRe = new RegExp(openRe.source, "g");
      var cRe = new RegExp(closeRe.source, "g");
      while (pos < text.length) {
        oRe.lastIndex = pos;
        var om = oRe.exec(text);
        while (om && om.index > 0 && text.charAt(om.index - 1) === "\\") {
          oRe.lastIndex = om.index + 1;
          om = oRe.exec(text);
        }
        if (!om) {
          out.push(text.slice(pos));
          break;
        }
        var innerStart = om.index + om[0].length;
        cRe.lastIndex = innerStart;
        var cm = cRe.exec(text);
        while (cm && cm.index > 0 && text.charAt(cm.index - 1) === "\\") {
          cRe.lastIndex = cm.index + 1;
          cm = cRe.exec(text);
        }
        if (!cm || cm.index === innerStart) {
          out.push(text.slice(pos, innerStart));
          pos = innerStart;
          continue;
        }
        out.push(text.slice(pos, om.index));
        out.push(text.slice(innerStart, cm.index));
        pos = cm.index + cm[0].length;
      }
      return out.join("");
    }

    function unwrapInlineDollar(text) {
      var out = [];
      var pos = 0;
      var oRe = /\$(?!\$)/g;
      while (pos < text.length) {
        oRe.lastIndex = pos;
        var om = oRe.exec(text);
        while (om && om.index > 0 && text.charAt(om.index - 1) === "\\") {
          oRe.lastIndex = om.index + 1;
          om = oRe.exec(text);
        }
        if (!om) {
          out.push(text.slice(pos));
          break;
        }
        var innerStart = om.index + 1;
        var scanRe = /\\.|[\$\n]/g;
        scanRe.lastIndex = innerStart;
        var sm;
        var closeIdx = -1;
        while ((sm = scanRe.exec(text)) !== null) {
          if (sm[0] === "\n") break;
          if (sm[0] === "$") {
            if (sm.index > innerStart && text.charAt(sm.index - 1) !== "\\") {
              closeIdx = sm.index;
            }
            break;
          }
        }
        if (closeIdx < 0) {
          out.push(text.slice(pos, innerStart));
          pos = innerStart;
        } else {
          out.push(text.slice(pos, om.index));
          out.push(text.slice(innerStart, closeIdx));
          pos = closeIdx + 1;
        }
      }
      return out.join("");
    }

    s = unwrapPairedDelim(s, /\$\$/, /\$\$/);
    s = unwrapPairedDelim(s, /\\\[/, /\\\]/);
    s = unwrapPairedDelim(s, /\\\(/, /\\\)/);
    s = unwrapInlineDollar(s);

    s = s.replace(/\\(times|pm|leq|le|geq|ge|approx|tau|chi|alpha|beta|mu|sigma|Delta)(?![A-Za-z@])/g, function (full, name, offset) {
      return evenBackslashes(s, offset) ? MATH_SYMBOLS[name] : full;
    });

    s = s.replace(/[ \t]*\\par(?![A-Za-z@])[ \t]*/g, function (full, offset) {
      return evenBackslashes(s, offset) ? "\n\n" : full;
    });
    s = s.replace(STRIP_NOARG_CMDS, function (full, offset) {
      return evenBackslashes(s, offset) ? "" : full;
    });

    var urlMasks = [];
    function maskUrl(rawUrl) {
      var tok = prefix + "U" + urlMasks.length + "Z";
      var cleaned = rawUrl.replace(/\\_/g, "_").replace(/\\%/g, "%")
        .replace(/\\&/g, "&").replace(/\\#/g, "#");
      urlMasks.push(cleaned);
      return tok;
    }
    s = replaceBracedCommands(s, refMap, maskUrl);
    s = s.replace(/https?:\/\/[^\s<>"')}\]]+/g, function (m) {
      return maskUrl(m);
    });

    s = s.replace(/~/g, function (full, offset) {
      return (offset > 0 && s.charAt(offset - 1) === "\\") ? full : " ";
    });

    s = s.replace(/\\\\(?:\[[^\]]*\])?\*?/g, function (full, offset) {
      return evenBackslashes(s, offset) ? "\n" : full;
    });

    var escMap = {
      "_": "_", "%": "%", "&": "&", "#": "#", "$": "$", " ": " ",
      ",": " ", ";": " ", ":": " ", "!": "", "-": "", "/": ""
    };
    s = s.replace(/\\([_%&#$ ,;:!\-/])/g, function (_full, ch) {
      return escMap[ch];
    });
    s = s.replace(/\\['"`^~=.]/g, "");
    s = s.replace(/\\[A-Za-z@]+\*?/g, "");
    s = s.replace(/[{}]/g, "");

    var dashLines = s.split("\n");
    for (var dli = 0; dli < dashLines.length; dli++) {
      var dl = dashLines[dli];
      if (!/^\s*\|[\s\-|:]+\|\s*$/.test(dl)) {
        dl = dl.replace(/(^|[^-])---(?!-)/g, "$1 - ").replace(/(^|[^-])--(?!-)/g, "$1-");
        dashLines[dli] = dl;
      }
    }
    s = dashLines.join("\n");

    for (var bi = 0; bi < escapedBraces.length; bi++) {
      s = s.split(prefix + "B" + bi + "Z").join(escapedBraces[bi]);
    }
    for (var ui = 0; ui < urlMasks.length; ui++) {
      s = s.split(prefix + "U" + ui + "Z").join(urlMasks[ui]);
    }
    for (var pi = 0; pi < protectedList.length; pi++) {
      s = s.split(prefix + "P" + pi + "Z").join(protectedList[pi]);
    }

    s = s.replace(/(\{\{run:[^}]*\.(?:i2|i_squared)\}\})\s*%/g, "$1");

    s = s.replace(/[ \t]{2,}/g, " ");
    s = s.replace(/[ \t]+\n/g, "\n");
    s = s.replace(/\n[ \t]+/g, "\n");
    s = s.replace(/\n{3,}/g, "\n\n");
    return s.trim();
  }

  function vancouver(entry, number) {
    var e = entry || {};
    var authors = e.authors || [];
    var ext = e.externalIds || {};
    var doi = e.doi || ext.DOI || "";
    var pmid = e.pmid || ext.PMID || "";
    if (!e.title && e.citation) {
      var citStr = String(e.citation).replace(/\.+$/, "");
      var outParts = [number + ". " + citStr + "."];
      if (doi && citStr.indexOf(String(doi)) < 0) outParts.push(" doi:" + doi + ".");
      if (pmid && citStr.indexOf(String(pmid)) < 0) outParts.push(" PMID:" + pmid + ".");
      return outParts.join("").trim();
    }
    var authorStr;
    if (authors.length > 6) {
      authorStr = authors.slice(0, 6).join(", ") + ", et al";
    } else {
      authorStr = authors.length ? authors.join(", ") : "[No authors listed]";
    }
    var title = String(e.title || e.label || "").replace(/\.+$/, "");
    var parts = [number + ". " + authorStr + ". " + title + "."];
    var venue = e.venue || e.journal || "";
    if (isPlainObject(venue)) venue = venue.name || "";
    var year = e.year;
    if (venue) parts.push(" " + venue + ".");
    if (year) {
      var tail = String(year);
      if (e.volume) {
        tail += ";" + e.volume;
        if (e.pages) tail += ":" + e.pages;
      }
      parts.push(" " + tail + ".");
    }
    if (doi) parts.push(" doi:" + doi + ".");
    if (pmid) parts.push(" PMID:" + pmid + ".");
    return parts.join("").trim();
  }

  function citationKeysInOrder(sections) {
    var keys = [];
    var seen = {};
    var citeRe = /\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]/g;
    for (var i = 0; i < sections.length; i++) {
      citeRe.lastIndex = 0;
      var m;
      var txt = (sections[i] && sections[i].text) || "";
      while ((m = citeRe.exec(txt)) !== null) {
        var raw = m[1] || m[2] || "";
        var parts = raw.split(",");
        for (var j = 0; j < parts.length; j++) {
          var key = parts[j].trim();
          if (key && !seen[key]) {
            seen[key] = true;
            keys.push(key);
          }
        }
      }
    }
    return keys;
  }

  function renderTokens(text, tokenTable) {
    var table = tokenTable || {};
    return String(text || "").replace(/\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}/g,
      function (full, runId, field) {
        var entry = table[runId + "." + field];
        return entry ? String(entry.value) : full;
      });
  }

  function orderSections(sections) {
    var groups = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i];
      var level = section.level == null ? 1 : section.level;
      if (level <= 1 || !groups.length) {
        var sid = String(section.id || "").toLowerCase();
        var imradIdx = IMRAD_ORDER.indexOf(sid);
        var key = (level <= 1 && imradIdx >= 0) ? [0, imradIdx, i] : [1, 0, i];
        groups.push({ key: key, items: [section] });
      } else {
        groups[groups.length - 1].items.push(section);
      }
    }
    groups.sort(function (a, b) {
      if (a.key[0] !== b.key[0]) return a.key[0] - b.key[0];
      if (a.key[1] !== b.key[1]) return a.key[1] - b.key[1];
      return a.key[2] - b.key[2];
    });
    var out = [];
    for (var gi = 0; gi < groups.length; gi++) {
      for (var si = 0; si < groups[gi].items.length; si++) {
        out.push(groups[gi].items[si]);
      }
    }
    return out;
  }

  function isReferencesSectionHeading(sec) {
    if (!sec) return false;
    var sid = String(sec.id || "").toLowerCase();
    var head = String(sec.heading || "").toLowerCase().replace(/^\d+\.\s*/, "").trim();
    return sid === "references" || /(?:^|-)references$/.test(sid) || head === "references";
  }

  function buildManuscript(opts) {
    var o = opts || {};
    var title = o.title || "";
    var sections = o.sections || [];
    var tokenTable = o.tokenTable || o.token_table || {};
    var references = (o.references || []).slice();
    var citationMap = o.citationMap || o.citation_map || {};
    var manifest = o.manifest || {};
    var outline = o.outline !== undefined ? o.outline : null;

    var byKey = {};
    for (var ri = 0; ri < references.length; ri++) {
      var ref = references[ri];
      if (ref && ref.key) byKey[ref.key] = ref;
    }
    var cmKeys = Object.keys(citationMap);
    for (var ci = 0; ci < cmKeys.length; ci++) {
      if (!byKey[cmKeys[ci]]) byKey[cmKeys[ci]] = citationMap[cmKeys[ci]];
    }

    var orderedRaw = orderSections(sections.slice());
    var refMap = { labels: {}, counters: {} };
    var ordered = [];
    for (var si = 0; si < orderedRaw.length; si++) {
      var s = orderedRaw[si];
      ordered.push({
        id: s.id,
        heading: s.heading,
        level: s.level,
        text: latexToText(s.text || "", refMap)
      });
    }

    var refEntries = [];
    var seenKeys = {};
    var seenIds = {};
    function markSeen(entry, key) {
      if (key) seenKeys[key] = true;
      if (!entry) return;
      var ext = entry.externalIds || {};
      var d = String(entry.doi || ext.DOI || "").toLowerCase();
      var p = String(entry.pmid || ext.PMID || "").toLowerCase();
      if (d) seenIds["doi:" + d] = true;
      if (p) seenIds["pmid:" + p] = true;
      if (entry.studyId) seenIds["study:" + entry.studyId] = true;
    }
    function alreadySeen(entry, key) {
      if (key && seenKeys[key]) return true;
      if (!entry) return false;
      var ext = entry.externalIds || {};
      var d = String(entry.doi || ext.DOI || "").toLowerCase();
      var p = String(entry.pmid || ext.PMID || "").toLowerCase();
      if (d && seenIds["doi:" + d]) return true;
      if (p && seenIds["pmid:" + p]) return true;
      if (entry.studyId && seenIds["study:" + entry.studyId]) return true;
      return false;
    }
    var citedKeys = citationKeysInOrder(ordered);
    for (var ki = 0; ki < citedKeys.length; ki++) {
      var key = citedKeys[ki];
      var number = refEntries.length + 1;
      var entry = byKey[key];
      if (!entry) {
        seenKeys[key] = true;
        refEntries.push({ number: number, key: key, citation: "", doi: "", pmid: "", resolved: false });
        continue;
      }
      var ext = entry.externalIds || {};
      var doi = String(entry.doi || ext.DOI || "");
      var pmid = String(entry.pmid || ext.PMID || "");
      markSeen(entry, key);
      refEntries.push({
        number: number,
        key: key,
        citation: vancouver(entry, number),
        doi: doi,
        pmid: pmid,
        resolved: Boolean(doi || pmid)
      });
    }

    /* Ensure every verified included study from the citation library/manifest
     * appears in the References list even when cited by study label (e.g.
     * "Aronson 1948") without a DOI/PMID. Never invent fields. */
    var allLibEntries = [];
    for (var li = 0; li < references.length; li++) {
      if (references[li] && references[li].key) allLibEntries.push(references[li]);
    }
    for (var lci = 0; lci < cmKeys.length; lci++) {
      var cmEntry = citationMap[cmKeys[lci]];
      if (cmEntry && cmEntry.isIncludedStudy) allLibEntries.push(cmEntry);
    }
    for (var ai = 0; ai < allLibEntries.length; ai++) {
      var cand = allLibEntries[ai];
      if (!cand || !cand.isIncludedStudy) continue;
      if (!cand.citation && !cand.title && !cand.doi && !cand.pmid) continue;
      if (alreadySeen(cand, cand.key)) continue;
      var incNum = refEntries.length + 1;
      var incExt = cand.externalIds || {};
      var incDoi = String(cand.doi || incExt.DOI || "");
      var incPmid = String(cand.pmid || incExt.PMID || "");
      markSeen(cand, cand.key);
      refEntries.push({
        number: incNum,
        key: cand.key,
        citation: vancouver(cand, incNum),
        doi: incDoi,
        pmid: incPmid,
        resolved: Boolean(incDoi || incPmid)
      });
    }

    /* Populate any References section deterministically from verified entries. */
    if (refEntries.length) {
      var refLines = [];
      for (var rli = 0; rli < refEntries.length; rli++) {
        if (refEntries[rli].citation) refLines.push(refEntries[rli].citation);
      }
      var refBody = refLines.join("\n");
      if (refBody) {
        for (var oi = 0; oi < ordered.length; oi++) {
          if (isReferencesSectionHeading(ordered[oi])) {
            ordered[oi].id = "references";
            ordered[oi].heading = "References";
            ordered[oi].text = refBody;
          }
        }
      }
    }

    var protocol = manifest.protocol || {};
    var runIdSet = {};
    var ttKeys = Object.keys(tokenTable);
    for (var ti = 0; ti < ttKeys.length; ti++) {
      if (tokenTable[ttKeys[ti]] && tokenTable[ttKeys[ti]].runId) {
        runIdSet[tokenTable[ttKeys[ti]].runId] = true;
      }
    }
    var engineSet = {};
    var mRuns = manifest.runs || [];
    for (var mi = 0; mi < mRuns.length; mi++) {
      var mr = mRuns[mi] || {};
      engineSet[(mr.engine || "") + ":" + (mr.engineVersion || "")] = true;
    }

    return {
      v: 1,
      title: title || protocol.title || "",
      sections: ordered,
      references: refEntries,
      tokens: tokenTable,
      provenance: {
        protocolHash: protocol.lockHash || "",
        runIds: Object.keys(runIdSet).sort(),
        engines: Object.keys(engineSet).sort(),
        generatedBy: "po_adapter",
        upstreamCommit: "d9bae997e793a015ed38bb1605be9eb58c00284f"
      },
      outline: outline
    };
  }

  /* ==================== Gates (po_adapter/gates.py) ==================== */

  var TOKEN_RE = /\{\{run:([A-Za-z0-9_-]+)\.([A-Za-z0-9_]+(?:\.[A-Za-z0-9_]+)*)\}\}/g;
  var LOOSE_TOKEN_RE = /\{\{run:([^}]*)\}\}/g;
  var NUMBER_RE = /\d+(?:\.\d+)?(?![A-Za-z0-9_])/g;
  var YEAR_RE = /^(?:19|20)\d{2}$/;
  var REVIEWER_COUNT_RE = /\b\d+\s+(?:reviewers|assessors|screeners)\b|\b(?:reviewers|assessors|screeners)\s*(?:=|:)\s*\d+/gi;
  var THRESHOLD_RE = /\b(?:threshold|cutoff|alpha|significance level|type I error)\b[^.!?]{0,30}?\d+(?:\.\d+)?\\?%?|\b(?:heterogeneity|I2|I\u00b2)\b[^.!?]{0,30}?\b(?:25|50|75)\s*\\?%|\b(?:90|95|99)\s*\\?%[~\s]*(?:CI|confidence)\b/gi;
  var EXPONENT_RE = /(?:\^\{?|\\textsuperscript\{)\s*\d+(?:\.\d+)?/g;
  var CITE_RE = /\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]/g;
  var CLAIM_RE = /\b(?:reduc\w*|decreas\w*|increas\w*|improv\w*|worsen\w*|significant\w*|associat\w*|superior|inferior)\b/i;
  var WHETHER_RE = /\bwhether\b/i;
  var OBJECTIVE_RE = /\b(?:aim(?:s|ed)?|objective|purpose|we (?:sought|set out) to|this (?:review|study|analysis) (?:asks|examines|assesses|evaluates|addresses))\b/i;
  var DIR_DOWN_RE = /\b(?:reduc\w*|decreas\w*|lower(?:ed|ing|s)?|declin\w*)\b/i;
  var DIR_UP_RE = /\b(?:increas\w*|higher|elevat\w*|greater)\b/i;
  var SIG_NEG_RE = /\b(?:not|no|without)\s+significan\w*|\bnon-?significan\w*/i;
  var SIG_RE = /\bsignificant(?:ly)?\b/i;

  function execNumbers(str, cb) {
    var re = new RegExp(NUMBER_RE.source, "g");
    var m;
    while ((m = re.exec(str)) !== null) {
      if (m.index > 0 && /[A-Za-z0-9_]/.test(str.charAt(m.index - 1))) {
        re.lastIndex = m.index + 1;
        continue;
      }
      cb(m);
    }
  }

  var NUMBER_GATE_SECTIONS = ["abstract", "results"];
  var CLAIM_GATE_SECTIONS = ["abstract", "results", "discussion"];
  var CI_ALIASES = { ci: 1, ci95: 1, confidence_interval: 1, confidenceinterval: 1 };

  function hasAnyKeyword(sid, heading, list) {
    for (var i = 0; i < list.length; i++) {
      if (sid.indexOf(list[i]) >= 0 || heading.indexOf(list[i]) >= 0) return true;
    }
    return false;
  }

  function maskTokens(text) {
    return String(text || "").replace(new RegExp(TOKEN_RE.source, "g"), function (m) {
      return repeatStr(" ", m.length);
    });
  }

  function allowedNumbers(text) {
    var allowed = {};
    var patterns = [REVIEWER_COUNT_RE, THRESHOLD_RE, EXPONENT_RE];
    for (var pi = 0; pi < patterns.length; pi++) {
      var pat = patterns[pi];
      pat.lastIndex = 0;
      var m;
      while ((m = pat.exec(text)) !== null) {
        execNumbers(m[0], function (n) {
          allowed[(m.index + n.index) + ":" + (m.index + n.index + n[0].length)] = true;
        });
      }
    }
    return allowed;
  }

  function checkNumbers(sections, tokenTable) {
    var table = tokenTable || {};
    var violations = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i] || {};
      var sid = String(section.id || "").toLowerCase();
      var heading = String(section.heading || "").toLowerCase();
      var text = section.text || "";
      var gated = hasAnyKeyword(sid, heading, NUMBER_GATE_SECTIONS);
      var masked = maskTokens(text);
      var allowed = gated ? allowedNumbers(text) : {};
      if (gated) {
        execNumbers(masked, function (nm) {
          var raw = nm[0];
          var spanKey = nm.index + ":" + (nm.index + raw.length);
          if (YEAR_RE.test(raw) || allowed[spanKey]) return;
          violations.push({
            gate: "untokenised_number",
            section: sid || heading,
            start: nm.index,
            end: nm.index + raw.length,
            number: raw
          });
        });
      }
      var tokRe = new RegExp(TOKEN_RE.source, "g");
      var tm;
      while ((tm = tokRe.exec(text)) !== null) {
        var runId = tm[1];
        var field = tm[2];
        var key = runId + "." + field;
        if (table[key]) continue;
        if (CI_ALIASES[field.toLowerCase()] && table[runId + ".ciLower"] && table[runId + ".ciUpper"]) {
          continue;
        }
        violations.push({
          gate: "unknown_token",
          section: sid || heading,
          token: tm[0]
        });
      }
      var looseRe = new RegExp(LOOSE_TOKEN_RE.source, "g");
      var lm;
      var fullTokRe = new RegExp("^" + TOKEN_RE.source + "$");
      while ((lm = looseRe.exec(text)) !== null) {
        if (!fullTokRe.test(lm[0])) {
          violations.push({
            gate: "malformed_token",
            section: sid || heading,
            token: lm[0]
          });
        }
      }
    }
    return violations;
  }

  function manifestIdentifiers(manifest) {
    var ids = {};
    var m = manifest || {};
    var refs = m.references || [];
    for (var i = 0; i < refs.length; i++) {
      var ref = refs[i] || {};
      if (ref.doi) ids[String(ref.doi).toLowerCase()] = true;
      if (ref.pmid) ids[String(ref.pmid).toLowerCase()] = true;
    }
    var ev = m.evidence || [];
    for (var j = 0; j < ev.length; j++) {
      var src = (ev[j] && ev[j].source) || {};
      if (src.doi) ids[String(src.doi).toLowerCase()] = true;
      if (src.pmid) ids[String(src.pmid).toLowerCase()] = true;
    }
    return ids;
  }

  function checkCitations(sections, citationMap, manifest) {
    var violations = [];
    var mIds = manifestIdentifiers(manifest);
    var hasManifestIds = Object.keys(mIds).length > 0;
    var refsByKey = {};
    var mRefs = (manifest && manifest.references) || [];
    for (var ri = 0; ri < mRefs.length; ri++) {
      if (mRefs[ri] && mRefs[ri].key) refsByKey[mRefs[ri].key] = mRefs[ri];
    }
    for (var si = 0; si < sections.length; si++) {
      var section = sections[si] || {};
      var sid = String(section.id || "").toLowerCase();
      var citeRe = new RegExp(CITE_RE.source, "g");
      var cm;
      while ((cm = citeRe.exec(section.text || "")) !== null) {
        var raw = cm[1] || cm[2] || "";
        var keys = raw.split(",");
        for (var ki = 0; ki < keys.length; ki++) {
          var key = keys[ki].trim();
          if (!key) continue;
          var entry = (citationMap && citationMap[key]) || refsByKey[key] || null;
          if (!entry) {
            violations.push({
              gate: "unresolved_citation",
              section: sid,
              key: key,
              reason: "not_in_library"
            });
            continue;
          }
          var ext = entry.externalIds || {};
          var doi = String(entry.doi || ext.DOI || "");
          var pmid = String(entry.pmid || ext.PMID || "");
          if (!doi && !pmid) {
            violations.push({
              gate: "unresolved_citation",
              section: sid,
              key: key,
              reason: "no_doi_or_pmid"
            });
            continue;
          }
          if (hasManifestIds && !(mIds[doi.toLowerCase()] || mIds[pmid.toLowerCase()])) {
            violations.push({
              gate: "unresolved_citation",
              section: sid,
              key: key,
              reason: "not_in_manifest"
            });
          }
        }
      }
    }
    return violations;
  }

  function sentencesOf(text) {
    var s = String(text || "");
    var re = /([.!?])\s+/g;
    var out = [];
    var pos = 0;
    var m;
    while ((m = re.exec(s)) !== null) {
      var seg = s.slice(pos, m.index + 1);
      if (seg.trim()) out.push(seg);
      pos = m.index + m[0].length;
    }
    var tail = s.slice(pos);
    if (tail.trim()) out.push(tail);
    return out;
  }

  function checkClaimLinks(sections) {
    var violations = [];
    var tokOnce = new RegExp(TOKEN_RE.source);
    var citeOnce = new RegExp(CITE_RE.source);
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i] || {};
      var sid = String(section.id || "").toLowerCase();
      var heading = String(section.heading || "").toLowerCase();
      if (!hasAnyKeyword(sid, heading, CLAIM_GATE_SECTIONS)) continue;
      var sents = sentencesOf(section.text || "");
      for (var si = 0; si < sents.length; si++) {
        var sentence = sents[si];
        if (!CLAIM_RE.test(sentence)) continue;
        if (WHETHER_RE.test(sentence) || OBJECTIVE_RE.test(sentence)) continue;
        if (tokOnce.test(sentence) || citeOnce.test(sentence)) continue;
        violations.push({
          gate: "claim_without_source",
          section: sid,
          sentence: sentence.slice(0, 120)
        });
      }
    }
    return violations;
  }

  var FIELD_ALIASES = {
    estimate: ["effect", "pooled.effect"],
    effect: ["estimate", "pooled.effect"],
    ciLower: ["ci_lower", "pooled.ciLower"],
    ci_lower: ["ciLower", "pooled.ciLower"],
    ciUpper: ["ci_upper", "pooled.ciUpper"],
    ci_upper: ["ciUpper", "pooled.ciUpper"],
    p: ["pooled.p"]
  };

  function runField(table, runId, field) {
    var entry = table[runId + "." + field];
    if (entry) return entry.value;
    var alts = FIELD_ALIASES[field];
    if (alts) {
      for (var i = 0; i < alts.length; i++) {
        var e2 = table[runId + "." + alts[i]];
        if (e2) return e2.value;
      }
    }
    return null;
  }

  function checkDirection(sections, tokenTable) {
    var table = tokenTable || {};
    var tableKeys = Object.keys(table);
    var violations = [];
    for (var i = 0; i < sections.length; i++) {
      var section = sections[i] || {};
      var sid = String(section.id || "").toLowerCase();
      var sents = sentencesOf(section.text || "");
      for (var si = 0; si < sents.length; si++) {
        var sentence = sents[si];
        var runIdSet = {};
        var tr = new RegExp(TOKEN_RE.source, "g");
        var tm;
        while ((tm = tr.exec(sentence)) !== null) runIdSet[tm[1]] = true;
        var runIds = Object.keys(runIdSet).sort();
        if (!runIds.length) continue;
        var down = DIR_DOWN_RE.exec(sentence);
        var up = DIR_UP_RE.exec(sentence);
        var sigNeg = SIG_NEG_RE.test(sentence);
        var sig = SIG_RE.test(sentence);
        for (var ri = 0; ri < runIds.length; ri++) {
          var runId = runIds[ri];
          var entry = null;
          for (var tk = 0; tk < tableKeys.length; tk++) {
            var cand = table[tableKeys[tk]];
            if (cand && cand.runId === runId) { entry = cand; break; }
          }
          if (!entry) continue;
          var nullVal = entry["null"];
          var estimate = runField(table, runId, "estimate");
          if (estimate !== null && estimate !== undefined && (down || up)) {
            if (down && !(estimate < nullVal)) {
              violations.push({
                gate: "direction_mismatch",
                section: sid,
                runId: runId,
                word: down[0],
                estimate: estimate,
                "null": nullVal
              });
            }
            if (up && !(estimate > nullVal)) {
              violations.push({
                gate: "direction_mismatch",
                section: sid,
                runId: runId,
                word: up[0],
                estimate: estimate,
                "null": nullVal
              });
            }
          }
          if (sig) {
            var lo = runField(table, runId, "ciLower");
            var hi = runField(table, runId, "ciUpper");
            if (lo === null || lo === undefined || hi === null || hi === undefined) continue;
            var excludes = lo > nullVal || hi < nullVal;
            if (sigNeg && excludes) {
              violations.push({
                gate: "significance_mismatch",
                section: sid,
                runId: runId,
                claim: "not significant",
                ci: [lo, hi],
                "null": nullVal
              });
            } else if (!sigNeg && !excludes) {
              violations.push({
                gate: "significance_mismatch",
                section: sid,
                runId: runId,
                claim: "significant",
                ci: [lo, hi],
                "null": nullVal
              });
            }
          }
        }
      }
    }
    return violations;
  }

  function runGates(sections, tokenTable, citationMap, manifest) {
    return []
      .concat(checkNumbers(sections, tokenTable))
      .concat(checkCitations(sections, citationMap, manifest))
      .concat(checkClaimLinks(sections))
      .concat(checkDirection(sections, tokenTable));
  }

  function checkPaper(text, tokenTable, citationMap, manifest) {
    var sections = parseLatexSections(text);
    if (!sections.length) {
      sections = [{ id: "results", heading: "Results", level: 1, text: String(text || "") }];
    }
    return runGates(sections, tokenTable, citationMap, manifest);
  }

  function enforce(sections, tokenTable, citationMap, manifest) {
    var violations = runGates(sections, tokenTable, citationMap, manifest);
    if (violations.length) {
      var gateSet = {};
      for (var i = 0; i < violations.length; i++) gateSet[violations[i].gate] = true;
      throw makeError("gate_failed", Object.keys(gateSet).sort().join(", "), { violations: violations });
    }
  }

  /* ==================== LLM response parsers (utils/gemini_utils.py) ==================== */

  function cleanJsonString(str) {
    var cleaned = str.replace(/[\x00-\x1F\x7F]/g, "");
    cleaned = cleaned.replace(/,\s*([\]}])/g, "$1");
    cleaned = cleaned.replace(/\\(?![\\"/bfnrtu])/g, "\\\\");
    return cleaned;
  }

  function parseGeminiJsonResults(response) {
    if (!response || typeof response !== "string") return null;
    var matches = [];
    var m;
    var fencedRe = /```json([\s\S]*?)```/g;
    while ((m = fencedRe.exec(response)) !== null) matches.push(m[1]);
    if (!matches.length) {
      var bareRe = /(\{[\s\S]*\}|\[[\s\S]*\])/g;
      while ((m = bareRe.exec(response)) !== null) matches.push(m[1]);
    }
    for (var i = 0; i < matches.length; i++) {
      var jsonStr = matches[i].trim();
      try { return JSON.parse(jsonStr); } catch (e1) {
        try { return JSON.parse(cleanJsonString(jsonStr)); } catch (e2) {}
      }
    }
    try {
      var startIdx = response.indexOf("{");
      var endIdx = response.lastIndexOf("}");
      if (startIdx !== -1 && endIdx !== -1 && endIdx > startIdx) {
        return JSON.parse(cleanJsonString(response.slice(startIdx, endIdx + 1)));
      }
    } catch (e3) {}
    return null;
  }

  function parseGeminiLatexResults(response) {
    if (typeof response !== "string") return "";
    var match = /```latex\s*([\s\S]*?)\s*```/.exec(response.trim());
    return match ? match[1] : response;
  }

  function parseGeminiJsonLatexResponse(responseText) {
    var result = { json: null, latex: null };
    if (typeof responseText !== "string") return result;
    var jsonMatch = /```json\s*([\s\S]*?)\s*```/.exec(responseText);
    if (jsonMatch) {
      try {
        result.json = JSON.parse(jsonMatch[1]);
      } catch (e) {
        result.json = { error: "Invalid JSON format returned" };
      }
    }
    var latexMatch = /```latex\s*([\s\S]*?)\s*```/.exec(responseText);
    if (latexMatch) {
      result.latex = latexMatch[1];
    }
    return result;
  }

  var API = {
    verhoeffValid: verhoeffValid,
    verhoeffCheckDigit: verhoeffCheckDigit,
    nhsMod11Valid: nhsMod11Valid,
    scanPhi: scanPhi,
    phiCategories: phiCategories,
    nullForMeasure: nullForMeasure,
    buildTokenTable: buildTokenTable,
    validateManifest: validateManifest,
    buildInputs: buildInputs,
    IMRAD_ORDER: IMRAD_ORDER,
    parseLatexSections: parseLatexSections,
    latexToText: latexToText,
    vancouver: vancouver,
    renderTokens: renderTokens,
    buildManuscript: buildManuscript,
    checkNumbers: checkNumbers,
    checkCitations: checkCitations,
    checkClaimLinks: checkClaimLinks,
    checkDirection: checkDirection,
    runGates: runGates,
    checkPaper: checkPaper,
    enforce: enforce,
    parseGeminiJsonResults: parseGeminiJsonResults,
    parseGeminiLatexResults: parseGeminiLatexResults,
    parseGeminiJsonLatexResponse: parseGeminiJsonLatexResponse
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (G) G.SMD_RMD_PO_GATES = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
