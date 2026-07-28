/* FollowCare AI — Recovery Engine (DETERMINISTIC, offline, no network, no PHI, no LLM)
 *
 * Owns every clinical decision (StewardMD safety invariant): given a disease pathway + the patient's
 * answers (+ optional history), it computes the AUTHORITATIVE recovery assessment — score, red flags,
 * escalation LEVEL, readmission risk, trend, and a Confidence score — with transparent reasons. The LLM
 * may later PHRASE/translate this, but must NEVER change it. Rules live in the pathway DATA; this engine
 * interprets them (no per-disease branching) ⇒ generic + unit-testable.
 *
 * SAFETY DESIGN (hardened after adversarial review):
 *  - Numeric answers are parsed robustly ("88%","2.5 kg","180/100" → 88/2.5/180); a present-but-unparseable
 *    answer on a red-flag rule is treated as INVALID (never silently "no flag"): it blocks Green + flags review.
 *  - yes/no & choice answers are trimmed/normalized; unknown answers on a hard-red probe route to review.
 *  - Missing values never fire a false flag and never leave a false Green (they lower confidence + block Green).
 *  - Graded deterioration (soft bands + scale/choice) lowers the score before hard cutoffs.
 *
 * assess(pathwayId, answers, opts) -> { recoveryScore(0..100), confidence, trend, escalation, escalationRank,
 *   readmissionRisk, redFlags:[{questionId,level,reason}], needsReview(bool), invalidInputs:[qId],
 *   reasons:[str], missing:[qId], complete } | null
 * assessMissed(pathwayId, missedCount) -> { escalation, reason }
 * isRecovered(pathwayId, latest, dayOffset, opts) -> bool
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var RANK = { green: 0, yellow: 1, orange: 2, red: 3 };
  var YES = { yes: 1, y: 1, "true": 1, "1": 1 }, NO = { no: 1, n: 1, "false": 1, "0": 1 };

  function norm(v) { return String(v == null ? "" : v).trim().toLowerCase(); }
  function present(v) { return !(v == null || String(v).trim() === ""); }
  // Deterministic numeric extraction. null = missing/blank; NaN = present-but-unparseable (INVALID); else number.
  function parseNum(v) {
    if (v == null) return null;
    if (typeof v === "number") return isFinite(v) ? v : NaN;
    if (Array.isArray(v)) return NaN;                       // non-scalar → invalid
    var s = String(v).trim(); if (s === "") return null;
    var m = s.match(/-?\d+(?:\.\d+)?/); if (!m) return NaN; // present but no number → invalid
    return parseFloat(m[0]);
  }
  // triggers → true | false | "invalid"
  function triggers(when, v) {
    if (!present(v)) return false;                          // missing → not triggered (confidence handles it)
    var s = norm(v), m;
    if (when === "yes") { return YES[s] ? true : NO[s] ? false : "invalid"; }
    if (when === "no") { return NO[s] ? true : YES[s] ? false : "invalid"; }
    if (when === "worse") return s === "worse";
    if ((m = when.match(/^>=(-?\d+(?:\.\d+)?)$/))) { var n = parseNum(v); if (n === null) return false; if (!isFinite(n)) return "invalid"; return n >= Number(m[1]); }
    if ((m = when.match(/^<=(-?\d+(?:\.\d+)?)$/))) { var n2 = parseNum(v); if (n2 === null) return false; if (!isFinite(n2)) return "invalid"; return n2 <= Number(m[1]); }
    if ((m = when.match(/^==(.+)$/))) return s === m[1].trim().toLowerCase();
    if ((m = when.match(/^in:\[(.+)\]$/))) return m[1].split(",").map(function (x) { return x.trim().toLowerCase(); }).indexOf(s) >= 0;
    return false;
  }
  function rulesOf(q) { return q.redFlags ? q.redFlags : (q.redFlag ? [q.redFlag] : []); }
  function maxLevel(a, b) { if (!a) return b; if (!b) return a; return RANK[a] >= RANK[b] ? a : b; }

  // Per-question evaluation → { level, invalid, reason, pen, soft }
  function evalQ(q, val, prevVal) {
    var rules = rulesOf(q), level = null, invalid = false, reason = null;
    // Plausibility guard: a present numeric outside physiological bounds is INVALID (typo / "no reading"),
    // never a real flag — e.g. SpO₂ 0 must NOT fire "Low SpO₂". Routes to review + blocks Green.
    if (q.plausible && present(val)) { var pv = parseNum(val); if (isFinite(pv) && (pv < q.plausible[0] || pv > q.plausible[1])) return { level: null, invalid: true, reason: null, pen: 0, soft: false }; }
    for (var i = 0; i < rules.length; i++) {
      var t = triggers(rules[i].when, val);
      if (t === "invalid") invalid = true;
      else if (t === true) { if (!level || RANK[rules[i].level] > RANK[level]) { level = maxLevel(level, rules[i].level); reason = rules[i].reason; } }
    }
    var w = q.weight || 0, pen = 0, soft = false;
    if (level) pen = w;                                     // a triggered red flag → full penalty
    else if (present(val)) {
      if (q.type === "overall") { var s = norm(val); pen = s === "worse" ? w : (s === "same" ? 0.4 * w : 0); soft = (s === "same"); }
      else if (q.type === "scale") { var n = parseNum(val); if (isFinite(n)) { pen = w * Math.max(0, Math.min(1, n / 3)); soft = n >= 2; } }
      else {
        var num = parseNum(val);
        if (isFinite(num)) for (var j = 0; j < rules.length; j++) {          // soft band near a numeric threshold
          var mm;
          if ((mm = rules[j].when.match(/^<=(-?\d+(?:\.\d+)?)$/))) { var T = Number(mm[1]); if (num > T && num <= T * 1.06) { pen = Math.max(pen, 0.5 * w); soft = true; } }
          if ((mm = rules[j].when.match(/^>=(-?\d+(?:\.\d+)?)$/))) { var T2 = Number(mm[1]); if (num < T2 && num >= T2 * 0.92) { pen = Math.max(pen, 0.5 * w); soft = true; } }
        }
        if (q.soft && triggers(q.soft, val) === true) { pen = Math.max(pen, 0.6 * w); soft = true; }   // explicit soft deterioration (data)
      }
      // per-signal worsening vs previous (direction from data: worseDir 'down'|'up')
      if (q.worseDir && present(prevVal)) { var a = parseNum(val), b = parseNum(prevVal); if (isFinite(a) && isFinite(b)) { var worse = q.worseDir === "down" ? (a < b - (q.worseDelta || 3)) : (a > b + (q.worseDelta || 3)); if (worse) { pen = Math.max(pen, 0.5 * w); soft = true; } } }
    }
    return { level: level, invalid: invalid, reason: reason, pen: pen, soft: soft };
  }

  function assess(pathwayId, answers, opts) {
    opts = opts || {};
    var PW = opts.pathways || G.FollowCarePathways; if (!PW) return null;
    var pw = PW.get(pathwayId); if (!pw) return null;
    answers = answers || {}; var prev = opts.previousAnswers || {};
    var questions = PW.questionsFor(pathwayId);

    var redFlags = [], penaltySum = 0, worse = false, softCount = 0, invalidInputs = [], invalidCritical = false;
    for (var i = 0; i < questions.length; i++) {
      var q = questions[i], val = answers[q.id], e = evalQ(q, val, prev[q.id]);
      if (e.level) redFlags.push({ questionId: q.id, level: e.level, reason: e.reason });
      if (e.invalid) { invalidInputs.push(q.id); if (rulesOf(q).some(function (r) { return r.level === "red"; })) invalidCritical = true; }
      penaltySum += e.pen; if (e.soft) softCount++;
      if (q.type === "overall" && norm(val) === "worse") worse = true;
    }
    var recoveryScore = Math.max(0, Math.min(100, Math.round(100 - penaltySum)));
    var hasRed = redFlags.some(function (f) { return f.level === "red"; });
    var hasOrange = redFlags.some(function (f) { return f.level === "orange"; });

    // ---- confidence ----
    var inputs = pw.recoveryInputs || [];
    var missing = inputs.filter(function (id) { return !present(answers[id]); });
    var missingRatio = inputs.length ? missing.length / inputs.length : 0;
    // unanswered global hard-red probes + missing critical vital both undermine confidence
    var globalUnanswered = (PW.GLOBAL_RED || []).filter(function (g) { return !present(answers[g.id]); }).length;
    var criticalMissing = (pw.blockGreenIfMissing || []).filter(function (id) { return !present(answers[id]); });
    var overallVal = norm(answers.overall);
    var inconsistent = (overallVal === "better" && (hasRed || hasOrange)) ||
      (overallVal === "worse" && recoveryScore >= 75 && !hasRed && !hasOrange);
    var confidence = "high";
    if (missingRatio >= 0.5 || inconsistent || invalidInputs.length || globalUnanswered >= (PW.GLOBAL_RED || []).length) confidence = "low";
    else if (missingRatio > 0 || criticalMissing.length || globalUnanswered > 0) confidence = "medium";

    // ---- trend ----
    var prevScore = (typeof opts.previousScore === "number") ? opts.previousScore
      : (Array.isArray(opts.history) && opts.history.length ? opts.history[opts.history.length - 1] : null);
    var trend = "baseline";
    if (typeof prevScore === "number") { var d = recoveryScore - prevScore; trend = d <= -15 ? "critical" : d <= -5 ? "declining" : d >= 5 ? "improving" : "stable"; }

    // ---- escalation (deterministic) ----
    var level = "green";
    if (hasRed) level = "red";
    else if (hasOrange) level = "orange";
    else if (recoveryScore < 60 || worse || trend === "declining" || trend === "critical" || softCount >= 2) level = "yellow";
    if (trend === "declining" || trend === "critical") level = bump(level);   // worsening trend bumps one step
    // never leave a false Green / must-review when data is uncertain or a critical numeric is unparseable/missing
    if (invalidCritical) level = maxByRank(level, "orange");
    if (level === "green" && (confidence === "low" || criticalMissing.length)) level = "yellow";

    var needsReview = invalidCritical || (confidence === "low");

    // ---- readmission risk ----
    var risk = "low";
    if (hasRed) risk = "very_high";
    else if (hasOrange && recoveryScore < 60) risk = "high";
    else if (hasOrange || recoveryScore < 55 || trend === "critical" || softCount >= 2) risk = "moderate";

    // ---- reasons ----
    var reasons = [];
    redFlags.forEach(function (f) { if (reasons.indexOf(f.reason) < 0) reasons.push(f.reason); });
    if (worse) reasons.push("Patient reports feeling worse");
    if (recoveryScore < 60) reasons.push("Low recovery score (" + recoveryScore + ")");
    if (trend === "declining" || trend === "critical") reasons.push("Recovery trend " + trend + (typeof prevScore === "number" ? " (" + prevScore + "→" + recoveryScore + ")" : ""));
    if (invalidInputs.length) reasons.push("Unreadable answer(s): " + invalidInputs.join(", ") + " — needs review");
    if (criticalMissing.length) reasons.push("Missing key measurement: " + criticalMissing.join(", "));
    if (confidence === "low" && inconsistent) reasons.push("Inconsistent answers — needs review");

    return {
      pathwayId: pathwayId, recoveryScore: recoveryScore, confidence: confidence, trend: trend,
      escalation: level, escalationRank: RANK[level], readmissionRisk: risk, redFlags: redFlags,
      needsReview: needsReview, invalidInputs: invalidInputs, reasons: reasons, missing: missing,
      complete: missing.length === 0 && invalidInputs.length === 0
    };
  }
  function bump(l) { var order = ["green", "yellow", "orange", "red"]; return order[Math.min(3, RANK[l] + 1)]; }
  function maxByRank(a, b) { return RANK[a] >= RANK[b] ? a : b; }

  // Missed / overdue check-in (non-response must never leave risk at its prior level).
  function assessMissed(pathwayId, missedCount) {
    missedCount = missedCount || 0;
    if (missedCount >= 3) return { escalation: "orange", reason: "3+ missed assessments — clinician review" };
    if (missedCount >= 1) return { escalation: "yellow", reason: "Missed scheduled assessment — reminder" };
    return { escalation: "green", reason: "" };
  }

  // Completion — enforces ALL declared criteria; fails CLOSED when a criterion can't be evaluated.
  function isRecovered(pathwayId, latest, dayOffset, opts) {
    var PW = (opts && opts.pathways) || G.FollowCarePathways;
    var pw = PW && PW.get(pathwayId); if (!pw || !latest) return false;
    var c = pw.completion || {};
    if (latest.escalation !== "green") return false;
    if (typeof c.minScore === "number" && latest.recoveryScore < c.minScore) return false;
    if (c.byDay && dayOffset != null && dayOffset < c.byDay) return false;
    if (c.needImproving && !(latest.trend === "improving" || latest.trend === "stable")) return false;   // declining/critical/baseline → not recovered
    if (c.needAfebrile) {
      var fa = opts && opts.answers ? opts.answers : null;                     // require an explicit afebrile signal
      if (!fa || !present(fa.fever) || triggers("yes", fa.fever) !== false) return false;
    }
    return true;
  }

  var API = { assess: assess, assessMissed: assessMissed, isRecovered: isRecovered, _triggers: triggers, _parseNum: parseNum, _version: 2 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareEngine = API;
})();
