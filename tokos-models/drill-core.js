/* Tokós branching drills: the shared scorer. ES5, no DOM.
   Browser: window.TOKOS_DRILL_CORE. Node (tests, build): module.exports.
   Content lives in tokos/drill/<id>.json (the reviewable source); tools/tokos-build-drills.mjs wraps each
   file into tokos-models/drill-<id>.js as make(data), so the engine gets {..., stages, score} from one script.

   Rules the scorer applies (the drill's stated checklist is its ideal path):
   - The ideal path starts at stages[0] and follows each stage's correct option (option.next, else the next
     stage in array order). Stages off that path are consequence or remediation branches and are not scored.
   - Only the FIRST answer given for a stage counts; a remediation loop lets the learner recover but not re-score.
   - A stage whose correct option is critical is a critical step. It is missed when it is answered wrongly,
     never answered (skipped by a branch or the attempt ended), or answered after its timeSec budget.
   - timeSec is the budget for that decision. A choice carries spentSec (time on that stage's own clock, which
     starts when the stage opens, so reading the previous feedback is not charged); without spentSec the time
     is counted from the previous answer (or 0 for the first stage).
   - pct = round(100 * ideal stages answered correctly and in time / ideal stages). */
(function (G) {
  "use strict";

  function byId(data) { var m = {}; data.stages.forEach(function (s) { m[s.id] = s; }); return m; }
  function correctOf(stage) { for (var i = 0; i < stage.options.length; i++) if (stage.options[i].correct) return stage.options[i]; return null; }
  function nextId(data, stage, option) {
    if (option && option.next) return option.next;
    var i = data.stages.indexOf(stage);
    return i >= 0 && i + 1 < data.stages.length ? data.stages[i + 1].id : null;
  }

  // Stage ids on the ideal path, in order. Stops at a stage whose correct option ends the drill (next: "end").
  function idealPath(data) {
    var m = byId(data), out = [], seen = {}, s = data.stages[0];
    while (s && !seen[s.id]) {
      seen[s.id] = 1; out.push(s.id);
      var id = nextId(data, s, correctOf(s));
      s = id && id !== "end" ? m[id] : null;
    }
    return out;
  }

  // The attempt a perfect learner makes: every ideal stage answered correctly, instantly.
  function idealAttempt(data) {
    var m = byId(data);
    return { choices: idealPath(data).map(function (id) { return { stage: id, option: correctOf(m[id]).id, atSec: 0 }; }) };
  }

  var TXT = {
    wrong: { en: "Missed: ", hi: "चूक: " },
    skipped: { en: "Skipped: ", hi: "छूट गया: " },
    late: { en: "Too slow: ", hi: "बहुत देर: " },
    all: { en: "Every step on the checklist was done correctly and in time.", hi: "चेकलिस्ट का हर कदम सही और समय पर किया गया।" }
  };
  function line(kind, stage, correct) {
    return { en: TXT[kind].en + stage.prompt.en + " " + correct.feedback.en, hi: TXT[kind].hi + stage.prompt.hi + " " + correct.feedback.hi };
  }

  function score(data, attempt) {
    var m = byId(data), path = idealPath(data), first = {}, prevAt = 0;
    var choices = (attempt && attempt.choices) || [];
    choices.forEach(function (c) {
      if (!m[c.stage] || first[c.stage]) return;
      var at = typeof c.atSec === "number" ? c.atSec : prevAt;
      first[c.stage] = { option: c.option, spent: typeof c.spentSec === "number" ? Math.max(0, c.spentSec) : Math.max(0, at - prevAt) };
      prevAt = Math.max(prevAt, at);
    });
    var ok = 0, misses = [], lines = [];
    path.forEach(function (id) {
      var s = m[id], good = correctOf(s), got = first[id], kind = null;
      if (!got) kind = "skipped";
      else if (got.option !== good.id) kind = "wrong";
      else if (s.timeSec && got.spent > s.timeSec) kind = "late";
      if (!kind) { ok++; return; }
      lines.push(line(kind, s, good));
      if (good.critical) misses.push({ stage: id, reason: kind, text: s.prompt });
    });
    if (!lines.length) lines.push(TXT.all);
    return { pct: path.length ? Math.round(100 * ok / path.length) : 0, criticalMisses: misses, lines: lines };
  }

  /* ---------- schema check (tests and the build tool call it; returns [] when valid) ---------- */
  var DEVANAGARI_DIGIT = /[\u0966-\u096F]/, DASH = /[\u2013\u2014]/;
  function textErr(t, where, errs) {
    if (!t || typeof t.en !== "string" || typeof t.hi !== "string" || !t.en.trim() || !t.hi.trim()) { errs.push(where + ": needs {en, hi}"); return; }
    if (DASH.test(t.en) || DASH.test(t.hi)) errs.push(where + ": en-dash or em-dash");
    if (DEVANAGARI_DIGIT.test(t.hi)) errs.push(where + ": Devanagari digits (clinical numerals stay ASCII)");
  }
  function validate(data) {
    var errs = [];
    if (!data || data.kind !== "drill") return ["kind must be drill"];
    if (!/^[a-z]+$/.test(data.id || "")) errs.push("id");
    if (data.level !== "mbbs" && data.level !== "resident") errs.push("level");
    if (data.review !== "ai_drafted") errs.push("review must be ai_drafted");
    textErr(data.title, "title", errs); textErr(data.scenario, "scenario", errs);
    if (!data.sources || !data.sources.length) errs.push("sources");
    // A source is a web document ({label, url}) or one of the app's own protocol files ({label, path}).
    (data.sources || []).forEach(function (s, i) { if (!s.label || !(/^https:\/\//.test(s.url || "") || /^kb\//.test(s.path || ""))) errs.push("sources[" + i + "]"); });
    if (!data.stages || !data.stages.length) return errs.concat("stages");
    var m = {}, n = 0;
    data.stages.forEach(function (s) { if (m[s.id]) errs.push("duplicate stage " + s.id); m[s.id] = s; });
    data.stages.forEach(function (s) {
      textErr(s.prompt, s.id + ".prompt", errs);
      if (typeof s.src !== "number" || !data.sources[s.src]) errs.push(s.id + ": src must index sources");
      var oids = {}, correct = 0;
      (s.options || []).forEach(function (o) {
        if (oids[o.id]) errs.push(s.id + ": duplicate option " + o.id);
        oids[o.id] = 1;
        if (o.correct) correct++;
        if (o.critical && !o.correct) errs.push(s.id + "." + o.id + ": critical only on the correct option");
        textErr(o.text, s.id + "." + o.id + ".text", errs); textErr(o.feedback, s.id + "." + o.id + ".feedback", errs);
        if (o.next && o.next !== "end" && !m[o.next]) errs.push(s.id + "." + o.id + ": next " + o.next + " not found");
      });
      if ((s.options || []).length < 2) errs.push(s.id + ": needs at least 2 options");
      if (correct !== 1) errs.push(s.id + ": exactly one correct option");
    });
    if (errs.length) return errs;
    var path = idealPath(data), last = m[path[path.length - 1]], end = nextId(data, last, correctOf(last));
    if (end && end !== "end") errs.push("ideal path loops back at " + last.id);
    data.stages.forEach(function (s) { if (correctOf(s).critical) n++; });
    if (!n) errs.push("no critical step");
    return errs;
  }

  function make(data) {
    var model = {};
    for (var k in data) if (Object.prototype.hasOwnProperty.call(data, k)) model[k] = data[k];
    model.score = function (attempt) { return score(data, attempt); };
    model.idealPath = function () { return idealPath(data); };
    model.idealAttempt = function () { return idealAttempt(data); };
    return model;
  }

  var API = { make: make, score: score, idealPath: idealPath, idealAttempt: idealAttempt, validate: validate };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  else G.TOKOS_DRILL_CORE = API;
})(typeof window !== "undefined" ? window : this);
