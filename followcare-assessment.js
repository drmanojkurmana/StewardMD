/* FollowCare AI — Assessment engine (Phase 1: dynamic questionnaires; Phase 2 makes it adaptive).
 *
 * Builds the questionnaire for an episode's scheduled day, then scores submitted answers via the
 * deterministic FollowCareEngine and maps the engine's escalation to a SAFE, templated patient message
 * + the next check-in. Patient wording is templated in P1 (LLM phrasing/translation is P2); RED always
 * advises urgent professional care. No network, no PHI, no LLM. window.FollowCareAssessment + exports.
 */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  function PWapi(o) { return (o && o.pathways) || G.FollowCarePathways; }
  function ENGapi(o) { return (o && o.engine) || G.FollowCareEngine; }

  // The questionnaire to render for a given scheduled day. P1 = pathway questions + global red-flag probes.
  function buildAssessment(pathwayId, dayOffset, opts) {
    var PW = PWapi(opts); if (!PW) return null;
    var pw = PW.get(pathwayId); if (!pw) return null;
    var qs = PW.questionsFor(pathwayId).map(function (q) {
      return { id: q.id, text: q.text, i18nKey: q.i18nKey, type: q.type, options: q.options || null, unit: q.unit || null, max: (q.type === "scale" ? (q.max || 3) : null), redFlag: !!(q.redFlag || q.redFlags) };
    });
    return {
      pathwayId: pathwayId, disease: pw.name, dayOffset: dayOffset, version: pw.version,
      greeting: "This is your Day " + dayOffset + " recovery check for " + pw.name + ".",
      questions: qs
    };
  }

  // Next scheduled dayOffset after the current one (deterministic; from the pathway schedule).
  function nextDay(pathwayId, currentDay, opts) {
    var PW = PWapi(opts); var pw = PW && PW.get(pathwayId); if (!pw) return null;
    for (var i = 0; i < pw.schedule.length; i++) if (pw.schedule[i] > currentDay) return pw.schedule[i];
    return null; // no further scheduled assessments
  }

  var MSG = {
    green: function (n) { return "Good — you appear to be recovering well. Please continue your medicines and instructions." + (n ? " Your next check-in is on day " + n + "." : " Your follow-up is complete if you have no new concerns."); },
    yellow: function (n) { return "Thanks. A few things need watching. Please keep following your instructions and take your medicines. We'll check in again" + (n ? " on day " + n + "." : " soon."); },
    orange: function () { return "Some of your answers are concerning. Please contact your treating team today to arrange a review. If you feel much worse, seek medical care sooner."; },
    red: function () { return "Your answers suggest you may need urgent medical attention. Please seek urgent medical care now or call your local emergency number. Your care team is being notified."; }
  };

  // Score submitted answers → engine result + patient-facing message + next step. Never changes therapy.
  function scoreAssessment(pathwayId, answers, opts) {
    opts = opts || {};
    var ENG = ENGapi(opts); if (!ENG) return null;
    var result = ENG.assess(pathwayId, answers, { pathways: PWapi(opts), previousScore: opts.previousScore, previousAnswers: opts.previousAnswers, history: opts.history });
    if (!result) return null;
    var next = nextDay(pathwayId, opts.dayOffset || 0, opts);
    var level = result.escalation;
    return {
      result: result,
      escalation: level,
      notifyClinician: (level === "orange" || level === "red"),   // engine-decided; delivery handled elsewhere (reuse push)
      patientMessage: (MSG[level] || MSG.green)(next),
      nextDay: (level === "orange" || level === "red") ? null : next,   // don't promise a routine next check-in when escalating
      recovered: ENG.isRecovered(pathwayId, result, opts.dayOffset, { pathways: PWapi(opts), answers: answers })
    };
  }

  var API = { buildAssessment: buildAssessment, scoreAssessment: scoreAssessment, nextDay: nextDay, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareAssessment = API;
})();
