/* PrepReels (MediGram) pure logic: flags, candidate contract, eligibility, deterministic ranking,
   cadence, finite missions, break timer, FSRS gate and consent-aware events. window.PREP_MG_DATA. ES5.
   Plan: vault/plans/PrepNucleus-MediGram.md sections 4-6, 10-14; owner decisions section 16.
   No DOM, no network, no paid call. Pure helpers load under node for tests. */
(function (G) {
  "use strict";
  var NODE = typeof module !== "undefined" && module.exports && !(G && G.document);

  var LANGS = ["en", "hi", "te"];
  var KINDS = { mcq: 1, explanation: 1, micro_lesson: 1, video: 1, image_challenge: 1, update: 1, recall: 1, break: 1 };
  var CLINICAL_KINDS = { mcq: 1, explanation: 1, micro_lesson: 1, video: 1, image_challenge: 1, update: 1, recall: 1 };
  var RIGHTS_OK = { owned: 1, licensed: 1, youtube_embed: 1 };
  var CADENCES = { "2:1": 2, "3:1": 3, "5:1": 5 };
  var MISSIONS = [
    { id: "five", label: "5 questions", detail: "About 3 to 5 minutes", mcq: 5, lessons: 0 },
    { id: "mix", label: "3 questions + 1 micro-lesson", detail: "Then one retrieval check", mcq: 3, lessons: 1 },
    { id: "mistakes", label: "Revise 5 due mistakes", detail: "Your due mistakes first", mcq: 5, lessons: 0, mistakes: true },
    { id: "case", label: "One clinical case", detail: "One case, start to finish", mcq: 1, lessons: 1 },
    { id: "ten", label: "10-minute mixed revision", detail: "8 questions and 2 micro-lessons", mcq: 8, lessons: 2 }
  ];
  var EVENT_NAMES = { session_started: 1, mcq_answered: 1, retrieval_answered: 1, lesson_completed: 1, mission_completed: 1, session_finished: 1, break_started: 1, break_returned: 1, item_saved: 1, item_skipped: 1, item_reported: 1, understand_requested: 1 };

  function flagVal(v) {
    if (v == null) return null;
    v = String(v).toLowerCase();
    if (v === "1" || v === "on" || v === "true") return true;
    if (v === "0" || v === "off" || v === "false") return false;
    return null;
  }
  function queryParam(search, key) {
    var m = String(search || "").match(new RegExp("[?&]" + key + "=([^&]+)"));
    return m ? decodeURIComponent(m[1]) : null;
  }
  /* resolveFlags({ prepEnabled, get(key)->string|null, search }) -> mode switches. Parent default OFF and
     requires smd_prep; Study defaults ON when the parent is on, the other modes and YouTube default OFF. */
  function resolveFlags(env) {
    env = env || {};
    var get = env.get || function () { return null; };
    var search = env.search || "";
    function pick(qkey, skey, dflt) {
      var q = flagVal(queryParam(search, qkey)); if (q != null) return q;
      var s = flagVal(get(skey)); if (s != null) return s;
      return dflt;
    }
    var parent = !!env.prepEnabled && pick("medigram", "smd_prep_medigram", false);
    if (!parent) return { parent: false, study: false, discovery: false, breakMode: false, youtube: false };
    return {
      parent: true,
      study: pick("medigram_study", "smd_prep_medigram_study", true),
      discovery: pick("medigram_discovery", "smd_prep_medigram_discovery", false),
      breakMode: pick("medigram_break", "smd_prep_medigram_break", false),
      youtube: pick("medigram_youtube", "smd_prep_medigram_youtube", false)
    };
  }
  function resolveCadence(arm) {
    if (arm == null) return "3:1";
    var s = String(arm).trim();
    if (s === "2" || s === "2:1") return "2:1";
    if (s === "5" || s === "5:1") return "5:1";
    if (s === "3" || s === "3:1") return "3:1";
    return "3:1";
  }
  function cadenceN(key) {
    if (CADENCES[key]) return CADENCES[key];
    var k = String(key || "").trim();
    if (CADENCES[k + ":1"]) return CADENCES[k + ":1"];
    var n = Number(key);
    if (n === 2 || n === 3 || n === 5) return n;
    return 3;
  }

  /* Candidate contract (plan section 10). Returns { ok, errors[] }; errors are field names, never content. */
  function validateCandidate(c, opts) {
    opts = opts || {};
    var now = opts.now != null ? opts.now : Date.now();
    var e = [];
    if (!c || typeof c !== "object") return { ok: false, errors: ["record"] };
    if (!c.id || typeof c.id !== "string") e.push("id");
    if (!KINDS[c.kind]) e.push("kind");
    if (!Array.isArray(c.exam) || !c.exam.length || c.exam.some(function (x) { return !x || typeof x !== "string"; })) e.push("exam");
    if (!c.subject || typeof c.subject !== "string") e.push("subject");
    if (LANGS.indexOf(c.language) < 0) e.push("language");
    if (!c.title || typeof c.title !== "string" || !c.title.trim()) e.push("title");
    if (!RIGHTS_OK[c.rightsStatus]) e.push("rightsStatus");
    if (c.rightsExpiresAt != null && !(+c.rightsExpiresAt > now)) e.push("rightsExpiresAt");
    if (!c.clinicalReview || typeof c.clinicalReview !== "object") e.push("clinicalReview");
    else if (CLINICAL_KINDS[c.kind] && c.clinicalReview.status !== "approved") e.push("clinicalReview.status");
    if ((c.language === "hi" || c.language === "te")) {
      if (!c.captions || c.captions[c.language] !== true) e.push("captions");
      if (!c.clinicalReview || !c.clinicalReview.reviewerRole) e.push("clinicalReview.reviewerRole");
    }
    if (c.kind === "mcq" && !c.questionId) e.push("questionId");
    if ((c.kind === "micro_lesson" || c.kind === "explanation") && !c.lessonId && !c.questionId) e.push("lessonId");
    if (c.kind === "video") {
      if (!c.media || (c.media.provider !== "first_party" && c.media.provider !== "youtube")) e.push("media.provider");
      else if (c.media.provider === "youtube" && !/^[A-Za-z0-9_-]{6,20}$/.test(String(c.media.videoId || ""))) e.push("media.videoId");
      else if (c.media.provider === "first_party" && !c.media.assetId) e.push("media.assetId");
    }
    if (c.media && c.media.provider === "youtube" && c.rightsStatus !== "youtube_embed" && c.rightsStatus !== "licensed") e.push("rightsStatus");
    if (c.durationSec != null && !(+c.durationSec > 0 && +c.durationSec <= 3600)) e.push("durationSec");
    if (c.updatedAt != null && isNaN(Date.parse(c.updatedAt))) e.push("updatedAt");
    return { ok: !e.length, errors: e };
  }

  function isClinical(c) { return !!CLINICAL_KINDS[c && c.kind]; }

  /* Hard eligibility at the serving boundary. ctx: { exam, mode, now, today, hiddenIds, disputedIds,
     youtubeEnabled, language }. Mirrors prep.js usable()/qualBlocked(): disputed, hidden and held items never serve. */
  function isEligible(c, ctx) {
    ctx = ctx || {};
    var now = ctx.now != null ? ctx.now : Date.now();
    if (!validateCandidate(c, { now: now }).ok) return false;
    if (c.hidden || c.hold || c.disputed) return false;
    if (c.flags && c.flags.length) return false;
    if (ctx.hiddenIds && c.id && ctx.hiddenIds[c.id]) return false;
    if (ctx.hiddenIds && c.questionId && ctx.hiddenIds[c.questionId]) return false;
    if (ctx.disputedIds && ((c.id && ctx.disputedIds[c.id]) || (c.questionId && ctx.disputedIds[c.questionId]))) return false;
    if (c.rightsExpiresAt != null && !(+c.rightsExpiresAt > now)) return false;
    if (ctx.exam && c.exam.indexOf(ctx.exam) < 0) return false;
    if (ctx.language && c.language !== ctx.language) return false;
    if (c.media && c.media.provider === "youtube" && !ctx.youtubeEnabled) return false;
    var mode = ctx.mode || "study";
    if (mode === "study") { if (c.kind === "break") return false; }
    else if (mode === "clinical") { if (!(c.kind === "micro_lesson" || c.kind === "video" || c.kind === "image_challenge" || c.kind === "update" || c.kind === "explanation")) return false; }
    else if (mode === "break") { if (c.kind !== "break") return false; }
    return true;
  }
  function eligible(candidates, ctx) {
    var seen = {}, out = [];
    (candidates || []).forEach(function (c) {
      if (!c || !c.id || seen[c.id]) return;
      if (!isEligible(c, ctx)) return;
      seen[c.id] = 1; out.push(c);
    });
    return out;
  }
  function dedupe(candidates) {
    var seen = {}, out = [];
    (candidates || []).forEach(function (c) { if (c && c.id && !seen[c.id]) { seen[c.id] = 1; out.push(c); } });
    return out;
  }

  /* Deterministic ranking (plan 6.1): due reviews and overdue mistakes first, then weak topics and the
     timetable, with a small variety penalty. Same inputs always give the same order (id breaks ties). */
  function scoreCandidate(c, ctx) {
    ctx = ctx || {};
    var today = ctx.today != null ? ctx.today : 0;
    var s = 0, key = c.questionId || c.id;
    var due = ctx.dueMap && ctx.dueMap[key];
    if (due != null && due <= today) { s += 100 + Math.min(20, today - due); }
    if (ctx.mistakeIds && (ctx.mistakeIds[c.id] || ctx.mistakeIds[key])) s += 80;
    var tags = (c.tags || []).concat(c.topicIds || []);
    if (ctx.mistakeTags) for (var i = 0; i < tags.length; i++) if (ctx.mistakeTags[tags[i]]) { s += 25; break; }
    if (ctx.weakTopics) for (var j = 0; j < (c.topicIds || []).length; j++) if (ctx.weakTopics.indexOf(c.topicIds[j]) >= 0) { s += 40; break; }
    if (ctx.timetableSubjects && ctx.timetableSubjects.indexOf(c.subject) >= 0) s += 30;
    if (c.kind === "update" && c.updatedAt) { var age = (Date.now() - Date.parse(c.updatedAt)) / 864e5; if (age >= 0 && age <= 30) s += Math.max(0, 15 - age / 2); }
    if (ctx.recentSubjects && ctx.recentSubjects.length && ctx.recentSubjects[ctx.recentSubjects.length - 1] === c.subject) s -= 15;
    if (ctx.seenIds && ctx.seenIds[c.id]) s -= 200;
    return s;
  }
  function rankCandidates(candidates, ctx) {
    return (candidates || []).slice().sort(function (a, b) {
      var d = scoreCandidate(b, ctx) - scoreCandidate(a, ctx);
      if (d) return d;
      return String(a.id) < String(b.id) ? -1 : String(a.id) > String(b.id) ? 1 : 0;
    });
  }
  function reasonFor(c, ctx) {
    ctx = ctx || {};
    var today = ctx.today != null ? ctx.today : 0, key = c.questionId || c.id;
    if (ctx.dueMap && ctx.dueMap[key] != null && ctx.dueMap[key] <= today) return "Due for review";
    if (ctx.mistakeIds && (ctx.mistakeIds[c.id] || ctx.mistakeIds[key])) return "You missed a related question";
    if (ctx.weakTopics && (c.topicIds || []).some(function (t) { return ctx.weakTopics.indexOf(t) >= 0; })) return "Weak topic";
    if (ctx.timetableSubjects && ctx.timetableSubjects.indexOf(c.subject) >= 0) return "On today's plan";
    if (ctx.exam) return "Matches your exam";
    return "Suggested for you";
  }

  function isQuestion(c) { return c && (c.kind === "mcq" || c.kind === "recall"); }
  function isLesson(c) { return c && (c.kind === "micro_lesson" || c.kind === "video" || c.kind === "explanation" || c.kind === "image_challenge"); }

  /* Finite feed from a ranked list: N questions, one micro-lesson or video, then the next question is the
     retrieval check for that lesson. Never endless: the result is at most `size` items. */
  function buildFeed(ranked, opts) {
    opts = opts || {};
    var n = cadenceN(opts.cadence || "3:1"), size = opts.size || 9;
    var qs = (ranked || []).filter(isQuestion), lessons = (ranked || []).filter(isLesson), other = (ranked || []).filter(function (c) { return !isQuestion(c) && !isLesson(c); });
    var out = [], qi = 0, li = 0;
    while (out.length < size && (qi < qs.length || li < lessons.length)) {
      var block = 0;
      while (block < n && qi < qs.length && out.length < size) { out.push(qs[qi++]); block++; }
      if (li < lessons.length && out.length < size) {
        var lesson = lessons[li++];
        out.push(lesson);
        if (qi < qs.length && out.length < size) { var r = Object.assign({}, qs[qi++]); r._retrievalFor = lesson.id; out.push(r); }
      }
      if (!block && li >= lessons.length) break;
    }
    other.forEach(function (c) { if (out.length < size) out.push(c); });
    return out.slice(0, size);
  }

  function missionById(id) { for (var i = 0; i < MISSIONS.length; i++) if (MISSIONS[i].id === id) return MISSIONS[i]; return MISSIONS[0]; }
  /* A mission completes on learning actions only: video watch time alone never completes it. */
  function missionProgress(mission, actions) {
    mission = mission || MISSIONS[0]; actions = actions || {};
    var answered = actions.answered || 0, retrieval = actions.retrievalAnswered || 0;
    var needQ = mission.mcq || 0, needR = mission.lessons ? 1 : 0;
    return { answered: answered, needed: needQ, retrievalAnswered: retrieval, retrievalNeeded: needR, done: answered >= needQ && retrieval >= needR };
  }
  function isMissionComplete(mission, actions) { return missionProgress(mission, actions).done; }

  /* Smart Break: user-chosen 3 or 5 minutes. Expiry only offers a return; it never locks or shames. */
  function createBreak(durationMin, nowMs) {
    var m = durationMin === 5 ? 5 : 3, start = nowMs != null ? nowMs : Date.now();
    return { durationMin: m, startedAt: start, endsAt: start + m * 60e3 };
  }
  function breakState(brk, nowMs) {
    if (!brk) return { remainingSec: 0, expired: true, durationMin: 3 };
    var now = nowMs != null ? nowMs : Date.now();
    var left = Math.max(0, Math.round((brk.endsAt - now) / 1000));
    return { remainingSec: left, expired: left <= 0, durationMin: brk.durationMin || 3 };
  }
  function extendBreak(brk, extraMin, nowMs) {
    if (!brk) return createBreak(3, nowMs);
    var add = extraMin === 3 || extraMin === 5 ? extraMin : 3;
    return { durationMin: (brk.durationMin || 3) + add, startedAt: brk.startedAt, endsAt: (nowMs != null ? nowMs : Date.now()) + add * 60e3 };
  }

  /* FSRS enters only on a valid answer or grade (plan 6.3). Views, dwell, likes, saves and skips never schedule. */
  function shouldScheduleFsrs(action) {
    if (!action || typeof action !== "object") return false;
    if (action.type === "mcq_answer" || action.type === "retrieval_answer") return typeof action.correct === "boolean";
    if (action.type === "recall_grade") return action.grade >= 1 && action.grade <= 4;
    return false;
  }
  function explainRequest(c) {
    if (!c) return null;
    return { candidateId: c.id, kind: c.kind, topic: (c.topicIds && c.topicIds[0]) || c.subject || "", title: c.title || "" };
  }

  /* Learning-outcome events only, local and consent-aware. Unknown names and sensitive keys are dropped. */
  function buildEvent(name, data, consent, nowMs) {
    if (!consent || consent.analytics !== true) return null;
    if (!EVENT_NAMES[name]) return null;
    var clean = {};
    Object.keys(data || {}).forEach(function (k) {
      if (/token|history|password|email|name|track|artist/i.test(k)) return;
      var v = data[k];
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") clean[k] = v;
    });
    return { name: name, at: nowMs != null ? nowMs : Date.now(), data: clean };
  }

  var PURE = { LANGS: LANGS, KINDS: KINDS, CADENCES: CADENCES, MISSIONS: MISSIONS, resolveFlags: resolveFlags, cadenceN: cadenceN,
    resolveCadence: resolveCadence,
    validateCandidate: validateCandidate, isEligible: isEligible, eligible: eligible, dedupe: dedupe,
    scoreCandidate: scoreCandidate, rankCandidates: rankCandidates, reasonFor: reasonFor, isQuestion: isQuestion, isLesson: isLesson,
    buildFeed: buildFeed, missionById: missionById, missionProgress: missionProgress, isMissionComplete: isMissionComplete,
    createBreak: createBreak, breakState: breakState, extendBreak: extendBreak,
    shouldScheduleFsrs: shouldScheduleFsrs, explainRequest: explainRequest, buildEvent: buildEvent };
  if (NODE) { module.exports = PURE; return; }
  G.PREP_MG_DATA = PURE;
})(typeof window !== "undefined" ? window : this);
