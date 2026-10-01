/* clinical-params.js — shared patient-parameter parser with evidence records (StewardMD Edge, Wave 0).
 * ---------------------------------------------------------------------------
 * One deterministic parser for the numbers a clinician types ("crcl 72F 58 kg creat 1.4",
 * "CURB65 78 confused RR 32 BP 88/50 urea 9", "creatinine was 1.4 last month, now 2.1").
 * Every value comes back as an EVIDENCE RECORD (vault/plans/Edge-Master-Plan.md section 2.1):
 *
 *   { field, value, unit, span:[start,end], source_text, time_context:"current"|"past"|"unknown",
 *     assertion:"present"|"absent"|"historical"|"family"|"planned"|"stopped"|"unknown",
 *     extractor:"rules", schema_version, patient_session_id, request_id }
 *
 * Rules that make it safe to prefill a calculator (Edge-Master-Plan safety rules S2, S5 to S8):
 *   - A number belongs to a field only when the NEAREST label before it (or the unit right after
 *     it) is that field's, with no other number in between ("age 72 wt 58" gives weight 58).
 *   - Only assertion "present" + time "current" values are usable(); everything else is context.
 *   - Two different current values for one field = ambiguous: nothing is filled for that field.
 *   - Missing is not negative: a boolean is only "absent" when the text says so ("no confusion").
 *   - Out-of-range or unit-ambiguous values are rejected (listed in `rejected`), never guessed.
 *   - Pure function, fresh result per call: nothing carries over between requests.
 *
 * API: SMD_CPARAMS.parse(text, { patient_session_id, request_id }) ->
 *        { records:[...], usable:{ field: record }, ambiguous:[field], rejected:[{field,raw,reason}] }
 *      SMD_CPARAMS.validateSlot(text, field, value) -> boolean  (Appendix C label check)
 *      SMD_CPARAMS.FIELDS, SMD_CPARAMS.SCHEMA_VERSION
 * window.SMD_CPARAMS + module.exports. ES5, no build step.
 */
(function (root) {
  "use strict";

  var SCHEMA_VERSION = "cparams-1";

  // field -> labels (words BEFORE the number), units (words AFTER the number), bounds, canonical unit
  var FIELDS = {
    age_years:   { labels: ["age", "aged"], units: ["yo", "y/o", "yr", "yrs", "year", "years"], bounds: [0, 120], unit: "years" },
    weight_kg:   { labels: ["wt", "weight", "weighs", "weighing"], units: ["kg", "kgs", "kilo", "kilos", "kilogram", "kilograms"], bounds: [0.3, 350], unit: "kg" },
    height_cm:   { labels: ["ht", "height"], units: ["cm", "cms"], bounds: [30, 250], unit: "cm" },
    scr_mg_dl:   { labels: ["cr", "scr", "s.cr", "creat", "creatinine", "s.creat", "serum creatinine"], units: ["mg/dl"], bounds: [0.1, 25], unit: "mg/dL" },
    urea_mmol_l: { labels: ["urea"], units: [], bounds: [0.5, 100], unit: "mmol/L" },
    bun_mg_dl:   { labels: ["bun"], units: [], bounds: [1, 300], unit: "mg/dL" },
    sodium:      { labels: ["na", "sodium", "s.na"], units: ["meq/l", "mmol/l"], bounds: [90, 200], unit: "mmol/L" },
    potassium:   { labels: ["k", "potassium", "s.k"], units: ["meq/l"], bounds: [1, 10], unit: "mmol/L" },
    chloride:    { labels: ["cl", "chloride"], units: [], bounds: [50, 150], unit: "mmol/L" },
    bicarbonate: { labels: ["hco3", "bicarb", "bicarbonate"], units: [], bounds: [1, 60], unit: "mmol/L" },
    glucose_mg_dl: { labels: ["sugar", "glucose", "grbs", "rbs", "fbs", "cbg", "blood sugar"], units: ["mg/dl"], bounds: [20, 1500], unit: "mg/dL" },
    albumin_g_dl: { labels: ["alb", "albumin"], units: ["g/dl"], bounds: [0.5, 7], unit: "g/dL" },
    bilirubin_mg_dl: { labels: ["bili", "bilirubin", "tbil", "t.bil"], units: [], bounds: [0.1, 60], unit: "mg/dL" },
    inr:         { labels: ["inr"], units: [], bounds: [0.5, 15], unit: "" },
    calcium_mg_dl: { labels: ["ca", "calcium"], units: [], bounds: [3, 20], unit: "mg/dL" },
    hb_g_dl:     { labels: ["hb", "hgb", "haemoglobin", "hemoglobin"], units: ["g/dl", "gm%"], bounds: [2, 25], unit: "g/dL" },
    hr:          { labels: ["hr", "pulse", "pr", "heart rate"], units: ["bpm", "/min"], bounds: [20, 250], unit: "/min" },
    rr:          { labels: ["rr", "resp rate", "respiratory rate"], units: [], bounds: [4, 80], unit: "/min" },
    spo2:        { labels: ["spo2", "sp02", "sats", "sat", "saturation", "o2 sat"], units: ["%"], bounds: [40, 100], unit: "%" },
    temp_c:      { labels: ["temp", "temperature", "t"], units: ["c", "f", "°c", "°f"], bounds: [30, 45], unit: "°C" },
    sbp:         { labels: [], units: [], bounds: [40, 300], unit: "mmHg" },
    dbp:         { labels: [], units: [], bounds: [20, 200], unit: "mmHg" },
    gcs:         { labels: ["gcs"], units: [], bounds: [3, 15], unit: "" }
  };
  // Booleans with explicit present/absent wording only (S6: silence stays unknown).
  var BOOLEANS = {
    confusion: { present: /\b(confused|confusion|disoriented|disorientation|altered (?:sensorium|mental status|mentation))\b/,
                 absent: /\b(no confusion|not confused|oriented|well oriented|alert and oriented|conscious and oriented)\b/ },
    penicillin_allergy: { present: /\b(pen(?:icillin)?\s*allerg\w*|allerg\w* to pen(?:icillin)?\w*|pcn allerg\w*)\b/,
                 absent: /\b(no (?:known )?(?:drug )?allerg\w*|nkda|nkfda)\b/ }
  };
  var SEX_WORDS = { male: /\b(male|man|gentleman|boy|mr)\b/, female: /\b(female|woman|lady|girl|mrs|ms)\b/ };

  // ---- clause context: assertion + time -------------------------------------------------------
  var FAMILY = /\b(mother|father|mom|dad|brother|sister|son|daughter|wife|husband|family history|fh of|grandmother|grandfather|uncle|aunt)\b/;
  var STOPPED = /\b(stopped|discontinued|stop|held|withheld)\b/;
  var PLANNED = /\b(plan|planned|will give|to give|start|starting|target|aim|goal)\b/;
  var NEGATED = /(^|[^a-z])(no|not|without|denies|denied|absent|negative for)([^a-z]|$)/;
  var PAST = /\b(was|were|had been|previous(?:ly)?|prior|last (?:week|month|year|visit|time|night)|yesterday|days? ago|weeks? ago|months? ago|years? ago|before|earlier|on admission|at home|home reading|usually|normally|used to)\b/;
  var NOW = /\b(now|currently|current|today|at present|presently|this morning|on examination|o\/e)\b/;
  var FIRST_PERSON_READING = /\b(my|our)\s+(?:\w+\s+){0,2}?(bp|pressure|sugar|sugars|glucose|pulse|temperature|temp|weight|sats?|saturation|reading|readings)\b/;

  function clausesOf(text) {
    // returns [{start,end,text}] on the ORIGINAL text; "now" starts a new clause ("was 1.4, now 2.1")
    var out = [], re = /[.?!](?=\s|$)|[;\n]+|,(?=\s)|\s+but\s+|\s+(?=(?:now|currently|today)\b)/gi, last = 0, m;
    while ((m = re.exec(text))) {
      if (m.index > last) out.push({ start: last, end: m.index });
      last = m.index + m[0].length;
      if (m[0].length === 0) re.lastIndex++;
    }
    if (last < text.length) out.push({ start: last, end: text.length });
    return out.map(function (c) { return { start: c.start, end: c.end, text: text.slice(c.start, c.end).toLowerCase() }; });
  }
  function contextOf(clause) {
    var t = clause.text, assertion = "present", time = "current";
    if (FAMILY.test(t)) assertion = "family";
    else if (STOPPED.test(t)) assertion = "stopped";
    else if (PLANNED.test(t)) assertion = "planned";
    if (FIRST_PERSON_READING.test(t)) { time = "past"; assertion = assertion === "present" ? "historical" : assertion; }
    else if (PAST.test(t) && !NOW.test(t)) { time = "past"; if (assertion === "present") assertion = "historical"; }
    return { assertion: assertion, time_context: time };
  }
  function clauseAt(clauses, pos) {
    for (var i = 0; i < clauses.length; i++) if (pos >= clauses[i].start && pos < clauses[i].end) return clauses[i];
    return { start: pos, end: pos, text: "" };
  }

  // ---- tokenizer (positions on the original text) --------------------------------------------
  // Number, or a word (letters plus . / % °), or a known alphanumeric label (spo2, hco3, s.cr).
  var TOKEN_RE = /spo2|sp02|hco3|s\.cr|s\.creat|t\.bil|o2 sat|\d+(?:\.\d+)?|[a-z°%µμ][a-z.\/%°µμ]*/g;
  var MULTI_LABELS = ["serum creatinine", "blood sugar", "heart rate", "resp rate", "respiratory rate", "o2 sat"];
  function tokenize(low) {
    var out = [], m, re = new RegExp(TOKEN_RE.source, "g");
    // multi-word labels are matched first and emitted as single tokens
    var spans = [];
    MULTI_LABELS.forEach(function (lab) {
      var i = -1; while ((i = low.indexOf(lab, i + 1)) >= 0) spans.push({ s: lab, start: i, end: i + lab.length, num: null });
    });
    while ((m = re.exec(low))) {
      var st = m.index, en = st + m[0].length, inside = false;
      for (var j = 0; j < spans.length; j++) if (st >= spans[j].start && st < spans[j].end) { inside = true; break; }
      if (inside) continue;
      var s = m[0].replace(/[.\/]+$/, "");
      out.push({ s: s, start: st, end: st + s.length, num: /^\d/.test(s) ? parseFloat(s) : null });
    }
    return out.concat(spans).sort(function (a, b) { return a.start - b.start; });
  }

  function fieldByLabel(word) {
    for (var f in FIELDS) if (FIELDS[f].labels.indexOf(word) >= 0) return f;
    return null;
  }
  // A unit attributes a number only when exactly one field uses it ("kg", "cm", "yo"). Shared units
  // ("mmol/l", "mg/dl") never decide the field on their own.
  function fieldByUnit(word) {
    var hit = null;
    for (var f in FIELDS) if (FIELDS[f].units.indexOf(word) >= 0) { if (hit) return null; hit = f; }
    return hit;
  }
  // Nearest attribution: unit directly after (up to 1 word gap), else label directly before
  // (up to 1 filler word: "is", "of", "was", "="). Another number in between stops the search.
  var FILLER = { is: 1, of: 1, was: 1, were: 1, "=": 1, ":": 1, at: 1, about: 1, around: 1, approx: 1, now: 1, today: 1 };
  // A label before the number is more specific than a unit after it, so it wins ("sugar 12 mmol").
  function attribute(tok, i) {
    var k, j, f;
    for (k = 1; k <= 3; k++) {
      j = i - k; if (j < 0 || tok[j].num !== null) break;
      f = fieldByLabel(tok[j].s); if (f) return { field: f, labelTok: tok[j] };
      if (!FILLER[tok[j].s]) break;
    }
    for (k = 1; k <= 2; k++) {
      j = i + k; if (j >= tok.length || tok[j].num !== null) break;
      f = fieldByUnit(tok[j].s); if (f) return { field: f, unitTok: tok[j] };
      if (!FILLER[tok[j].s]) break;
    }
    return null;
  }

  function within(field, v) { var b = FIELDS[field].bounds; return v >= b[0] && v <= b[1]; }
  function round(v, d) { var p = Math.pow(10, d); return Math.round(v * p) / p; }

  // Unit conversion to the canonical unit; returns { value, unit } or { reason } when ambiguous.
  function canon(field, v, unitWord, ctxText) {
    if (field === "scr_mg_dl") {
      if (/µmol|umol|μmol/.test(unitWord || "") || /\b(µmol|umol|μmol)\b/.test(ctxText)) return { value: round(v / 88.4, 2), unit: "mg/dL", converted: "µmol/L" };
      if (v > 25) return { reason: "creatinine above 25 without a unit (µmol/L?)" };
    }
    if (field === "glucose_mg_dl") {
      if (/mmol/.test(unitWord || "") || /\bmmol\b/.test(ctxText)) return { value: Math.round(v * 18), unit: "mg/dL", converted: "mmol/L" };
      if (v < 35) return { reason: "glucose below 35 without a unit (mmol/L?)" };
    }
    if (field === "temp_c") {
      var u = unitWord || "";
      if (/f/.test(u) || (!/c/.test(u) && v >= 90 && v <= 113)) return { value: round((v - 32) * 5 / 9, 1), unit: "°C", converted: "°F" };
    }
    if (field === "weight_kg" && /lb/.test(unitWord || "")) return { value: round(v * 0.4536, 1), unit: "kg", converted: "lb" };
    return { value: v, unit: FIELDS[field].unit };
  }

  function wordsToNumbers(t) {
    var VV = (root && root.SMD_VVITALS) || tryReq("./voice-vitals.js");
    return (VV && VV.wordsToNumbers) ? VV.wordsToNumbers(t) : t;
  }
  function tryReq(p) { try { return typeof require !== "undefined" ? require(p) : null; } catch (e) { return null; } }

  function parse(text, opts) {
    opts = opts || {};
    // Spoken numbers to digits first ("pulse one ten"). The record keeps the converted text so
    // spans stay consistent with source_text.
    var src = String(text == null ? "" : text);
    var spoken = /\b(one|two|three|four|five|six|seven|eight|nine|ten|eleven|twelve|twenty|thirty|forty|fifty|sixty|seventy|eighty|ninety|hundred)\b/i.test(src);
    if (spoken) src = wordsToNumbers(src);
    var low = src.toLowerCase();
    var clauses = clausesOf(src);
    var records = [], rejected = [], taken = {};

    function rec(field, value, unit, start, end, ctx, extra) {
      var r = { field: field, value: value, unit: unit, span: [start, end], source_text: src.slice(start, end),
        time_context: ctx.time_context, assertion: ctx.assertion, extractor: "rules", schema_version: SCHEMA_VERSION,
        patient_session_id: opts.patient_session_id || null, request_id: opts.request_id || null };
      if (extra) for (var k in extra) r[k] = extra[k];
      records.push(r);
    }
    function mark(start, end) { for (var i = start; i < end; i++) taken[i] = 1; }
    function isTaken(start) { return !!taken[start]; }

    // 1. Composite patterns first: BP "120/80", "120 by 80", "120 over 80".
    var m, re = /\b(?:bp|blood pressure|b\.p)\b\s*(?:is|of|was|=|:)?\s*(\d{2,3})\s*(?:\/|by|over)\s*(\d{2,3})/g;
    while ((m = re.exec(low))) {
      var s1 = parseFloat(m[1]), d1 = parseFloat(m[2]), ctx = contextOf(clauseAt(clauses, m.index));
      if (within("sbp", s1) && within("dbp", d1) && s1 > d1) {
        rec("sbp", s1, "mmHg", m.index, m.index + m[0].length, ctx);
        rec("dbp", d1, "mmHg", m.index, m.index + m[0].length, ctx);
      } else rejected.push({ field: "bp", raw: m[0], reason: "out of range or systolic not above diastolic" });
      mark(m.index, m.index + m[0].length);
    }
    // GCS components "E2V3M5" / "e2 v3 m5".
    re = /\be\s*([1-4])\s*v\s*([1-5])\s*m\s*([1-6])\b/g;
    while ((m = re.exec(low))) {
      var tot = parseInt(m[1], 10) + parseInt(m[2], 10) + parseInt(m[3], 10);
      rec("gcs", tot, "", m.index, m.index + m[0].length, contextOf(clauseAt(clauses, m.index)),
        { components: { eye: +m[1], verbal: +m[2], motor: +m[3] } });
      mark(m.index, m.index + m[0].length);
    }
    // Compact age+sex "72F", "65m", "72 yo M", and "72 year old".
    re = /\b(\d{1,3})\s?(m|f)\b(?![a-z\/])/g;
    while ((m = re.exec(low))) {
      if (isTaken(m.index)) continue;
      var a = parseFloat(m[1]);
      var before = low.slice(Math.max(0, m.index - 14), m.index);
      if (/\b(temp|temperature|t)\s*$/.test(before)) continue;           // "temp 101f" is a temperature
      if (/\d\s*$/.test(before) || /[.\d]$/.test(before)) continue;
      if (/^\d{1,3}\s?m\b/.test(m[0]) && /^\s*(?:in|of|from)\b/.test(low.slice(m.index + m[0].length))) continue;
      if (a >= 93 && a <= 113 && m[2] === "f") { rejected.push({ field: "age_years", raw: m[0], reason: "could be temperature in °F" }); continue; }
      if (!within("age_years", a)) continue;
      var ctxA = contextOf(clauseAt(clauses, m.index));
      rec("age_years", a, "years", m.index, m.index + m[1].length, ctxA);
      rec("sex", m[2] === "m" ? "male" : "female", "", m.index + m[0].length - 1, m.index + m[0].length, ctxA);
      mark(m.index, m.index + m[0].length);
    }
    re = /\b(\d{1,3})\s*(?:-|\s)?(?:years?|yrs?|yr|y)\s*(?:-|\s)?old\b/g;
    while ((m = re.exec(low))) {
      if (isTaken(m.index)) continue;
      var ag = parseFloat(m[1]);
      if (within("age_years", ag)) { rec("age_years", ag, "years", m.index, m.index + m[1].length, contextOf(clauseAt(clauses, m.index))); mark(m.index, m.index + m[0].length); }
    }

    // 2. Every remaining number: nearest-label attribution.
    var tok = tokenize(low);
    // "creatinine was 1.4 last month, now 2.1": an unlabelled number at the start of a "now" clause
    // takes the field of the labelled value in the clause right before it (same field, new time).
    function carryFromPrevious(t) {
      var cl = clauseAt(clauses, t.start);
      if (!/^\s*(now|currently|today)\b/.test(cl.text)) return null;
      if (!/^\s*(now|currently|today)\s*(?:is|it is|it's|=|:)?\s*$/.test(low.slice(cl.start, t.start))) return null;
      var prev = null;
      for (var q = records.length - 1; q >= 0; q--) if (records[q].span[1] <= cl.start) { prev = records[q]; break; }
      if (!prev || prev.field === "sbp" || prev.field === "dbp" || prev.field === "sex" || typeof prev.value !== "number") return null;
      var pcl = clauseAt(clauses, prev.span[0]);
      if (clauses.indexOf(pcl) !== clauses.indexOf(cl) - 1) return null;
      return { field: prev.field, carried: true };
    }
    for (var i = 0; i < tok.length; i++) {
      var t = tok[i];
      if (t.num === null || isTaken(t.start)) continue;
      var at = attribute(tok, i);
      if (!at) at = carryFromPrevious(t);
      if (!at) continue;
      var field = at.field, ctxN = contextOf(clauseAt(clauses, t.start));
      if (field === "sbp" || field === "dbp") continue;
      var unitWord = at.unitTok ? at.unitTok.s : (i + 1 < tok.length && tok[i + 1].num === null ? tok[i + 1].s : "");
      var c = canon(field, t.num, unitWord, clauseAt(clauses, t.start).text);
      if (c.reason) { rejected.push({ field: field, raw: src.slice(t.start, t.end), reason: c.reason }); continue; }
      if (!within(field, c.value)) { rejected.push({ field: field, raw: src.slice(t.start, t.end), reason: "out of range" }); continue; }
      var startS = at.labelTok ? at.labelTok.start : t.start, endS = at.unitTok ? at.unitTok.end : t.end;
      if (!at.unitTok && i + 1 < tok.length && tok[i + 1].num === null && FIELDS[field].units.indexOf(tok[i + 1].s) >= 0) endS = tok[i + 1].end;
      rec(field, c.value, c.unit, startS, endS, ctxN, c.converted ? { converted_from: c.converted, raw_value: t.num } : null);
      mark(t.start, t.end);
    }

    // 3. Sex words, when no compact form gave one.
    if (!records.some(function (r) { return r.field === "sex"; })) {
      for (var sx in SEX_WORDS) {
        var sm = SEX_WORDS[sx].exec(low);
        if (sm) { rec("sex", sx, "", sm.index, sm.index + sm[0].length, contextOf(clauseAt(clauses, sm.index))); break; }
      }
    }

    // 4. Booleans: explicit wording only. Absent wording wins over a bare present word in its clause.
    for (var b in BOOLEANS) {
      var am = BOOLEANS[b].absent.exec(low), pm = BOOLEANS[b].present.exec(low);
      if (am) rec(b, false, "", am.index, am.index + am[0].length, { assertion: "absent", time_context: "current" });
      else if (pm) {
        var cl = clauseAt(clauses, pm.index), neg = NEGATED.test(cl.text.slice(0, pm.index - cl.start + pm[0].length));
        var ctxB = contextOf(cl);
        rec(b, !neg, "", pm.index, pm.index + pm[0].length, neg ? { assertion: "absent", time_context: ctxB.time_context } : ctxB);
      }
    }

    // 5. Usable values: present + current, one distinct value per field, else ambiguous.
    var usable = {}, ambiguous = [], seen = {};
    records.forEach(function (r) {
      var ok = (r.assertion === "present" && r.time_context === "current") || (r.assertion === "absent" && typeof r.value === "boolean");
      if (!ok) return;
      if (!seen[r.field]) { seen[r.field] = r; return; }
      if (String(seen[r.field].value) !== String(r.value)) seen[r.field] = "AMBIGUOUS";
    });
    for (var fk in seen) {
      if (seen[fk] === "AMBIGUOUS") ambiguous.push(fk);
      else usable[fk] = seen[fk];
    }
    return { records: records, usable: usable, ambiguous: ambiguous, rejected: rejected, text: src, schema_version: SCHEMA_VERSION };
  }

  // Appendix C label check: is there an occurrence of `value` in `text` attributed to `field`?
  function validateSlot(text, field, value) {
    var r = parse(text);
    var v = typeof value === "boolean" ? value : parseFloat(value);
    return r.records.some(function (x) {
      if (x.field !== field) return false;
      if (typeof v === "boolean") return x.value === v;
      return typeof x.value === "number" && Math.abs(x.value - v) < 1e-9;
    });
  }

  // The words left when every attributed value (label + number + unit) is removed: what the
  // request is ABOUT ("crcl 72F 58kg cr 1.4" -> "crcl"). Unattributed numbers stay, so a version
  // like "MELD 3.0" keeps its "3.0".
  function stripValues(text) {
    var r = parse(text), chars = r.text.split("");
    r.records.forEach(function (x) { for (var i = x.span[0]; i < x.span[1]; i++) chars[i] = " "; });
    return chars.join("").replace(/\s+/g, " ").replace(/\s+([,.;:])/g, "$1").replace(/^[\s,.;:]+|[\s,.;:]+$/g, "");
  }

  var API = { parse: parse, validateSlot: validateSlot, stripValues: stripValues, FIELDS: FIELDS, SCHEMA_VERSION: SCHEMA_VERSION, _clausesOf: clausesOf, _version: "1.0" };
  if (root) root.SMD_CPARAMS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
