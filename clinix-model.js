/* clinix-model.js — CliniX · the clinical knowledge model. PURE (no DOM, no fetch, no globals read).
 *
 * This file is the architecture. Everything else in CliniX is a renderer over what is defined here.
 *
 * THE ONE IDEA: a Skill is the atom, and Learn / Bedside / Case / OSCE / Viva / Competency are
 * PROJECTIONS over the same Skill objects - never parallel content. "Chest expansion" is authored
 * once; compileLesson() turns it into a taught lesson, compileStation() turns the SAME object into
 * an OSCE checklist, compileViva() turns it into an adaptive examiner script, and competencyKey()
 * is what all three write their result against. Adding a disease is adding JSON; the engine never
 * changes. (Product rule 26.)
 *
 * A Disease does NOT own skills. It REFERENCES them and adds emphasis: skill.exam.resp.percussion
 * is shared by COPD, pneumonia and effusion; COPD's disease file says "expect hyperresonance",
 * effusion's says "expect stony dullness". That indirection is what makes the fourth disease cheap.
 *
 * Two gates live here and are enforced by the renderers:
 *   - review gate:  content that is not clinician-approved does not reach a student.
 *   - licence gate: media whose licence is not cleared does not render. (atlas-pipeline's
 *     require_clear(), not a footnote.)
 *
 * Dual export: module.exports for node tests, window.SMD_CLINIX_MODEL for the browser.
 */
(function () {
  "use strict";

  /* ── Vocabulary ───────────────────────────────────────────────────────────── */

  // The clinical pathway, in the order a student walks it. A chapter id must be one of these, so
  // every disease presents the same spine and the UI never has to guess an order.
  var CHAPTERS = [
    "basics", "approach", "particulars", "history", "past_personal_drug_family",
    "general_exam", "systemic_exam", "disease_findings", "summary",
    "differential", "investigations", "diagnosis", "treatment",
    "case", "osce", "viva"
  ];

  var SKILL_KINDS = [
    "approach",      // hand hygiene, consent, positioning
    "history",       // what to ask, how, why, what the answer means
    "general_exam",  // pallor, clubbing, cyanosis, vitals
    "exam",          // a systemic examination manoeuvre
    "investigation", // why order it, expected findings, interpretation
    "reasoning",     // problem representation, differential, evidence
    "treatment",     // management (KB-grounded; never LLM-authored)
    "presentation"   // case presentation to a consultant
  ];

  // Draft -> Under review -> Approved -> Published -> Deprecated (product rule 27).
  // "approved" and "published" are the only student-visible states.
  var REVIEW_STATUSES = ["draft", "ai_drafted", "in_review", "approved", "published", "deprecated"];
  var STUDENT_VISIBLE = { approved: 1, published: 1 };

  // A lesson is a sequence of turns, not a page. This is what makes it feel taught rather than read.
  var TURN_KINDS = [
    "show",    // media first: watch the manoeuvre before reading about it
    "tell",    // a short prose block with a heading (never a wall of text)
    "ask",     // a question the student answers BEFORE the answer is shown
    "reveal",  // tap-to-reveal findings
    "doit",    // "now perform this" - practice instruction
    "check"    // mini-viva probe at the end of a skill
  ];

  var MEDIA_KINDS = ["video", "embed", "image", "gif", "audio", "animation", "diagram"];

  /* ── Small helpers ────────────────────────────────────────────────────────── */

  function isStr(v) { return typeof v === "string" && v.length > 0; }
  function isArr(v) { return Object.prototype.toString.call(v) === "[object Array]"; }
  function isObj(v) { return !!v && typeof v === "object" && !isArr(v); }
  function has(list, v) { return list.indexOf(v) >= 0; }
  function str(v) { return v == null ? "" : String(v); }

  /* ── Review gate ──────────────────────────────────────────────────────────── */

  function reviewStatus(obj) {
    var r = obj && obj.review;
    var s = isObj(r) ? str(r.status) : str(r);
    return has(REVIEW_STATUSES, s) ? s : "draft";
  }

  // The gate every renderer must call before showing a content object to a student.
  // opts.allowDraft comes from smd_clinix_draft, which is default OFF and must never ship on.
  function isRenderable(obj, opts) {
    if (!obj) return false;
    if (opts && opts.allowDraft) return reviewStatus(obj) !== "deprecated";
    return !!STUDENT_VISIBLE[reviewStatus(obj)];
  }

  /* ── Licence gate ─────────────────────────────────────────────────────────── */

  // Media renders only when its licence is positively cleared. Absence of a licence record is a
  // refusal, not a default-allow - 872 unlicensed images in assets/kardiox-learn/ is the failure
  // mode this exists to prevent.
  function isMediaCleared(m) {
    return !!(m && m.cleared === true && isStr(m.licence) && isStr(m.attribution));
  }

  function mediaRenderable(m, opts) {
    if (!m) return false;
    if (opts && opts.allowUncleared) return true;
    return isMediaCleared(m);
  }

  // An embed (YouTube etc) is never re-hosted; we only ever point at it, and only when the rights
  // holder permits embedding. `embeddable:false` means link out, never iframe.
  function isEmbeddable(m) {
    return !!(m && m.kind === "embed" && m.embeddable === true && isStr(m.sourceUrl));
  }

  /* ── Validators ───────────────────────────────────────────────────────────── */

  function validateMedia(m) {
    var e = [];
    if (!isObj(m)) return { ok: false, errors: ["media: not an object"] };
    if (!isStr(m.id)) e.push("media.id required");
    if (!has(MEDIA_KINDS, str(m.kind))) e.push("media.kind must be one of " + MEDIA_KINDS.join("/"));
    if (!isStr(m.caption)) e.push("media.caption required (it is the fallback when the asset is gated)");
    // Provenance is demanded of a CLEARED asset, and a work order is demanded of an uncleared one.
    // Requiring a licence string before the media is sourced would only produce placeholders like
    // "TBD", and a placeholder in a licence field is worse than an empty one: it reads as provenance.
    if (m.cleared === true) {
      if (!isStr(m.licence)) e.push("media.licence required for a cleared asset (" + str(m.id) + ")");
      if (!isStr(m.attribution)) e.push("media.attribution required for a cleared asset (" + str(m.id) + ")");
      if (m.kind === "embed") {
        if (!isStr(m.sourceUrl)) e.push("media.sourceUrl required for an embed (" + str(m.id) + ")");
      } else if (!isStr(m.src)) {
        e.push("media.src required for a cleared asset (" + str(m.id) + ")");
      }
    } else if (!isStr(m.note)) {
      e.push("media.note required for an uncleared asset - say what must be obtained (" + str(m.id) + ")");
    }
    return { ok: e.length === 0, errors: e };
  }

  function validateProbe(p, where) {
    var e = [];
    if (!isObj(p)) return ["" + where + ": probe not an object"];
    var lv = p.level;
    if (!(lv === 1 || lv === 2 || lv === 3 || lv === 4)) e.push(where + ".level must be 1-4");
    if (!isStr(p.q)) e.push(where + ".q required");
    if (!isStr(p.a)) e.push(where + ".a required (the model answer a student is marked against)");
    if (p.options != null) {
      if (!isArr(p.options) || p.options.length < 2) e.push(where + ".options must have >= 2 entries");
      else if (typeof p.correctIndex !== "number" || p.correctIndex < 0 || p.correctIndex >= p.options.length) {
        e.push(where + ".correctIndex out of range");
      }
    }
    return e;
  }

  function validateSkill(s) {
    var e = [];
    if (!isObj(s)) return { ok: false, errors: ["skill: not an object"] };
    if (!isStr(s.id)) e.push("skill.id required");
    if (!has(SKILL_KINDS, str(s.kind))) e.push("skill.kind must be one of " + SKILL_KINDS.join("/"));
    if (!isStr(s.title)) e.push("skill.title required");
    if (!isStr(s.system)) e.push("skill.system required");

    // The teaching contract. A skill that cannot say WHY it is done is not teachable, and "why"
    // is the single field that separates this from a checklist app.
    if (!isStr(s.why)) e.push("skill.why required (" + str(s.id) + ")");

    if (s.kind === "exam" || s.kind === "general_exam" || s.kind === "approach") {
      if (!isArr(s.steps) || !s.steps.length) e.push("skill.steps required for an examination skill (" + str(s.id) + ")");
      if (s.kind !== "approach") {
        if (!isStr(s.normal)) e.push("skill.normal required (" + str(s.id) + ")");
        if (!isStr(s.abnormal)) e.push("skill.abnormal required (" + str(s.id) + ")");
        if (!isStr(s.significance)) e.push("skill.significance required (" + str(s.id) + ")");
      }
    }
    if (s.kind === "history" && !isArr(s.asks)) e.push("skill.asks required for a history skill (" + str(s.id) + ")");

    if (s.probes != null) {
      if (!isArr(s.probes)) e.push("skill.probes must be an array");
      else for (var i = 0; i < s.probes.length; i++) e = e.concat(validateProbe(s.probes[i], str(s.id) + ".probes[" + i + "]"));
    }
    if (s.rubric != null) {
      if (!isArr(s.rubric)) e.push("skill.rubric must be an array");
      else for (var j = 0; j < s.rubric.length; j++) {
        var r = s.rubric[j];
        if (!isObj(r) || !isStr(r.id) || !isStr(r.text)) e.push(str(s.id) + ".rubric[" + j + "] needs {id,text}");
      }
    }
    // Sources are mandatory for anything with clinical substance. No source, no teaching.
    if (!isArr(s.sources) || !s.sources.length) e.push("skill.sources required (" + str(s.id) + ")");
    if (!has(REVIEW_STATUSES, reviewStatus(s))) e.push("skill.review.status invalid (" + str(s.id) + ")");
    return { ok: e.length === 0, errors: e };
  }

  function validateDisease(d) {
    var e = [];
    if (!isObj(d)) return { ok: false, errors: ["disease: not an object"] };
    if (!isStr(d.id)) e.push("disease.id required");
    if (!isStr(d.name)) e.push("disease.name required");
    if (!isStr(d.system)) e.push("disease.system required");
    if (!isArr(d.chapters) || !d.chapters.length) e.push("disease.chapters required");
    else {
      for (var i = 0; i < d.chapters.length; i++) {
        var c = d.chapters[i];
        if (!isObj(c)) { e.push("disease.chapters[" + i + "] not an object"); continue; }
        if (!has(CHAPTERS, str(c.id))) e.push("chapter id '" + str(c.id) + "' is not a known chapter");
        if (!isStr(c.title)) e.push("chapter " + str(c.id) + " needs a title");
        if (c.skills != null && !isArr(c.skills)) e.push("chapter " + str(c.id) + ".skills must be an array");
      }
    }
    return { ok: e.length === 0, errors: e };
  }

  // Referential integrity: every skill a disease names must exist, and every media id a skill names
  // must exist. This is the check that stops a pathway rendering an empty chapter on a device.
  function validatePack(pack) {
    var e = [];
    pack = pack || {};
    var skills = pack.skills || {};
    var media = pack.media || {};
    var diseases = isArr(pack.diseases) ? pack.diseases : (pack.disease ? [pack.disease] : []);

    var id;
    for (id in skills) {
      if (!Object.prototype.hasOwnProperty.call(skills, id)) continue;
      var vs = validateSkill(skills[id]);
      if (!vs.ok) e = e.concat(vs.errors);
      if (skills[id] && skills[id].id !== id) e.push("skill key '" + id + "' does not match skill.id '" + str(skills[id].id) + "'");
      var mids = (skills[id] && skills[id].media) || [];
      for (var k = 0; k < mids.length; k++) {
        if (!media[mids[k]]) e.push("skill " + id + " references unknown media '" + mids[k] + "'");
      }
    }
    for (var mid in media) {
      if (!Object.prototype.hasOwnProperty.call(media, mid)) continue;
      var vm = validateMedia(media[mid]);
      if (!vm.ok) e = e.concat(vm.errors);
    }
    for (var di = 0; di < diseases.length; di++) {
      var d = diseases[di];
      var vd = validateDisease(d);
      if (!vd.ok) e = e.concat(vd.errors);
      var chs = (d && d.chapters) || [];
      for (var ci = 0; ci < chs.length; ci++) {
        var sk = chs[ci].skills || [];
        for (var si = 0; si < sk.length; si++) {
          if (!skills[sk[si]]) e.push("disease " + str(d.id) + " chapter " + str(chs[ci].id) + " references unknown skill '" + sk[si] + "'");
        }
        var emp = chs[ci].emphasis || {};
        for (var ek in emp) {
          if (!Object.prototype.hasOwnProperty.call(emp, ek)) continue;
          if (!skills[ek]) e.push("disease " + str(d.id) + " emphasises unknown skill '" + ek + "'");
        }
      }
    }
    return { ok: e.length === 0, errors: e };
  }

  /* ── Competency ───────────────────────────────────────────────────────────── */

  // One key per skill, written by every runner. This is what makes "you repeatedly miss chest
  // expansion" possible across Learn, OSCE and Viva without three separate scores.
  function competencyKey(skillId) { return "cx:" + str(skillId); }

  // Mastery is deliberately NOT "answered one question correctly" (which is what
  // kardiox-providers.js:112 does, and why no row there ever shows mastered). It requires repeated
  // success on SEPARATE days, so a single lucky session cannot mint competence.
  var MASTERY = { minCorrect: 3, minSessions: 2, minAccuracy: 0.8 };

  function masteryOf(rec) {
    rec = rec || {};
    var seen = rec.seen || 0, correct = rec.correct || 0;
    var days = isArr(rec.days) ? rec.days.length : (rec.sessions || 0);
    var acc = seen > 0 ? correct / seen : 0;
    if (seen === 0) return { level: "new", pct: 0, accuracy: 0 };
    if (correct >= MASTERY.minCorrect && days >= MASTERY.minSessions && acc >= MASTERY.minAccuracy) {
      return { level: "mastered", pct: Math.round(acc * 100), accuracy: acc };
    }
    if (correct > 0) return { level: "learning", pct: Math.round(acc * 100), accuracy: acc };
    return { level: "struggling", pct: Math.round(acc * 100), accuracy: acc };
  }

  // Aggregate a set of skills into the competency dashboard row (product rule 19).
  function competencyFor(skillIds, records) {
    skillIds = skillIds || []; records = records || {};
    var n = skillIds.length, mastered = 0, sumPct = 0, weak = [];
    for (var i = 0; i < n; i++) {
      var m = masteryOf(records[competencyKey(skillIds[i])]);
      if (m.level === "mastered") mastered++;
      sumPct += m.pct;
      if (m.level === "struggling" || (m.level === "learning" && m.accuracy < 0.6)) weak.push(skillIds[i]);
    }
    return {
      total: n, mastered: mastered,
      pct: n ? Math.round(sumPct / n) : 0,
      weak: weak
    };
  }

  /* ── Projection 1: LEARN. Skill -> taught turn sequence ───────────────────── */

  function turn(kind, o) {
    o = o || {}; o.kind = kind; return o;
  }

  // The teaching order is the product's core claim: SHOW before TELL, ASK before REVEAL.
  // emphasis is the disease's overlay on a shared skill ({expect, note}).
  function compileLesson(skill, emphasis, opts) {
    opts = opts || {};
    var t = [], i;
    if (!skill) return t;
    emphasis = emphasis || {};

    var firstMedia = (skill.media && skill.media.length) ? skill.media[0] : null;

    // 1. SHOW - watch it before reading about it.
    if (firstMedia) {
      t.push(turn("show", { media: firstMedia, title: skill.title, caption: skill.oneLine || "" }));
    }

    // 2. ASK - activate the student's thinking before any answer is on screen. A level-1 probe
    //    doubles as the hook, which is why probes are authored on the skill rather than the quiz.
    var hook = pickProbe(skill, 1);
    if (hook) t.push(turn("ask", { probe: hook, intent: "hook" }));

    // 3. TELL - how to perform it, as discrete steps (never one paragraph).
    if (isArr(skill.steps) && skill.steps.length) {
      t.push(turn("tell", { heading: "How to perform", steps: skill.steps.slice() }));
    }
    if (isArr(skill.asks) && skill.asks.length) {
      t.push(turn("tell", { heading: "What to ask", steps: skill.asks.slice() }));
    }

    // 4. TELL - why. The field that makes this teaching rather than a checklist.
    t.push(turn("tell", { heading: "Why we do it", body: skill.why }));

    // 5. REVEAL - normal vs abnormal, hidden until tapped so the student commits first.
    if (isStr(skill.normal) || isStr(skill.abnormal)) {
      t.push(turn("reveal", {
        heading: "What you will find",
        items: [
          isStr(skill.normal) ? { label: "Normal", body: skill.normal } : null,
          isStr(skill.abnormal) ? { label: "Abnormal", body: skill.abnormal } : null
        ].filter(Boolean)
      }));
    }

    // 6. TELL - significance, plus the disease's own emphasis if this skill is shared.
    if (isStr(skill.significance)) {
      t.push(turn("tell", { heading: "What it means", body: skill.significance }));
    }
    if (isStr(emphasis.expect)) {
      t.push(turn("tell", {
        heading: "In this patient",
        body: emphasis.expect,
        emphasis: true
      }));
    }

    // 7. REVEAL - pitfalls. Authored as "what students get wrong", not as trivia.
    if (isArr(skill.pitfalls) && skill.pitfalls.length) {
      var items = [];
      for (i = 0; i < skill.pitfalls.length; i++) items.push({ label: "Common mistake", body: skill.pitfalls[i] });
      t.push(turn("reveal", { heading: "Common mistakes", items: items }));
    }

    // 8. DOIT - practice.
    if (skill.kind === "exam" || skill.kind === "general_exam" || skill.kind === "approach") {
      t.push(turn("doit", {
        heading: "Now you do it",
        body: skill.practice || ("Perform " + str(skill.title).toLowerCase() + " on a patient or a partner, saying each step aloud."),
        rubric: isArr(skill.rubric) ? skill.rubric.slice() : []
      }));
    }

    // 9. CHECK - a harder probe closes the loop and writes competency.
    var close = pickProbe(skill, 2) || pickProbe(skill, 3);
    if (close && (!hook || close !== hook)) t.push(turn("check", { probe: close, intent: "close" }));

    // Extra media becomes its own show turn rather than being buried.
    if (skill.media && skill.media.length > 1) {
      for (i = 1; i < skill.media.length; i++) {
        t.push(turn("show", { media: skill.media[i], title: skill.title, secondary: true }));
      }
    }

    if (opts.skipShow) {
      t = t.filter(function (x) { return x.kind !== "show"; });
    }
    return t;
  }

  function pickProbe(skill, level) {
    var p = (skill && skill.probes) || [];
    for (var i = 0; i < p.length; i++) if (p[i] && p[i].level === level) return p[i];
    return null;
  }

  /* ── Projection 2: OSCE. The SAME skills -> a timed station ───────────────── */

  // An OSCE station is not authored content. It is a selection of skills plus a clock, which is
  // exactly why a new station costs nothing once the skills exist.
  function compileStation(skills, opts) {
    opts = opts || {};
    var items = [], i, j, criticalCount = 0;
    for (i = 0; i < skills.length; i++) {
      var s = skills[i];
      if (!s) continue;
      var rub = isArr(s.rubric) ? s.rubric : [];
      for (j = 0; j < rub.length; j++) {
        var crit = rub[j].critical === true;
        if (crit) criticalCount++;
        items.push({
          id: s.id + "/" + rub[j].id,
          skillId: s.id,
          text: rub[j].text,
          critical: crit,
          weight: typeof rub[j].weight === "number" ? rub[j].weight : 1
        });
      }
    }
    return {
      title: opts.title || "OSCE station",
      task: opts.task || "",
      seconds: typeof opts.seconds === "number" ? opts.seconds : 300,
      items: items,
      maxScore: items.reduce(function (a, b) { return a + b.weight; }, 0),
      criticalCount: criticalCount,
      examinerQuestions: opts.examinerQuestions || []
    };
  }

  // A critical miss is not just lost marks. A station where the student never washed their hands or
  // never took consent is a fail regardless of total, and the feedback must say so.
  function scoreStation(station, checkedIds) {
    var checked = {}, i;
    for (i = 0; i < (checkedIds || []).length; i++) checked[checkedIds[i]] = 1;
    var score = 0, missedCritical = [], missed = [], perSkill = {};
    for (i = 0; i < station.items.length; i++) {
      var it = station.items[i];
      var got = !!checked[it.id];
      if (got) score += it.weight;
      else { missed.push(it); if (it.critical) missedCritical.push(it); }
      if (!perSkill[it.skillId]) perSkill[it.skillId] = { seen: 0, correct: 0 };
      perSkill[it.skillId].seen++;
      if (got) perSkill[it.skillId].correct++;
    }
    var pct = station.maxScore ? Math.round((score / station.maxScore) * 100) : 0;
    return {
      score: score, maxScore: station.maxScore, pct: pct,
      passed: pct >= 50 && missedCritical.length === 0,
      failedOnCritical: missedCritical.length > 0,
      missedCritical: missedCritical, missed: missed,
      perSkill: perSkill
    };
  }

  /* ── Projection 3: VIVA. The SAME probes -> an adaptive examiner ──────────── */

  // Level 1 basic -> 2 clinical reasoning -> 3 bedside application -> 4 postgraduate.
  // Escalate on a correct answer, drop back on a wrong one, one question at a time (rule 14).
  function compileViva(skills, opts) {
    opts = opts || {};
    var pool = [], i, j;
    for (i = 0; i < skills.length; i++) {
      var s = skills[i]; if (!s || !isArr(s.probes)) continue;
      for (j = 0; j < s.probes.length; j++) {
        pool.push({ skillId: s.id, skillTitle: s.title, probe: s.probes[j], level: s.probes[j].level });
      }
    }
    return { pool: pool, startLevel: opts.startLevel || 1, maxLevel: opts.maxLevel || 4 };
  }

  function nextVivaQuestion(viva, state) {
    state = state || { level: viva.startLevel, asked: {} };
    var lvl = Math.max(1, Math.min(viva.maxLevel, state.level || 1));
    var tryLevel = function (l) {
      for (var i = 0; i < viva.pool.length; i++) {
        var q = viva.pool[i];
        if (q.level === l && !state.asked[q.skillId + ":" + i]) return { q: q, key: q.skillId + ":" + i };
      }
      return null;
    };
    // Prefer the current level, then walk down, then up - so a student is never dead-ended.
    var pick = tryLevel(lvl);
    for (var d = lvl - 1; !pick && d >= 1; d--) pick = tryLevel(d);
    for (var u = lvl + 1; !pick && u <= viva.maxLevel; u++) pick = tryLevel(u);
    return pick;
  }

  function adaptLevel(level, wasCorrect, maxLevel) {
    return wasCorrect ? Math.min(maxLevel || 4, level + 1) : Math.max(1, level - 1);
  }

  /* ── Projection 4: CASE. A simulated patient, over the SAME skills ───────── */

  /* An encounter walks these in order. Each phase is gated on the last, so a student cannot ask for
   * investigations before examining, or name a diagnosis before committing to a differential -
   * which is the whole point of teaching reasoning rather than recall. */
  var CASE_PHASES = ["approach", "history", "examination", "investigations", "differential", "diagnosis", "management", "presentation"];

  /* The patient answers DETERMINISTICALLY first. A scripted reply is reproducible, works offline,
   * costs nothing, and cannot invent a symptom the author did not write - which matters more in a
   * simulated patient than anywhere else in CliniX, because an invented finding teaches a wrong
   * pattern. The tutor is a layer for unmatched questions, never the source of clinical fact. */
  function matchAsk(caseDef, text) {
    var q = normalizeAnswer(text);
    if (!q || !caseDef || !caseDef.history) return null;
    // Pad so a cue matches whole words only: " colour " will not match inside "colourful", and a
    // cue can never fire on a fragment of a longer word.
    var padded = " " + q + " ";
    var best = null, bestScore = 0;
    for (var key in caseDef.history) {
      if (!Object.prototype.hasOwnProperty.call(caseDef.history, key)) continue;
      var topic = caseDef.history[key];
      var cues = topic.cues || [];
      var score = 0;
      for (var i = 0; i < cues.length; i++) {
        var c = normalizeAnswer(cues[i]);
        if (!c) continue;
        if (padded.indexOf(" " + c + " ") >= 0) {
          // Score by the LENGTH of the matched cue, not by how many matched. A long cue is a more
          // specific question, so "how much can you do" beats a bare "how much", and "chest pain"
          // beats "pain". Counting hits instead would let a topic with many vague cues win.
          if (c.length > score) score = c.length;
        }
      }
      if (score > bestScore) { bestScore = score; best = { key: key, topic: topic }; }
    }
    return bestScore > 0 ? best : null;
  }

  // What the patient says when the student asks something the author did not script.
  function unmatchedReply(caseDef) {
    return (caseDef && caseDef.fallback) || "I am not sure what you mean, doctor.";
  }

  // Exam findings are keyed by SKILL ID, so performing percussion in a case uses the same object the
  // lesson taught and writes to the same competency key. That is the one-model rule applied to cases.
  function caseFinding(caseDef, skillId) {
    var ex = (caseDef && caseDef.exam) || {};
    return Object.prototype.hasOwnProperty.call(ex, skillId) ? ex[skillId] : null;
  }

  function caseInvestigation(caseDef, ixId) {
    var ix = (caseDef && caseDef.investigations) || {};
    return Object.prototype.hasOwnProperty.call(ix, ixId) ? ix[ixId] : null;
  }

  /* Scoring an encounter. Deliberately NOT a single percentage: a student who reaches the right
   * diagnosis having asked two questions has not done well, and a mark that hides that teaches them
   * to guess. Coverage, reasoning and the answer are reported separately. */
  function scoreCase(caseDef, taken) {
    taken = taken || {};
    var askedKeys = taken.asked || [];
    var examIds = taken.examined || [];
    var ixIds = taken.investigated || [];

    var histTotal = 0, histKey = [];
    for (var k in (caseDef.history || {})) {
      if (!Object.prototype.hasOwnProperty.call(caseDef.history, k)) continue;
      histTotal++;
      if (caseDef.history[k].key) histKey.push(k);
    }
    var histHit = 0, keyHit = 0, i;
    for (i = 0; i < askedKeys.length; i++) {
      if (caseDef.history && caseDef.history[askedKeys[i]]) histHit++;
      if (histKey.indexOf(askedKeys[i]) >= 0) keyHit++;
    }

    var examTotal = 0;
    for (var e in (caseDef.exam || {})) if (Object.prototype.hasOwnProperty.call(caseDef.exam, e)) examTotal++;
    var examHit = 0;
    for (i = 0; i < examIds.length; i++) if (caseFinding(caseDef, examIds[i])) examHit++;

    // Ordering an unhelpful investigation is not free: it is how a student learns that a panel is
    // not a plan. Essential ones are credited, non-indicated ones are counted and shown back.
    var essential = (caseDef.essentialInvestigations || []);
    var essHit = 0, unnecessary = [];
    for (i = 0; i < ixIds.length; i++) {
      if (essential.indexOf(ixIds[i]) >= 0) essHit++;
      else {
        var def = caseInvestigation(caseDef, ixIds[i]);
        if (def && def.indicated === false) unnecessary.push(ixIds[i]);
      }
    }

    var dxRes = taken.diagnosis != null
      ? markAnswer({ a: (caseDef.diagnosis && caseDef.diagnosis.answer) || "", accept: (caseDef.diagnosis && caseDef.diagnosis.accept) || [] }, taken.diagnosis)
      : { correct: false, matched: [], missed: [] };

    var ddxRes = taken.differential != null
      ? markAnswer({ a: (caseDef.differentialModel && caseDef.differentialModel.answer) || "", accept: (caseDef.differentialModel && caseDef.differentialModel.accept) || [] }, taken.differential)
      : { correct: false, matched: [], missed: [] };

    function pct(n, d) { return d ? Math.round((n / d) * 100) : 0; }

    return {
      history: { asked: histHit, total: histTotal, pct: pct(histHit, histTotal), keyAsked: keyHit, keyTotal: histKey.length, missedKey: histKey.filter(function (x) { return askedKeys.indexOf(x) < 0; }) },
      examination: { done: examHit, total: examTotal, pct: pct(examHit, examTotal) },
      investigations: { essential: essHit, essentialTotal: essential.length, unnecessary: unnecessary },
      differential: { correct: ddxRes.correct === true, matched: ddxRes.matched || [], missed: ddxRes.missed || [] },
      diagnosis: { correct: dxRes.correct === true, given: taken.diagnosis || "" },
      // The overall read is a judgement, not an average: the diagnosis is necessary but not
      // sufficient, and a student who never asked the key questions has not passed the encounter.
      verdict: (dxRes.correct === true && histKey.length > 0 && keyHit >= Math.ceil(histKey.length * 0.6) && examHit > 0)
        ? "good"
        : (dxRes.correct === true ? "right-answer-thin-workup" : "incomplete")
    };
  }

  /* ── Answer marking (deterministic; the LLM is never the sole judge) ──────── */

  function normalizeAnswer(s) {
    return str(s).toLowerCase().replace(/[^a-z0-9 ]+/g, " ").replace(/\s+/g, " ").trim();
  }

  // Keyword-overlap marking so a free-text answer can be scored offline and without a model call.
  // The tutor may add nuance on top, but it can never be the only thing standing between a student
  // and a score - a model outage must not become a wrong mark.
  function markAnswer(probe, given) {
    if (!probe) return { correct: false, matched: [], missed: [] };
    if (isArr(probe.options) && typeof probe.correctIndex === "number") {
      var idx = typeof given === "number" ? given : parseInt(given, 10);
      return { correct: idx === probe.correctIndex, choice: idx, matched: [], missed: [] };
    }
    var accept = isArr(probe.accept) ? probe.accept : [];
    if (!accept.length) return { correct: null, matched: [], missed: [], needsJudge: true };
    var g = normalizeAnswer(given), matched = [], missed = [];
    for (var i = 0; i < accept.length; i++) {
      var term = normalizeAnswer(accept[i]);
      if (term && g.indexOf(term) >= 0) matched.push(accept[i]); else missed.push(accept[i]);
    }
    var need = typeof probe.minMatch === "number" ? probe.minMatch : Math.ceil(accept.length / 2);
    return { correct: matched.length >= need, matched: matched, missed: missed, need: need };
  }

  /* ── Pathway assembly ─────────────────────────────────────────────────────── */

  // Resolve a disease's chapters against the skill table, dropping anything the student may not see.
  // Returns chapters with their skills inlined plus per-chapter counts for the progress rail.
  function buildPathway(disease, skills, opts) {
    opts = opts || {};
    var out = [], i, j;
    if (!disease || !isArr(disease.chapters)) return out;
    for (i = 0; i < disease.chapters.length; i++) {
      var c = disease.chapters[i];
      var ids = isArr(c.skills) ? c.skills : [];
      var resolved = [];
      for (j = 0; j < ids.length; j++) {
        var s = skills[ids[j]];
        if (!s) continue;
        if (!isRenderable(s, opts)) continue;      // review gate
        resolved.push(s);
      }
      out.push({
        id: c.id,
        title: c.title,
        blurb: c.blurb || "",
        skills: resolved,
        skillIds: resolved.map(function (s) { return s.id; }),
        emphasis: c.emphasis || {},
        count: resolved.length,
        // A chapter with no renderable skills is kept but marked, so the rail shows the shape of the
        // pathway rather than silently hiding half of it.
        empty: resolved.length === 0
      });
    }
    return out;
  }

  function pathwaySkillIds(pathway) {
    var ids = [];
    for (var i = 0; i < pathway.length; i++) ids = ids.concat(pathway[i].skillIds);
    return ids;
  }

  /* ── Exports ──────────────────────────────────────────────────────────────── */

  var API = {
    CHAPTERS: CHAPTERS,
    SKILL_KINDS: SKILL_KINDS,
    REVIEW_STATUSES: REVIEW_STATUSES,
    TURN_KINDS: TURN_KINDS,
    MEDIA_KINDS: MEDIA_KINDS,
    MASTERY: MASTERY,

    reviewStatus: reviewStatus,
    isRenderable: isRenderable,
    isMediaCleared: isMediaCleared,
    mediaRenderable: mediaRenderable,
    isEmbeddable: isEmbeddable,

    validateMedia: validateMedia,
    validateSkill: validateSkill,
    validateDisease: validateDisease,
    validatePack: validatePack,

    competencyKey: competencyKey,
    masteryOf: masteryOf,
    competencyFor: competencyFor,

    compileLesson: compileLesson,
    compileStation: compileStation,
    scoreStation: scoreStation,
    compileViva: compileViva,
    nextVivaQuestion: nextVivaQuestion,
    adaptLevel: adaptLevel,

    CASE_PHASES: CASE_PHASES,
    matchAsk: matchAsk,
    unmatchedReply: unmatchedReply,
    caseFinding: caseFinding,
    caseInvestigation: caseInvestigation,
    scoreCase: scoreCase,

    markAnswer: markAnswer,
    normalizeAnswer: normalizeAnswer,

    buildPathway: buildPathway,
    pathwaySkillIds: pathwaySkillIds
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_MODEL = API;
})();
