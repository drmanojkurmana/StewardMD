/* StewardMD - ResearchMD case text de-identification (window.RMDPhi).
 * ES5 only, pure (no DOM, no network). Dual export: browser global and CommonJS.
 *
 * Runs on the phone before "Ask MaiK to draft it" sends a case report:
 *  - exact dates become "Day N" (Day 0 = first presentation);
 *  - an age of 90 or more becomes "90 or older";
 *  - name, hospital number, address and phone fields are dropped;
 *  - any date, 10-digit phone, email, 12-digit Aadhaar-shaped number, hospital
 *    number or labelled PIN code left in the text blocks sending until edited.
 * numbersNotIn lists numbers in an AI draft that are not in the case text, so
 * the screen can mark each one "This number is not in your case file. Check it."
 */
(function (G) {
  "use strict";

  var MONTHS = "jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?";
  var MONTH_INDEX = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

  var PATTERNS = [
    { kind: "email", re: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g },
    { kind: "date", re: /\b\d{1,2}[\/.-]\d{1,2}[\/.-](?:\d{4}|\d{2})\b/g },
    { kind: "date", re: /\b\d{4}[\/.-]\d{1,2}[\/.-]\d{1,2}\b/g },
    { kind: "date", re: new RegExp("\\b\\d{1,2}(?:st|nd|rd|th)?\\s+(?:of\\s+)?(?:" + MONTHS + ")\\.?,?\\s+\\d{4}\\b", "gi") },
    { kind: "date", re: new RegExp("\\b(?:" + MONTHS + ")\\.?\\s+\\d{1,2}(?:st|nd|rd|th)?,?\\s+\\d{4}\\b", "gi") },
    { kind: "aadhaar", re: /\b[2-9]\d{3}[\s-]?\d{4}[\s-]?\d{4}\b/g },
    { kind: "phone", re: /(?:\+91[\s-]?|\b0)?\b[6-9]\d{4}[\s-]?\d{5}\b/g },
    { kind: "uhid", re: /\b(?:uhid|mrd|mrn|ip|op|cr|reg(?:istration)?|hospital|hosp|patient)\s*(?:no\.?|number|num|id|#)?\s*[:.#-]?\s*[A-Za-z]{0,4}[\/-]?\d[\dA-Za-z\/-]{3,}\b/gi },
    { kind: "pin", re: /\b(?:pin(?:\s*code)?|pincode|postal code)\s*[:.-]?\s*[1-9]\d{2}\s?\d{3}\b/gi }
  ];

  var DROP_FIELDS = {
    name: "name", patientName: "name", uhid: "hospital number", hospitalNumber: "hospital number",
    mrd: "hospital number", ipNumber: "hospital number", address: "address", phone: "phone number",
    mobile: "phone number", email: "email", aadhaar: "Aadhaar number"
  };

  var SECTIONS = [
    ["presenting", "Presenting complaint"],
    ["history", "History"],
    ["examination", "Examination"],
    ["diagnosis", "Diagnosis"],
    ["treatment", "Treatment"],
    ["outcome", "Outcome and follow-up"],
    ["novelty", "What is new or unusual"]
  ];

  function str(v) { return v == null ? "" : String(v); }
  function clean(s) { return str(s).replace(/^\s+|\s+$/g, ""); }

  function scan(text) {
    var s = str(text), out = [], seen = {}, i, m, re, key;
    for (i = 0; i < PATTERNS.length; i++) {
      re = new RegExp(PATTERNS[i].re.source, "g" + (PATTERNS[i].re.ignoreCase ? "i" : ""));
      while ((m = re.exec(s)) !== null) {
        key = m.index + ":" + m[0].length;
        var overlap = false;
        for (var k in seen) {
          if (!seen.hasOwnProperty(k)) continue;
          var a = seen[k];
          if (m.index < a[1] && m.index + m[0].length > a[0]) { overlap = true; break; }
        }
        if (!overlap) {
          seen[key] = [m.index, m.index + m[0].length];
          out.push({ kind: PATTERNS[i].kind, match: m[0], index: m.index });
        }
        if (m[0].length === 0) re.lastIndex++;
      }
    }
    out.sort(function (x, y) { return x.index - y.index; });
    for (i = 0; i < out.length; i++) delete out[i].index;
    return out;
  }

  /* Parse a date the case file form saves: yyyy-mm-dd (input type=date), dd/mm/yyyy or dd-mm-yyyy. */
  function parseDay(v) {
    var s = clean(v), m, y, mo, d;
    if (!s) return null;
    m = /^(\d{4})-(\d{1,2})-(\d{1,2})$/.exec(s);
    if (m) { y = +m[1]; mo = +m[2] - 1; d = +m[3]; }
    else {
      m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(s);
      if (m) { d = +m[1]; mo = +m[2] - 1; y = +m[3]; }
      else {
        m = new RegExp("^(\\d{1,2})\\s+(" + MONTHS + ")\\.?,?\\s+(\\d{4})$", "i").exec(s);
        if (!m) return null;
        d = +m[1]; mo = MONTH_INDEX[m[2].slice(0, 3).toLowerCase()]; y = +m[3];
      }
    }
    if (mo < 0 || mo > 11 || d < 1 || d > 31) return null;
    var t = Date.UTC(y, mo, d);
    var back = new Date(t);
    if (back.getUTCDate() !== d) return null;
    return Math.round(t / 86400000);
  }

  function dayLabel(n) { return "Day " + n; }

  /* Timeline (CARE): dated entries sorted, Day 0 = first presentation date (or the earliest date). */
  function timeline(casefile) {
    var cf = casefile || {}, items = [], i, base, d, inv = cf.investigations || [], ev = cf.events || [];
    var day0 = parseDay(cf.presentationDate);
    for (i = 0; i < inv.length; i++) {
      d = parseDay(inv[i] && inv[i].date);
      if (d !== null) items.push({ day: d, text: [clean(inv[i].test), clean(inv[i].value), clean(inv[i].unit)].join(" ").replace(/\s+/g, " ").replace(/\s+$/, "") });
    }
    for (i = 0; i < ev.length; i++) {
      d = parseDay(ev[i] && ev[i].date);
      if (d !== null) items.push({ day: d, text: clean(ev[i].text) });
    }
    base = day0;
    if (base === null) {
      for (i = 0; i < items.length; i++) if (base === null || items[i].day < base) base = items[i].day;
    }
    var out = [];
    for (i = 0; i < items.length; i++) out.push({ day: items[i].day - base, label: dayLabel(items[i].day - base), text: items[i].text });
    out.sort(function (a, b) { return a.day - b.day; });
    return { day0Known: day0 !== null, rows: out };
  }

  function ageText(age) {
    var n = parseFloat(str(age));
    if (!isFinite(n)) return clean(age);
    if (n >= 90) return "90 or older";
    return String(n);
  }

  function prepareCaseText(casefile) {
    var cf = casefile || {}, removed = [], lines = [], i, k, inv, tl, findings = [], hits;
    for (k in DROP_FIELDS) {
      if (DROP_FIELDS.hasOwnProperty(k) && cf.hasOwnProperty(k) && clean(cf[k])) removed.push({ field: k, reason: DROP_FIELDS[k] + " never leaves the phone" });
    }
    var who = [];
    if (clean(cf.age)) who.push(ageText(cf.age) + (ageText(cf.age) === "90 or older" ? "" : " years"));
    if (clean(cf.sex)) who.push(clean(cf.sex));
    if (who.length) lines.push("Age and sex: " + who.join(", "));
    if (parseFloat(str(cf.age)) >= 90) removed.push({ field: "age", reason: "age 90 or more is shown as 90 or older" });
    for (i = 0; i < SECTIONS.length; i++) {
      if (clean(cf[SECTIONS[i][0]])) lines.push(SECTIONS[i][1] + ": " + clean(cf[SECTIONS[i][0]]));
    }
    tl = timeline(cf);
    inv = cf.investigations || [];
    var undated = [];
    for (i = 0; i < inv.length; i++) {
      if (inv[i] && parseDay(inv[i].date) === null && clean(inv[i].test)) {
        undated.push([clean(inv[i].test), clean(inv[i].value), clean(inv[i].unit)].join(" ").replace(/\s+/g, " ").replace(/\s+$/, ""));
      }
    }
    if (tl.rows.length) {
      lines.push("Timeline:");
      for (i = 0; i < tl.rows.length; i++) lines.push(tl.rows[i].label + ": " + tl.rows[i].text);
      removed.push({ field: "dates", reason: "exact dates shown as Day N" });
    }
    if (undated.length) lines.push("Investigations: " + undated.join("; "));
    var text = lines.join("\n");
    hits = scan(text);
    for (i = 0; i < hits.length; i++) findings.push(hits[i].kind + ": " + hits[i].match);
    return { text: text, removed: removed, blocked: hits.length > 0, findings: findings };
  }

  function numbersIn(text) {
    var s = str(text).replace(/(\d),(?=\d)/g, "$1");
    var m = s.match(/\d+(?:\.\d+)?/g) || [];
    var out = [], i, v;
    for (i = 0; i < m.length; i++) {
      v = m[i].indexOf(".") >= 0 ? m[i].replace(/0+$/, "").replace(/\.$/, "") : m[i];
      v = v.replace(/^0+(?=\d)/, "");
      out.push(v);
    }
    return out;
  }

  function numbersNotIn(draftText, sourceText) {
    var src = numbersIn(sourceText), have = {}, out = [], seen = {}, d, i;
    for (i = 0; i < src.length; i++) have[src[i]] = 1;
    d = numbersIn(draftText);
    for (i = 0; i < d.length; i++) {
      if (!have[d[i]] && !seen[d[i]]) { seen[d[i]] = 1; out.push(d[i]); }
    }
    return out;
  }

  var RMDPhi = {
    scan: scan,
    prepareCaseText: prepareCaseText,
    numbersNotIn: numbersNotIn,
    timeline: timeline,
    parseDay: parseDay
  };

  if (typeof module !== "undefined" && module.exports) { module.exports = RMDPhi; }
  if (G) { G.RMDPhi = RMDPhi; }

})(typeof window !== "undefined" ? window : undefined);
