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

  function parseDateStr(s) {
    if (!s) return null;
    var str = String(s).trim();
    var m;
    if ((m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(str))) {
      return new Date(parseInt(m[1], 10), parseInt(m[2], 10) - 1, parseInt(m[3], 10));
    }
    if ((m = /^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})$/.exec(str))) {
      var y = parseInt(m[3], 10);
      if (y < 100) y += 2000;
      return new Date(y, parseInt(m[2], 10) - 1, parseInt(m[1], 10));
    }
    if ((m = /^(\d{1,2})\s+([A-Za-z]+)(?:\s+(\d{2,4}))?$/.exec(str))) {
      var mon = MONTHS[m[2].toLowerCase()];
      if (mon) {
        var yr = m[3] ? parseInt(m[3], 10) : 2026;
        if (yr < 100) yr += 2000;
        return new Date(yr, mon - 1, parseInt(m[1], 10));
      }
    }
    if ((m = /^([A-Za-z]+)\s+(\d{1,2})(?:,?\s+(\d{2,4}))?$/.exec(str))) {
      var mon2 = MONTHS[m[1].toLowerCase()];
      if (mon2) {
        var yr2 = m[3] ? parseInt(m[3], 10) : 2026;
        if (yr2 < 100) yr2 += 2000;
        return new Date(yr2, mon2 - 1, parseInt(m[2], 10));
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

    // 2. Hospital-number patterns (UHID, MRN, IP No, CR No followed by digits)
    var uhidRe = /\b(?:UHID|MRN|IP(?:\s*No\.?|\s*Number)?|CR(?:\s*No\.?|\s*Number)?|Hospital\s*No\.?)[ \t:#.-]*\d+\b/gi;
    var uh;
    while ((uh = uhidRe.exec(s)) !== null) {
      add("uhid", uh[0]);
    }

    // 3. 12-digit Aadhaar-shaped numbers (4-4-4 or run of 12)
    var aadhaarRe = /\b(?:\d{4}[ -]\d{4}[ -]\d{4}|\d{12})\b/g;
    var ah;
    while ((ah = aadhaarRe.exec(s)) !== null) {
      add("aadhaar", ah[0]);
    }

    // 4. 6-digit PIN codes after a place word
    var pinRe = /\b(?:PIN(?:\s*code)?|pincode|postal\s*code|zip(?:\s*code)?|city|district|nagar|colony|road|street|state|mumbai|delhi|bengaluru|bangalore|hyderabad|chennai|kolkata|pune|ahmedabad|jaipur|lucknow|chandigarh|kochi|indore|bhopal|patna|kanpur|nagpur|at|in|near)\b[ \t:#.-]*([1-9]\d{5})\b/gi;
    var pi;
    while ((pi = pinRe.exec(s)) !== null) {
      add("pin", pi[0]);
    }

    // 5. 10-digit phones starting 6 to 9 (with +91 or 0 prefix, spaces or hyphens)
    var phoneRe = /(?:(?:\+91|0)[ -]?)?[6-9]\d{2,4}[ -]?\d{2,4}[ -]?\d{2,4}\b/g;
    var ph;
    while ((ph = phoneRe.exec(s)) !== null) {
      var rawDigits = ph[0].replace(/\D/g, "");
      if ((ph[0].indexOf("+91") === 0 && rawDigits.length === 12 && /^[6-9]/.test(rawDigits.slice(2))) ||
          (ph[0].indexOf("0") === 0 && rawDigits.length === 11 && /^[6-9]/.test(rawDigits.slice(1))) ||
          (rawDigits.length === 10 && /^[6-9]/.test(rawDigits))) {
        add("phone", ph[0]);
      }
    }

    // 6. Dates (dd/mm/yyyy, dd-mm-yy, yyyy-mm-dd, "12 March 2026", "March 12")
    var dateRe = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{2,4})?)\b/gi;
    var da;
    while ((da = dateRe.exec(s)) !== null) {
      add("date", da[0]);
    }

    return hits;
  }

  function replaceDatesWithDayN(text, baseDate) {
    if (!baseDate) return text;
    var re = /\b(?:\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4}|\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*(?:\s+\d{2,4})?|(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\s+\d{1,2}(?:,?\s+\d{2,4})?)\b/gi;
    return text.replace(re, function (match) {
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
      var hitsInit = scan(rawText);
      var earliestDate = null;
      for (var i = 0; i < hitsInit.length; i++) {
        if (hitsInit[i].kind === "date") {
          var dt = parseDateStr(hitsInit[i].match);
          if (dt && (!earliestDate || dt.getTime() < earliestDate.getTime())) {
            earliestDate = dt;
          }
        }
      }
      var base = opts.presentationDate ? parseDateStr(opts.presentationDate) : earliestDate;
      var processed = replaceDatesWithDayN(rawText, base);
      processed = deidentifyAgeText(processed);
      var scanRes = scan(processed);
      var findingsArr = [];
      for (var j = 0; j < scanRes.length; j++) {
        findingsArr.push(scanRes[j].kind + ": " + scanRes[j].match);
      }
      return {
        text: processed,
        removed: [],
        blocked: scanRes.length > 0,
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

    return {
      text: assembled,
      removed: removed,
      blocked: finalHits.length > 0,
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
    numbersNotIn: numbersNotIn
  };

  if (typeof module !== "undefined" && module.exports) {
    module.exports = API;
  }
  if (G) {
    G.RMDPhi = API;
  }
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this));
