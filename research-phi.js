/* StewardMD - ResearchMD de-identification (window.RMDPhi).
 * ES5 IIFE. Dual export: module.exports and the browser global.
 * No em or en dashes.
 */
(function (G) {
  "use strict";

  var MONTHS = {
    jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
    january: 1, february: 2, march: 3, april: 4, june: 6, july: 7, august: 8, september: 9, october: 10, november: 11, december: 12
  };

  var MON_STR = "Jan(?:uary)?|Feb(?:ruary)?|Mar(?:ch)?|Apr(?:il)?|May|Jun(?:e)?|Jul(?:y)?|Aug(?:ust)?|Sep(?:tember)?|Oct(?:ober)?|Nov(?:ember)?|Dec(?:ember)?";
  var DATE_PATTERN = "\\b(?:" +
    "(?:(?:19|20)\\d{2}([\\/-])(?:0?[1-9]|1[0-2])\\1(?:0?[1-9]|[12]\\d|3[01]))|" +
    "(?:(?:0?[1-9]|[12]\\d|3[01])([\\/.\\-])(?:0?[1-9]|1[0-2])\\2(?:19|20)\\d{2})|" +
    "(?:(?:0?[1-9]|[12]\\d|3[01])([/.\\-])(?:0?[1-9]|1[0-2])\\3\\d{2})|" +
    "(?:(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?[ -]+(?:" + MON_STR + ")[ -]+(?:(?:19|20)\\d{2}|\\d{2}))|" +
    "(?:(?:" + MON_STR + ")[ -]+(?:0?[1-9]|[12]\\d|3[01])(?:st|nd|rd|th)?(?:(?:,\\s*|[ -]+)(?:(?:19|20)\\d{2}|\\d{2}(?![./-]\\d)))?)|" +
    "(?:(?:" + MON_STR + ")[ -]+(?:19|20)\\d{2})" +
  ")\\b";

  var UNIT_AFTER_RE = /^\s*(?:mg|mcg|ug|g|kg|ml|dl|l|km|m|cm|mm|days?|hours?|hrs?|hr|weeks?|wks?|months?|mos?|years?|yrs?|patients?|pts?|%|fold|times|iu|units?|meq|mmol)\b/i;

  function isDecimalBoundary(str, start, end) {
    if (start > 0) {
      var prev = str.charAt(start - 1);
      if (/[0-9]/.test(prev) || (prev === "." && start > 1 && /[0-9]/.test(str.charAt(start - 2)))) return true;
    }
    if (end < str.length) {
      var next = str.charAt(end);
      if (/[0-9]/.test(next) || (next === "." && end + 1 < str.length && /[0-9]/.test(str.charAt(end + 1)))) return true;
    }
    return false;
  }

  function parseDateStr(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m;
    if ((m = /^(19\d{2}|20\d{2})([\/-])(0?[1-9]|1[0-2])\2(0?[1-9]|[12]\d|3[01])$/.exec(str))) {
      var y = parseInt(m[1], 10), mo = parseInt(m[3], 10), d = parseInt(m[4], 10);
      var dt = new Date(y, mo - 1, d);
      if (dt.getFullYear() === y && dt.getMonth() === mo - 1 && dt.getDate() === d) return dt;
    }
    if ((m = /^(0?[1-9]|[12]\d|3[01])([\/.\\-])(0?[1-9]|1[0-2])\2(19\d{2}|20\d{2})$/.exec(str))) {
      var y2 = parseInt(m[4], 10), mo2 = parseInt(m[3], 10), d2 = parseInt(m[1], 10);
      var dt2 = new Date(y2, mo2 - 1, d2);
      if (dt2.getFullYear() === y2 && dt2.getMonth() === mo2 - 1 && dt2.getDate() === d2) return dt2;
    }
    if ((m = /^(0?[1-9]|[12]\d|3[01])([/.\-])(0?[1-9]|1[0-2])\2(\d{2})$/.exec(str))) {
      var y3 = 2000 + parseInt(m[4], 10), mo3 = parseInt(m[3], 10), d3 = parseInt(m[1], 10);
      var dt3 = new Date(y3, mo3 - 1, d3);
      if (dt3.getFullYear() === y3 && dt3.getMonth() === mo3 - 1 && dt3.getDate() === d3) return dt3;
    }
    if ((m = /^(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?[ -]+([A-Za-z]+)[ -]+((?:19|20)\d{2}|\d{2})$/.exec(str))) {
      var mon = MONTHS[m[2].toLowerCase()];
      if (mon) {
        var yr = parseInt(m[3], 10);
        if (yr < 100) yr += 2000;
        var d4 = parseInt(m[1], 10);
        var dt4 = new Date(yr, mon - 1, d4);
        if (dt4.getFullYear() === yr && dt4.getMonth() === mon - 1 && dt4.getDate() === d4) return dt4;
      }
    }
    if ((m = /^([A-Za-z]+)[ -]+(0?[1-9]|[12]\d|3[01])(?:st|nd|rd|th)?(?:(?:,\s*|[ -]+)((?:19|20)\d{2}|\d{2}))?$/.exec(str))) {
      var mon2 = MONTHS[m[1].toLowerCase()];
      if (mon2) {
        if (!m[3] && (m[1] === "may" || m[1] === "march")) return null;
        var yr2 = m[3] ? parseInt(m[3], 10) : 2026;
        if (yr2 < 100) yr2 += 2000;
        var d5 = parseInt(m[2], 10);
        var dt5 = new Date(yr2, mon2 - 1, d5);
        if (dt5.getFullYear() === yr2 && dt5.getMonth() === mon2 - 1 && dt5.getDate() === d5) return dt5;
      }
    }
    if ((m = /^([A-Za-z]+)[ -]+(19\d{2}|20\d{2})$/.exec(str))) {
      var mon3 = MONTHS[m[1].toLowerCase()];
      if (mon3) {
        var yr3 = parseInt(m[2], 10);
        return new Date(yr3, mon3 - 1, 1);
      }
    }
    return null;
  }

  function scan(text) {
    var s = String(text == null ? "" : text);
    var hits = [];

    function add(kind, m) {
      hits.push({ kind: kind, match: m });
    }

    // 1. Email addresses
    var emailRe = /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g;
    var em;
    while ((em = emailRe.exec(s)) !== null) {
      add("email", em[0]);
    }

    // 2. Hospital-number patterns (UHID, MRN, IP No, IPD No, OP No, OPD No, CR No, Reg No, Registration number, Hospital number, Hosp No)
    var uhidRe = /\b(?:Registration\s*(?:Number|No\.?)|Hospital\s*(?:Number|No\.?)|Hosp\s*(?:Number|No\.?)|Reg\s*(?:Number|No\.?)|OPD(?:\s*(?:Number|No\.?))?|OP\s*(?:Number|No\.?)|IPD(?:\s*(?:Number|No\.?))?|IP\s*(?:Number|No\.?)|CR\s*(?:Number|No\.?)|UHID(?:\s*(?:Number|No\.?))?|MRN(?:\s*(?:Number|No\.?))?)\b[ \t:#.-]*(?=[A-Za-z0-9\/-]*\d)[A-Za-z0-9\/-]{3,20}\b/gi;
    var uh;
    while ((uh = uhidRe.exec(s)) !== null) {
      add("uhid", uh[0]);
    }

    // 3. Aadhaar-shaped numbers (4-4-4, run of 12, or masked XXXX XXXX 1234)
    var aadhaarRe = /\b(?:\d{4}[ -]\d{4}[ -]\d{4}|[Xx*]{4}[ -]?[Xx*]{4}[ -]?\d{4}|\d{12})\b/g;
    var ah;
    while ((ah = aadhaarRe.exec(s)) !== null) {
      var parts = ah[0].split(/[ -]/);
      if (parts.length === 3 && parts[0].length === 4 && parts[1].length === 4 && parts[2].length === 4) {
        var y1 = parseInt(parts[0], 10), y2 = parseInt(parts[1], 10), y3 = parseInt(parts[2], 10);
        if (y1 >= 1900 && y1 <= 2099 && y2 >= 1900 && y2 <= 2099 && y3 >= 1900 && y3 <= 2099) continue;
      }
      add("aadhaar", ah[0]);
    }

    // 4. 6-digit PIN codes after a place word
    var pinRe = /\b(?:PIN(?:\s*code)?|pincode|postal\s*code|zip(?:\s*code)?|city|district|nagar|colony|road|street|state|mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|chandigarh|kochi|indore|bhopal|patna|kanpur|nagpur|at|in|near)\b[ \t:#.-]*([1-9]\d{5})\b/gi;
    var pi;
    while ((pi = pinRe.exec(s)) !== null) {
      add("pin", pi[0]);
    }

    // 5. Phones: 10-digit mobiles (6 to 9 with +91, 0, spaces, dots or hyphens) and landlines with STD code
    var phoneRe = /(?:\(0\d{2,4}\)[\s.\-]?\d{3,4}[\s.\-]?\d{3,4}|\b0\d{2,4}[\s.\-]\d{3,4}[\s.\-]?\d{3,4}\b|\b0\d{2,4}[\-]\d{6,8}\b|(?:\+91[\s.\-]?)?\b(?:0[\s.\-]?)?[6-9]\d{2,4}[\s.\-]?\d{2,4}[\s.\-]?\d{2,4}\b)/g;
    var ph;
    while ((ph = phoneRe.exec(s)) !== null) {
      var rawDigits = ph[0].replace(/\D/g, "");
      if (/^\(0\d{2,4}\)/.test(ph[0]) || /^0\d{2,4}[-.\s]/.test(ph[0]) || /^0\d{2,4}-\d{6,8}/.test(ph[0])) {
        if (rawDigits.length >= 10 && rawDigits.length <= 12) {
          add("phone", ph[0]);
        }
      } else if (
        (ph[0].indexOf("+91") === 0 && rawDigits.length === 12 && /^[6-9]/.test(rawDigits.slice(2))) ||
        (ph[0].indexOf("0") === 0 && rawDigits.length === 11 && /^[6-9]/.test(rawDigits.slice(1))) ||
        (rawDigits.length === 10 && /^[6-9]/.test(rawDigits))
      ) {
        add("phone", ph[0]);
      }
    }

    // 6. Dates (shared DATE_PATTERN)
    var dateRe = new RegExp(DATE_PATTERN, "gi");
    var da;
    while ((da = dateRe.exec(s)) !== null) {
      if (isDecimalBoundary(s, da.index, da.index + da[0].length)) continue;
      if (/^[A-Za-z]+[ -]+\d{1,2}(?:st|nd|rd|th)?$/i.test(da[0]) && UNIT_AFTER_RE.test(s.slice(da.index + da[0].length))) continue;
      if (!parseDateStr(da[0])) continue;
      add("date", da[0]);
    }

    return hits;
  }

  function replaceDatesWithDayN(text, baseDate) {
    if (!text || !baseDate) return text;
    var re = new RegExp(DATE_PATTERN, "gi");
    return text.replace(re, function () {
      var match = arguments[0];
      var offset = arguments[arguments.length - 2];
      var fullStr = arguments[arguments.length - 1];
      if (isDecimalBoundary(fullStr, offset, offset + match.length)) return match;
      if (/^[A-Za-z]+[ -]+\d{1,2}(?:st|nd|rd|th)?$/i.test(match) && UNIT_AFTER_RE.test(fullStr.slice(offset + match.length))) return match;
      var d = parseDateStr(match);
      if (!d) return match;
      var diffMs = d.getTime() - baseDate.getTime();
      var diffDays = Math.round(diffMs / (24 * 3600 * 1000));
      if (diffDays === 0) return "Day 0";
      if (diffDays > 0) return "Day " + diffDays;
      return "Day -" + Math.abs(diffDays);
    });
  }

  function deidentifyAgeText(text) {
    if (!text) return "";
    var s = String(text);
    // Age 90 or more becomes "90 or older"
    s = s.replace(/\b(?:age|aged|age of|age:)\s*(\d{2,3})\b/gi, function (match, num) {
      if (parseInt(num, 10) >= 90) return match.replace(num, "90 or older");
      return match;
    });
    s = s.replace(/\b(\d{2,3})\s*(?:-| )(?:year|yr)s?(?:-| )old\b/gi, function (match, num) {
      if (parseInt(num, 10) >= 90) return "90 or older year-old";
      return match;
    });
    s = s.replace(/\bage\s+9[0-9]\b/gi, "age 90 or older");
    return s;
  }

  var ALLOWED_FIELDS = {
    age: true,
    sex: true,
    gender: true,
    presentationDate: true,
    presentation_date: true,
    dateOfPresentation: true,
    firstPresentationDate: true,
    date: true,
    presentingComplaint: true,
    presenting_complaint: true,
    chiefComplaint: true,
    history: true,
    historyOfPresentIllness: true,
    examination: true,
    physicalExamination: true,
    investigations: true,
    diagnosis: true,
    treatment: true,
    management: true,
    interventions: true,
    outcome: true,
    outcomeAndFollowUp: true,
    followUp: true,
    unusual: true,
    novelty: true,
    whatIsNew: true,
    whatIsNewOrUnusual: true,
    timeline: true,
    patientPerspective: true,
    notes: true
  };

  function prepareCaseText(casefile, opts) {
    opts = opts || {};
    var removed = [];
    var parts = [];

    if (casefile == null) {
      return { text: "", removed: [], blocked: false, findings: [] };
    }

    if (typeof casefile === "string") {
      var rawText = casefile;
      var base = opts.presentationDate ? parseDateStr(opts.presentationDate) : null;
      var processed = base ? replaceDatesWithDayN(rawText, base) : rawText;
      processed = deidentifyAgeText(processed);
      var scanRes = scan(processed);
      var findingsArr = [];
      for (var j = 0; j < scanRes.length; j++) {
        findingsArr.push(scanRes[j].kind + ": " + scanRes[j].match);
      }
      var redactFn = (G && G.SMD_redactPHI) ? G.SMD_redactPHI : (typeof window !== "undefined" && window.SMD_redactPHI ? window.SMD_redactPHI : null);
      if (redactFn) {
        try {
          var redactedStr = redactFn(processed);
          if (redactedStr !== processed) {
            findingsArr.push("phi: personal identifier flagged by privacy filter");
          }
        } catch (e1) {}
      }
      return {
        text: processed,
        removed: [],
        blocked: scanRes.length > 0 || findingsArr.length > 0,
        findings: findingsArr
      };
    }

    // Inspect object keys for allowlist
    var keys = Object.keys(casefile);
    for (var k = 0; k < keys.length; k++) {
      var key = keys[k];
      if (!ALLOWED_FIELDS[key]) {
        removed.push({ field: key, reason: "Identifiable or disallowed field removed" });
      }
    }

    // Determine base presentation date
    var baseDate = null;
    if (opts.presentationDate) {
      baseDate = parseDateStr(opts.presentationDate);
    } else if (casefile.presentationDate) {
      baseDate = parseDateStr(casefile.presentationDate);
    } else if (casefile.dateOfPresentation) {
      baseDate = parseDateStr(casefile.dateOfPresentation);
    } else if (casefile.firstPresentationDate) {
      baseDate = parseDateStr(casefile.firstPresentationDate);
    } else if (casefile.date) {
      baseDate = parseDateStr(casefile.date);
    }

    // If still null, search investigations or other dates
    if (!baseDate && Array.isArray(casefile.investigations)) {
      for (var invIdx = 0; invIdx < casefile.investigations.length; invIdx++) {
        var invDate = parseDateStr(casefile.investigations[invIdx].date);
        if (invDate && (!baseDate || invDate.getTime() < baseDate.getTime())) {
          baseDate = invDate;
        }
      }
    }

    // Age & sex
    var ageVal = casefile.age;
    var ageStr = "";
    if (ageVal != null) {
      var nAge = parseInt(ageVal, 10);
      if (!isNaN(nAge) && nAge >= 90) {
        ageStr = "90 or older";
      } else {
        ageStr = String(ageVal);
      }
    }
    var sexStr = casefile.sex || casefile.gender || "";
    if (ageStr || sexStr) {
      var patLine = "Patient: " + (ageStr ? "Age " + ageStr : "") + (ageStr && sexStr ? ", " : "") + (sexStr ? sexStr : "");
      parts.push(patLine);
    }

    var complaint = casefile.presentingComplaint || casefile.presenting_complaint || casefile.chiefComplaint;
    if (complaint) parts.push("Presenting complaint: " + complaint);

    var hist = casefile.history || casefile.historyOfPresentIllness;
    if (hist) parts.push("History: " + hist);

    var exam = casefile.examination || casefile.physicalExamination;
    if (exam) parts.push("Examination: " + exam);

    if (casefile.investigations) {
      if (Array.isArray(casefile.investigations)) {
        var invLines = ["Investigations:"];
        for (var idx = 0; idx < casefile.investigations.length; idx++) {
          var item = casefile.investigations[idx];
          if (typeof item === "string") {
            invLines.push("- " + item);
          } else if (item && typeof item === "object") {
            var itemDate = item.date ? replaceDatesWithDayN(item.date, baseDate) : "";
            var desc = (itemDate ? itemDate + ": " : "") + (item.test || "") + (item.value ? " " + item.value : "") + (item.unit ? " " + item.unit : "");
            invLines.push("- " + desc.trim());
          }
        }
        parts.push(invLines.join("\n"));
      } else {
        parts.push("Investigations: " + String(casefile.investigations));
      }
    }

    var diag = casefile.diagnosis;
    if (diag) parts.push("Diagnosis: " + diag);

    var treat = casefile.treatment || casefile.management || casefile.interventions;
    if (treat) parts.push("Treatment: " + treat);

    var outc = casefile.outcome || casefile.outcomeAndFollowUp || casefile.followUp;
    if (outc) parts.push("Outcome and follow-up: " + outc);

    var unus = casefile.unusual || casefile.novelty || casefile.whatIsNew || casefile.whatIsNewOrUnusual;
    if (unus) parts.push("What is unusual: " + unus);

    if (casefile.timeline) {
      if (Array.isArray(casefile.timeline)) {
        var timeLines = ["Timeline:"];
        for (var tIdx = 0; tIdx < casefile.timeline.length; tIdx++) {
          var tItem = casefile.timeline[tIdx];
          if (typeof tItem === "string") {
            timeLines.push("- " + tItem);
          } else if (tItem && typeof tItem === "object") {
            var tDate = tItem.date ? replaceDatesWithDayN(tItem.date, baseDate) : (tItem.day || "");
            timeLines.push("- " + (tDate ? tDate + ": " : "") + (tItem.event || tItem.text || ""));
          }
        }
        parts.push(timeLines.join("\n"));
      } else {
        parts.push("Timeline: " + String(casefile.timeline));
      }
    }

    if (casefile.patientPerspective) parts.push("Patient perspective: " + casefile.patientPerspective);
    if (casefile.notes) parts.push("Notes: " + casefile.notes);

    var assembled = parts.join("\n\n");
    assembled = replaceDatesWithDayN(assembled, baseDate);
    assembled = deidentifyAgeText(assembled);

    var finalHits = scan(assembled);
    var finalFindings = [];
    for (var f = 0; f < finalHits.length; f++) {
      finalFindings.push(finalHits[f].kind + ": " + finalHits[f].match);
    }
    var redactFnObj = (G && G.SMD_redactPHI) ? G.SMD_redactPHI : (typeof window !== "undefined" && window.SMD_redactPHI ? window.SMD_redactPHI : null);
    if (redactFnObj) {
      try {
        var redactedObj = redactFnObj(assembled);
        if (redactedObj !== assembled) {
          finalFindings.push("phi: personal identifier flagged by privacy filter");
        }
      } catch (e2) {}
    }

    return {
      text: assembled,
      removed: removed,
      blocked: finalHits.length > 0 || finalFindings.length > 0,
      findings: finalFindings
    };
  }

  function extractNumbers(text) {
    var s = String(text || "");
    var re = /\b\d+(?:\.\d+)?\b/g;
    var m;
    var list = [];
    while ((m = re.exec(s)) !== null) {
      list.push(m[0]);
    }
    return list;
  }

  function numbersNotIn(draft, source) {
    var srcNums = extractNumbers(source);
    var srcVals = {};
    for (var i = 0; i < srcNums.length; i++) {
      var v = parseFloat(srcNums[i]);
      if (!isNaN(v)) {
        srcVals[v] = true;
        srcVals[srcNums[i]] = true;
      }
    }
    var draftNums = extractNumbers(draft);
    var missing = [];
    var seen = {};
    for (var j = 0; j < draftNums.length; j++) {
      var raw = draftNums[j];
      var val = parseFloat(raw);
      if (!isNaN(val)) {
        if (!srcVals[val] && !srcVals[raw]) {
          if (!seen[raw]) {
            seen[raw] = true;
            missing.push(raw);
          }
        }
      }
    }
    return missing;
  }

  var API = {
    prepareCaseText: prepareCaseText,
    scan: scan,
    numbersNotIn: numbersNotIn,
    replaceDatesWithDayN: replaceDatesWithDayN
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.RMDPhi = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
