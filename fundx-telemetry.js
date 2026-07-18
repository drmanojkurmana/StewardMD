/* fundx-telemetry.js — FundX AI · anonymized acquisition telemetry (validation support).
 *
 * OPTIONAL, OFF by default (flag smd_fundx_telemetry). Records only acquisition MECHANICS to
 * support real-world validation — NEVER any PHI: no images, no patient identifiers, no
 * clinical findings/disease values, no raw frames. Only guidance steps, quality-score
 * progression, capture success/failure, acquisition time, and coded rejection reasons.
 *
 * Local-first: a capped ring buffer in localStorage (stewardmd.fundx.telemetry). export()
 * returns the buffer as JSON for manual/opt-in upload; no network send is built in (so it
 * cannot leak). Pure aggregation (_summarize) is unit-tested. Exposed as
 * window.SMD_FUNDX_TELEMETRY. Additive: no effect on acquisition behaviour.
 */
(function () {
  "use strict";
  var KEY = "stewardmd.fundx.telemetry";
  var MAX_SESSIONS = 100, MAX_STEPS = 240, MAX_TRACE = 120;

  function on() { try { return localStorage.getItem("smd_fundx_telemetry") === "1"; } catch (e) { return false; } }
  function nowMs() { return (typeof Date !== "undefined") ? Date.now() : 0; }
  function lget(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lset(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }
  function load() { try { return JSON.parse(lget(KEY)) || []; } catch (e) { return []; } }
  function save(arr) { lset(KEY, JSON.stringify(arr.slice(-MAX_SESSIONS))); }

  var cur = null;   // in-progress session (kept in memory until endSession)

  var API = {
    enabled: on,
    setEnabled: function (b) { lset("smd_fundx_telemetry", b ? "1" : "0"); return b; },

    // meta: { device, appVersion, provider, sensitivity, eye } — NO patient identifiers.
    startSession: function (meta) {
      if (!on()) { cur = null; return null; }
      if (cur) API.endSession("superseded");   // persist any un-ended prior session
      meta = meta || {};
      cur = {
        id: "t_" + nowMs() + "_" + Math.floor((nowMs() % 100000)),
        startTs: nowMs(), device: meta.device || null, appVersion: meta.appVersion || null,
        provider: meta.provider || null, sensitivity: meta.sensitivity || null, eye: meta.eye || null,
        steps: [], trace: [], corrections: 0, transitions: 0,
        outcome: null, captureMs: null, qualityAtCapture: null, rejectReasons: []
      };
      return cur.id;
    },

    // Per analyzed frame. step = state-machine step result; downsampled to keep it small.
    frame: function (step, ts) {
      if (!cur || !step) return;
      var lastState = cur.steps.length ? cur.steps[cur.steps.length - 1].s : null;
      if (step.changed || step.state !== lastState) {
        cur.transitions++;
        if (cur.steps.length < MAX_STEPS) cur.steps.push({ s: step.state, ts: ts != null ? ts : nowMs() });
      }
      // quality-score progression (readiness overall + diagnostic), thinned
      if (cur.trace.length < MAX_TRACE && (cur.trace.length === 0 || (cur.trace.length % 1 === 0))) {
        if (step.readiness) cur.trace.push([Math.round((step.readiness.overall || 0) * 100), Math.round((step.diagnostic != null ? step.diagnostic : (step.readiness.diagnostic || 0)) * 100)]);
        if (cur.trace.length > MAX_TRACE) cur.trace.shift();
      }
    },

    correction: function () { if (cur) cur.corrections++; },

    // info: { success, durationMs, quality, bursts }
    capture: function (info) {
      if (!cur) return; info = info || {};
      cur.outcome = info.success === false ? "capture_failed" : "captured";
      cur.captureMs = info.durationMs != null ? info.durationMs : (nowMs() - cur.startTs);
      cur.qualityAtCapture = info.quality != null ? Math.round(info.quality) : null;
      cur.bursts = info.bursts != null ? info.bursts : null;
    },

    // Coded acquisition-quality rejection reasons (from QualityEngine) — no clinical content.
    reject: function (reasons) { if (cur) cur.rejectReasons = (reasons || []).slice(0, 8); },

    // outcome: "saved" | "discarded" | "abandoned" | "retake" | undefined
    endSession: function (outcome) {
      if (!cur) return;
      if (outcome) cur.outcome = cur.outcome && cur.outcome !== "captured" ? cur.outcome : outcome;
      cur.endTs = nowMs(); cur.durationMs = cur.endTs - cur.startTs;
      var arr = load(); arr.push(cur); save(arr); cur = null;
    },

    // Pure aggregate over stored sessions — used for QA dashboards + the validation report.
    _summarize: function (sessions) {
      sessions = sessions || [];
      function med(a) { if (!a.length) return null; var s = a.slice().sort(function (x, y) { return x - y; }); var m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; }
      var captured = sessions.filter(function (s) { return s.outcome === "captured" || s.outcome === "saved"; });
      var times = captured.map(function (s) { return s.captureMs; }).filter(function (v) { return v != null; });
      var reasons = {};
      sessions.forEach(function (s) { (s.rejectReasons || []).forEach(function (r) { reasons[r] = (reasons[r] || 0) + 1; }); });
      return {
        sessions: sessions.length,
        captureRate: sessions.length ? captured.length / sessions.length : 0,
        medianCaptureMs: med(times),
        medianCorrections: med(sessions.map(function (s) { return s.corrections || 0; })),
        medianTransitions: med(sessions.map(function (s) { return s.transitions || 0; })),
        rejectionReasons: reasons
      };
    },
    summary: function () { return API._summarize(load()); },
    export: function () { return JSON.stringify({ schema: "fundx.telemetry/1", exportedAt: nowMs(), sessions: load() }); },
    clear: function () { lset(KEY, "[]"); cur = null; },
    _all: function () { return load(); }
  };
  if (typeof module !== "undefined" && module.exports) module.exports = API;
  if (typeof window !== "undefined") window.SMD_FUNDX_TELEMETRY = API;
})();
