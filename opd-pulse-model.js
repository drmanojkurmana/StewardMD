/* opd-pulse-model.js - WHAT the OPD pulse card says, shared by both consoles (window.SMD_OPD_PULSE).
 *
 * OPD plan item 7. The app (queue.js) and the web console (opd.html) each carried their own copy of this
 * logic - which fields to read, when a tile turns into a warning, how to say whether the desk or the
 * doctor is slow - and the realistic way they drift is a renamed field that renders a hole in one of them.
 * The logic now lives here once; each console only turns these tiles into its own markup and styling.
 *
 * Values are plain data (never HTML): a console escapes them. null means "not measured yet", which each
 * console draws as "not yet", never as 0. Buildless ES5, UMD so Node tests load it directly.
 */
(function (root, factory) {
  var api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  if (root) root.SMD_OPD_PULSE = api;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this), function () {
  "use strict";
  function blameOf(desk, doc) {
    if (!desk || !doc || desk.medianMin == null || doc.medianMin == null) return "";
    if (desk.medianMin > doc.medianMin * 2) return "the wait is at the desk";
    if (doc.medianMin > desk.medianMin * 2) return "the wait is for the doctor";
    return "desk and doctor are even";
  }
  /** r: the /opd-pulse answer, or { failed: true }. -> { failed } | { tiles, note, unread } */
  function model(r) {
    if (!r) return null;
    if (r.failed || !r.pulse) return { failed: true, message: "Could not read the OPD figures. Do not read this as a quiet clinic." };
    var p = r.pulse, hall = p.waitingNow || {}, d2d = p.doorToDoctor || {}, desk = p.deskWait || {}, doc = p.doctorWait || {};
    var tiles = [
      { key: "hall", label: "In the hall", icon: "groups", value: p.waiting || 0, sub: hall.longestMin ? "longest " + hall.longestMin + "m" : "nobody waiting", warn: (hall.over60 || 0) > 0 },
      { key: "over1h", label: "Waiting over 1h", icon: "hourglass_bottom", value: hall.over60 || 0, sub: (hall.over30 || 0) + " over 30m", warn: (hall.over60 || 0) > 0 },
      { key: "d2d", label: "Door to doctor", icon: "schedule", value: d2d.medianMin == null ? null : d2d.medianMin, unit: "m", sub: d2d.p90Min == null ? "median" : "9 in 10 within " + d2d.p90Min + "m" },
      { key: "seen", label: "Seen", icon: "check_circle", value: p.completed || 0, sub: (p.inConsultation || 0) + " in the room" },
      { key: "walked", label: "Did not wait", icon: "person_off", value: p.abandonedPct == null ? null : p.abandonedPct, unit: "%", sub: (p.noShow || 0) + " no-show" + ((p.noShow || 0) === 1 ? "" : "s"), warn: (p.abandonedPct || 0) >= 10 },
    ];
    if (p.held) tiles.push({ key: "held", label: "Awaiting result", icon: "science", value: p.held, sub: "sent for a test or booked back" });
    if (p.syncFailed) tiles.push({ key: "sync", label: "Not in record", icon: "sync_problem", value: p.syncFailed, sub: "send again", warn: true, action: "reconcile" });
    var blame = blameOf(desk, doc);
    return {
      tiles: tiles,
      note: blame ? { deskMin: desk.medianMin, doctorMin: doc.medianMin, text: blame } : null,
      unread: (r.unread && r.unread.length) ? r.unread.slice() : [],
    };
  }
  return { model: model, blameOf: blameOf };
});
