/* FollowCare AI — scheduling + escalation-routing (PURE, deterministic, no I/O).
 * Shared by the client (render) and the server (cron/enqueue) — one source of truth, no duplication.
 * window.FollowCareSchedule + module.exports. No network, no PHI. */
(function () {
  "use strict";
  var G = (typeof window !== "undefined") ? window : globalThis;
  var DAY = 86400000;

  // Build the assessment schedule for an episode from its pathway's dayOffsets + discharge time.
  // sendHour = hospital local hour to send (default 9). Returns [{dayOffset, dueAtMs}] sorted.
  function scheduleFor(pathwayId, dischargeMs, opts) {
    opts = opts || {};
    var PW = opts.pathways || G.FollowCarePathways; var pw = PW && PW.get(pathwayId);
    if (!pw || typeof dischargeMs !== "number") return [];
    var hour = (typeof opts.sendHour === "number") ? opts.sendHour : 9;
    return pw.schedule.map(function (d) {
      var due = dischargeMs + d * DAY;
      due = due - (due % DAY) + hour * 3600000;              // snap to sendHour that day (UTC-based; tz applied by caller)
      return { dayOffset: d, dueAtMs: due };
    }).sort(function (a, b) { return a.dueAtMs - b.dueAtMs; });
  }

  // Whole days since discharge (never negative).
  function dayOffset(dischargeMs, nowMs) {
    if (typeof dischargeMs !== "number" || typeof nowMs !== "number") return 0;
    return Math.max(0, Math.floor((nowMs - dischargeMs) / DAY));
  }

  // The next scheduled dayOffset strictly after currentDay (null if none left).
  function nextOffset(pathwayId, currentDay, opts) {
    var PW = (opts && opts.pathways) || G.FollowCarePathways; var pw = PW && PW.get(pathwayId); if (!pw) return null;
    for (var i = 0; i < pw.schedule.length; i++) if (pw.schedule[i] > currentDay) return pw.schedule[i];
    return null;
  }

  // Which assessments are DUE now but not yet completed → what the cron should enqueue.
  // completed = { dayOffset: true } map. graceMs = how long after dueAt still counts as "due" (reminder window).
  function dueNow(pathwayId, dischargeMs, nowMs, completed, opts) {
    completed = completed || {};
    return scheduleFor(pathwayId, dischargeMs, opts).filter(function (s) {
      return s.dueAtMs <= nowMs && !completed[s.dayOffset];
    });
  }

  // Escalation → who to notify + how urgently (delivery handled by the messaging/push layer).
  function escalationToNotify(level) {
    switch (level) {
      case "red": return { notify: true, audience: ["doctor", "oncall"], urgency: "immediate", patientAdvice: "urgent" };
      case "orange": return { notify: true, audience: ["doctor"], urgency: "same_day", patientAdvice: "contact_team" };
      case "yellow": return { notify: false, audience: [], urgency: "routine", patientAdvice: "reassure_watch" };
      default: return { notify: false, audience: [], urgency: "none", patientAdvice: "reassure" };
    }
  }

  var API = { scheduleFor: scheduleFor, dayOffset: dayOffset, nextOffset: nextOffset, dueNow: dueNow, escalationToNotify: escalationToNotify, DAY: DAY, _version: 1 };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  G.FollowCareSchedule = API;
})();
