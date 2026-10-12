/* StewardMD — ongoing events on the Dynamic Island and Lock Screen (window.SMD_liveActivity).
 *
 * The app's own running events (ICU task deadlines, the OPD consult in progress) show as an iOS Live
 * Activity, styled like the in-app Dynamic Island notifications: a compact clock in the island, a
 * card on the Lock Screen. The clock ticks natively from startedAt / endsAt, so there are no
 * per-second updates; we only send when the event's facts change.
 *
 *   SMD_liveActivity.upsert({ key, title, detail, startedAt, endsAt, symbol, tint, urgent })
 *   SMD_liveActivity.end(key)
 *
 * PRIVACY: the Lock Screen is readable by anyone holding the phone. Callers pass counts, token
 * numbers and timers only, never a patient name, ID, bed or diagnosis. sanitize() enforces the
 * length/shape limits as a backstop.
 *
 * iOS 16.2+ only, through Capacitor.Plugins.WatchBridge (clinicalActivityUpsert / clinicalActivityEnd).
 * Everywhere else (web, Android, an older build without those methods) it is a silent no-op.
 * Kill switch: localStorage smd_live_activity=0. */
(function () {
  "use strict";
  var SYMBOLS = { checklist: 1, stopwatch: 1, "person.2": 1, timer: 1, "cross.case": 1, "bell": 1 };
  function clip(s, n) { s = String(s == null ? "" : s).replace(/\s+/g, " ").trim(); return s.length > n ? s.slice(0, n - 1) + "…" : s; }
  function ms(v) { var n = Number(v); return isFinite(n) && n > 0 ? Math.round(n) : 0; }
  function sanitize(o) {
    if (!o || !o.key) return null;
    var out = {
      key: clip(o.key, 40), title: clip(o.title || "StewardMD", 40), detail: clip(o.detail, 60),
      startedAt: ms(o.startedAt) || Date.now(), endsAt: ms(o.endsAt),
      symbol: SYMBOLS[o.symbol] ? o.symbol : "timer",
      tint: /^#[0-9a-fA-F]{6}$/.test(o.tint || "") ? o.tint : "#0F766E",
      urgent: !!o.urgent
    };
    if (out.endsAt && out.endsAt <= out.startedAt) out.endsAt = out.startedAt + 1000;
    return out;
  }
  var seam = { sanitize: sanitize };
  if (typeof module !== "undefined" && module.exports) module.exports = seam;
  if (typeof window === "undefined") return;

  function plug() {
    try {
      if (localStorage.getItem("smd_live_activity") === "0") return null;
      var C = window.Capacitor;
      if (!C || !(C.isNativePlatform ? C.isNativePlatform() : C.platform !== "web")) return null;
      if ((C.getPlatform ? C.getPlatform() : C.platform) !== "ios") return null;
      var W = C.Plugins && C.Plugins.WatchBridge;
      return W && typeof W.clinicalActivityUpsert === "function" ? W : null;
    } catch (e) { return null; }
  }
  var sent = {};   // key -> JSON of the last payload sent, so unchanged facts cost nothing
  window.SMD_liveActivity = {
    upsert: function (o) {
      var p = sanitize(o), W = plug();
      if (!p || !W) return Promise.resolve(false);
      var j = JSON.stringify(p);
      if (sent[p.key] === j) return Promise.resolve(true);
      sent[p.key] = j;
      return W.clinicalActivityUpsert(p).then(function (r) { return !!(r && r.started); }, function () { delete sent[p.key]; return false; });
    },
    end: function (key) {
      var W = plug();
      if (!W) return Promise.resolve(false);
      if (sent[key] === null) return Promise.resolve(true);   // already ended this run
      sent[key] = null;                                        // (ends even an activity left by a previous run)
      return W.clinicalActivityEnd({ key: String(key) }).then(function () { return true; }, function () { return false; });
    },
    _seam: seam
  };
})();
