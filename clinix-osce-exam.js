/* clinix-osce-exam.js: CliniX - examiner-marked OSCE exam engine.
 *
 * ES5 IIFE, pure functions testable in Node.
 * window.SMD_CLINIX_OSCE_EXAM / module.exports.
 *
 * Exam mode:
 * 1. Station intro with mode choice (Exam default, Practice checklist secondary).
 * 2. Phase by phase (skill group). Within each phase, step by step:
 *    "What do you do next?" with 5 options (1 correct, 4 distractors).
 * 3. Distractor precedence:
 *    (a) authored distractors (station or skill: { text, why, unsafe?: true })
 *    (b) steps that come later in the same phase ("Right step, wrong time")
 *    (c) steps from other phases of the same station
 *    (d) rubric steps from other skills of the same system pack of similar length.
 * 4. Immediate feedback: correct picks lock into sequence; wrong picks show why,
 *    reveal correct step, and lock in as missed.
 * 5. Safety: critical step missed or unsafe distractor picked causes critical fail.
 * 6. Arrange check for phases with 4+ steps, scored via Longest Increasing Subsequence.
 * 7. Results screen with per-phase breakdown, order scores, review list of missed steps.
 * 8. Competency store fed with identical per-skill seen/correct counters.
 */
(function () {
  "use strict";

  function isArr(x) { return Object.prototype.toString.call(x) === "[object Array]"; }
  function isObj(x) { return x !== null && typeof x === "object" && !isArr(x); }
  function isStr(x) { return typeof x === "string" && x.trim().length > 0; }
  function cleanText(s) { return String(s || "").replace(/\s+/g, " ").trim().toLowerCase(); }

  // 32-bit FNV-1a hash for deterministic PRNG seeding
  function hashString(str) {
    var h = 2166136261 >>> 0;
    for (var i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 16777619);
    }
    return h >>> 0;
  }

  // Fast Mulberry32 PRNG
  function createRng(seed) {
    var s = (typeof seed === "number" ? seed : hashString(String(seed || "0"))) >>> 0;
    return function () {
      s = (s + 0x6D2B79F5) >>> 0;
      var t = Math.imul(s ^ (s >>> 15), 1 | s);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // Fisher-Yates shuffle using provided PRNG
  function shuffle(arr, rng) {
    var res = (arr || []).slice();
    rng = rng || Math.random;
    for (var i = res.length - 1; i > 0; i--) {
      var j = Math.floor(rng() * (i + 1));
      var tmp = res[i];
      res[i] = res[j];
      res[j] = tmp;
    }
    return res;
  }

  // Longest Increasing Subsequence (strictly increasing)
  function longestIncreasingSubsequence(arr) {
    if (!arr || !arr.length) return 0;
    var tails = [];
    for (var i = 0; i < arr.length; i++) {
      var x = arr[i];
      var l = 0, r = tails.length;
      while (l < r) {
        var m = (l + r) >> 1;
        if (tails[m] < x) l = m + 1;
        else r = m;
      }
      tails[l] = x;
    }
    return tails.length;
  }

  // Group station rubric items by skillId (authored order)
  function stationPhases(items) {
    var out = [], cur = null;
    items = items || [];
    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      if (!cur || cur.skillId !== it.skillId) {
        cur = {
          skillId: it.skillId,
          title: it.skillTitle || "Examination step",
          items: []
        };
        out.push(cur);
      }
      cur.items.push(it);
    }
    return out;
  }

  // Score an arranged sequence of step IDs against authored phase items
  function scoreArrange(phaseItems, placedStepIds) {
    phaseItems = phaseItems || [];
    placedStepIds = placedStepIds || [];
    var total = phaseItems.length;
    if (total === 0) return { inPlace: 0, total: 0, passed: true, awarded: 0, label: "Order: 0 of 0 in place" };

    var idToIndex = {};
    for (var i = 0; i < phaseItems.length; i++) {
      idToIndex[phaseItems[i].id] = i;
    }

    var indices = [];
    for (var j = 0; j < placedStepIds.length; j++) {
      var idx = idToIndex[placedStepIds[j]];
      if (typeof idx === "number") indices.push(idx);
    }

    var inPlace = longestIncreasingSubsequence(indices);
    var passed = inPlace === total && placedStepIds.length === total;
    var awarded = passed ? 1 : 0;

    return {
      inPlace: inPlace,
      total: total,
      passed: passed,
      awarded: awarded,
      label: "Order: " + inPlace + " of " + total + " in place"
    };
  }

  var GENERIC_DISTRACTORS = [
    "Document findings and time of assessment in clinical records",
    "Check the patient hospital wristband and confirm identity",
    "Dispose of all clinical waste in accordance with local protocol",
    "Re-evaluate baseline vital signs before proceeding",
    "Ensure appropriate chaperone is present throughout",
    "Perform hand hygiene before leaving the examination area"
  ];

  /* ── Distractor generator ─────────────────────────────────────────────────── */

  function buildStepOptions(step, phase, station, pool, completedSet, seed) {
    if (!step) return [];
    phase = phase || { items: [step], title: "Examination step", skillId: step.skillId };
    station = station || { items: phase.items, title: "OSCE station", id: "osce_station" };
    completedSet = completedSet || {};

    var rng = createRng(seed != null ? seed : (station.id + ":" + step.id));
    var seenTexts = {};
    seenTexts[cleanText(step.text)] = true;
    var candidates = [];

    function addCandidate(c) {
      if (!c || !c.text) return false;
      var k = cleanText(c.text);
      if (seenTexts[k]) return false;
      seenTexts[k] = true;
      candidates.push(c);
      return true;
    }

    // Source (a): Authored distractors if present
    var authDist = [];
    if (isArr(station.distractors)) authDist = authDist.concat(station.distractors);
    if (phase.distractors && isArr(phase.distractors)) authDist = authDist.concat(phase.distractors);
    if (phase.skill && isArr(phase.skill.distractors)) authDist = authDist.concat(phase.skill.distractors);
    if (step.distractors && isArr(step.distractors)) authDist = authDist.concat(step.distractors);

    for (var a = 0; a < authDist.length; a++) {
      var ad = authDist[a];
      if (ad && ad.text) {
        addCandidate({
          id: "auth_" + candidates.length,
          text: ad.text,
          why: ad.why || "Not appropriate for this patient scenario",
          unsafe: ad.unsafe === true,
          source: "authored"
        });
      }
    }

    // Source (b): Steps that come LATER in the same phase
    var pItems = phase.items || [];
    var stepIdx = -1;
    for (var pi = 0; pi < pItems.length; pi++) {
      if (pItems[pi].id === step.id) { stepIdx = pi; break; }
    }
    if (stepIdx >= 0) {
      for (var l = stepIdx + 1; l < pItems.length; l++) {
        var laterItem = pItems[l];
        if (!completedSet[laterItem.id]) {
          addCandidate({
            id: laterItem.id,
            text: laterItem.text,
            why: "Right step, wrong time: this comes after " + step.text,
            unsafe: false,
            source: "order",
            stepId: laterItem.id
          });
        }
      }
    }

    // Source (c): Steps from other phases of the same station
    var phases = stationPhases(station.items || []);
    for (var ph = 0; ph < phases.length; ph++) {
      var otherPhase = phases[ph];
      if (otherPhase.skillId === phase.skillId) continue;
      for (var oi = 0; oi < otherPhase.items.length; oi++) {
        var otherItem = otherPhase.items[oi];
        if (!completedSet[otherItem.id]) {
          addCandidate({
            id: otherItem.id,
            text: otherItem.text,
            why: "Not part of this phase: belongs in " + (otherPhase.title || "another phase"),
            unsafe: false,
            source: "phase",
            stepId: otherItem.id
          });
        }
      }
    }

    // Source (d): Rubric steps from other skills of the same system pack of similar length
    var poolRubric = [];
    if (pool) {
      var poolSkills = [];
      if (isArr(pool)) poolSkills = pool;
      else if (typeof pool === "object") {
        for (var pk in pool) {
          if (pool.hasOwnProperty(pk) && pool[pk]) poolSkills.push(pool[pk]);
        }
      }
      var stationSkillMap = {};
      var stItems = station.items || [];
      for (var ssi = 0; ssi < stItems.length; ssi++) {
        if (stItems[ssi].skillId) stationSkillMap[stItems[ssi].skillId] = true;
      }
      for (var psi = 0; psi < poolSkills.length; psi++) {
        var ps = poolSkills[psi];
        if (ps && ps.id && !stationSkillMap[ps.id] && isArr(ps.rubric)) {
          for (var ri = 0; ri < ps.rubric.length; ri++) {
            var rItem = ps.rubric[ri];
            if (rItem && rItem.text) {
              poolRubric.push({
                id: ps.id + "/" + rItem.id,
                text: rItem.text,
                skillTitle: ps.title || ""
              });
            }
          }
        }
      }
    }

    var targetLen = (step.text || "").length;
    poolRubric.sort(function (x, y) {
      return Math.abs(x.text.length - targetLen) - Math.abs(y.text.length - targetLen);
    });

    for (var pri = 0; pri < poolRubric.length; pri++) {
      var prItem = poolRubric[pri];
      if (!completedSet[prItem.id]) {
        addCandidate({
          id: prItem.id,
          text: prItem.text,
          why: "Not part of this station",
          unsafe: false,
          source: "system",
          stepId: prItem.id
        });
        if (candidates.length >= 12) break;
      }
    }

    // Fallbacks if fewer than 4 candidates
    for (var f = 0; f < GENERIC_DISTRACTORS.length && candidates.length < 4; f++) {
      addCandidate({
        id: "fallback_" + f,
        text: GENERIC_DISTRACTORS[f],
        why: "Not part of this station",
        unsafe: false,
        source: "fallback"
      });
    }

    var chosen = candidates.slice(0, 4);
    var options = [
      {
        id: step.id,
        text: step.text,
        isCorrect: true,
        why: "",
        unsafe: false,
        stepId: step.id
      }
    ];

    for (var cj = 0; cj < chosen.length; cj++) {
      var cd = chosen[cj];
      options.push({
        id: cd.id,
        text: cd.text,
        isCorrect: false,
        why: cd.why,
        unsafe: cd.unsafe === true,
        stepId: cd.stepId || null
      });
    }

    return shuffle(options, rng);
  }

  /* ── Exam Scoring ─────────────────────────────────────────────────────────── */

  function scoreExam(station, answers, opts) {
    station = station || { items: [], maxScore: 0, passMark: 50 };
    answers = answers || {};
    opts = opts || {};
    var orderScores = opts.orderScores || answers.orderScores || {};

    var items = station.items || [];
    var score = 0;
    var missedCritical = [];
    var missed = [];
    var perSkill = {};
    var unsafeChosen = false;
    var unsafeActions = [];

    for (var i = 0; i < items.length; i++) {
      var it = items[i];
      var ans = answers[it.id] || (answers.picks && answers.picks[it.id]);
      var got = !!(ans && ans.isCorrect === true);

      if (got) {
        score += typeof it.weight === "number" ? it.weight : 1;
      } else {
        missed.push(it);
        if (it.critical) missedCritical.push(it);
      }

      if (ans && ans.unsafe === true) {
        unsafeChosen = true;
        unsafeActions.push({
          step: it,
          pickedText: ans.pickedText || "",
          why: ans.why || "Unsafe action chosen"
        });
      }

      if (!perSkill[it.skillId]) perSkill[it.skillId] = { seen: 0, correct: 0 };
      perSkill[it.skillId].seen++;
      if (got) perSkill[it.skillId].correct++;
    }

    // Longest-correct-subsequence order marks: one mark per arranged phase
    var phases = stationPhases(items);
    var arrangedCount = 0;
    for (var p = 0; p < phases.length; p++) {
      var ph = phases[p];
      if (ph.items.length >= 4) {
        arrangedCount++;
        var ord = orderScores[ph.skillId];
        if (ord && ord.awarded) {
          score += ord.awarded;
        }
      }
    }

    var baseRubricMax = typeof station.maxScore === "number" && station.maxScore > 0
      ? station.maxScore
      : items.reduce(function (a, b) { return a + (typeof b.weight === "number" ? b.weight : 1); }, 0);

    var maxScore = baseRubricMax + arrangedCount;
    var pct = maxScore ? Math.round((score / maxScore) * 100) : 0;
    var passMark = typeof station.passMark === "number" ? station.passMark : 50;

    var failedOnCritical = missedCritical.length > 0 || unsafeChosen;
    var passed = pct >= passMark && !failedOnCritical;

    return {
      score: score,
      maxScore: maxScore,
      pct: pct,
      passed: passed,
      failedOnCritical: failedOnCritical,
      unsafeChosen: unsafeChosen,
      unsafeActions: unsafeActions,
      missedCritical: missedCritical,
      missed: missed,
      perSkill: perSkill,
      orderScores: orderScores,
      picks: answers
    };
  }

  /* ── Interactive Session Engine ───────────────────────────────────────────── */

  function createSession(station, opts) {
    opts = opts || {};
    var pool = opts.pool || null;
    var attempt = opts.attempt || 1;
    var phases = stationPhases(station.items || []);

    var phaseIndex = 0;
    var stepIndex = 0;
    var completedIds = {};
    var answers = {};
    var orderScores = {};
    var phaseSequences = {};
    var stateKind = phases.length ? "step" : "done"; // "step" | "step_feedback" | "arrange" | "arrange_result" | "done"

    var currentOptions = [];
    var lastPickResult = null;
    var arrangePool = [];
    var arrangePlaced = [];
    var arrangeResult = null;

    function refreshOptions() {
      var curPhase = phases[phaseIndex];
      if (!curPhase || !curPhase.items[stepIndex]) {
        currentOptions = [];
        return;
      }
      var curStep = curPhase.items[stepIndex];
      var seed = (station.id || "station") + ":" + attempt + ":" + curPhase.skillId + ":" + curStep.id;
      currentOptions = buildStepOptions(curStep, curPhase, station, pool, completedIds, seed);
    }

    refreshOptions();

    return {
      station: station,
      phases: phases,
      getPhaseIndex: function () { return phaseIndex; },
      getStepIndex: function () { return stepIndex; },
      getStateKind: function () { return stateKind; },
      getCompletedIds: function () { return completedIds; },
      getAnswers: function () { return answers; },
      getOrderScores: function () { return orderScores; },
      getPhaseSequences: function () { return phaseSequences; },
      getCurrentOptions: function () { return currentOptions; },
      getLastPickResult: function () { return lastPickResult; },
      getArrangePool: function () { return arrangePool; },
      getArrangePlaced: function () { return arrangePlaced; },
      getArrangeResult: function () { return arrangeResult; },

      getCurrentPhase: function () { return phases[phaseIndex] || null; },
      getCurrentStep: function () {
        var p = phases[phaseIndex];
        return (p && p.items[stepIndex]) || null;
      },

      pickOption: function (optionIndex) {
        if (stateKind !== "step") return null;
        var opt = currentOptions[optionIndex];
        if (!opt) return null;

        var curPhase = phases[phaseIndex];
        var curStep = curPhase.items[stepIndex];
        var isCorrect = opt.isCorrect === true;

        answers[curStep.id] = {
          isCorrect: isCorrect,
          pickedId: opt.id,
          pickedText: opt.text,
          why: opt.why || "",
          unsafe: opt.unsafe === true,
          stepId: curStep.id
        };
        completedIds[curStep.id] = true;

        if (!phaseSequences[curPhase.skillId]) phaseSequences[curPhase.skillId] = [];
        phaseSequences[curPhase.skillId].push({
          stepId: curStep.id,
          text: curStep.text,
          isCorrect: isCorrect,
          pickedText: opt.text,
          why: opt.why || "",
          unsafe: opt.unsafe === true
        });

        lastPickResult = {
          isCorrect: isCorrect,
          step: curStep,
          option: opt,
          why: opt.why || "",
          unsafe: opt.unsafe === true,
          correctText: curStep.text
        };

        stateKind = "step_feedback";
        return lastPickResult;
      },

      continueAfterFeedback: function () {
        if (stateKind !== "step_feedback") return;
        var curPhase = phases[phaseIndex];
        if (stepIndex < curPhase.items.length - 1) {
          stepIndex++;
          stateKind = "step";
          refreshOptions();
        } else {
          // Last step of the phase completed
          if (curPhase.items.length >= 4) {
            // Initiate Arrange check for this phase
            stateKind = "arrange";
            var rng = createRng((station.id || "station") + ":arrange:" + attempt + ":" + curPhase.skillId);
            arrangePool = shuffle(curPhase.items.slice(), rng);
            arrangePlaced = [];
            arrangeResult = null;
          } else {
            // Advance to next phase
            if (phaseIndex < phases.length - 1) {
              phaseIndex++;
              stepIndex = 0;
              stateKind = "step";
              refreshOptions();
            } else {
              stateKind = "done";
            }
          }
        }
      },

      placeArrangeItem: function (stepId) {
        if (stateKind !== "arrange") return;
        var poolIdx = -1;
        for (var i = 0; i < arrangePool.length; i++) {
          if (arrangePool[i].id === stepId) { poolIdx = i; break; }
        }
        if (poolIdx < 0) return;
        var item = arrangePool.splice(poolIdx, 1)[0];
        arrangePlaced.push(item);
      },

      removeArrangeItem: function (stepId) {
        if (stateKind !== "arrange") return;
        var placedIdx = -1;
        for (var i = 0; i < arrangePlaced.length; i++) {
          if (arrangePlaced[i].id === stepId) { placedIdx = i; break; }
        }
        if (placedIdx < 0) return;
        var item = arrangePlaced.splice(placedIdx, 1)[0];
        arrangePool.push(item);
      },

      confirmArrange: function () {
        if (stateKind !== "arrange") return null;
        var curPhase = phases[phaseIndex];
        var placedIds = [];
        for (var i = 0; i < arrangePlaced.length; i++) placedIds.push(arrangePlaced[i].id);

        arrangeResult = scoreArrange(curPhase.items, placedIds);
        orderScores[curPhase.skillId] = arrangeResult;
        stateKind = "arrange_result";
        return arrangeResult;
      },

      continueAfterArrange: function () {
        if (stateKind !== "arrange_result") return;
        if (phaseIndex < phases.length - 1) {
          phaseIndex++;
          stepIndex = 0;
          stateKind = "step";
          refreshOptions();
        } else {
          stateKind = "done";
        }
      },

      score: function (timeUp) {
        return scoreExam(station, answers, { orderScores: orderScores, timeUp: !!timeUp });
      }
    };
  }

  var API = {
    stationPhases: stationPhases,
    hashString: hashString,
    createRng: createRng,
    shuffle: shuffle,
    longestIncreasingSubsequence: longestIncreasingSubsequence,
    scoreArrange: scoreArrange,
    buildStepOptions: buildStepOptions,
    scoreExam: scoreExam,
    createSession: createSession
  };

  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_CLINIX_OSCE_EXAM = API;
})();
