/* StewardMD - dedicated Web Worker for on-device statistics (research-stats.js).
 * ES5 only (var/function). No DOM, no network, no patient data logging.
 * Answers { id, fn, args } with { id, ok: true, result } or
 * { id, ok: false, error: { code, message } }.
 */
(function (G) {
  "use strict";

  try {
    if (G && typeof G.importScripts === "function" && !G.SMD_RESEARCH_STATS) {
      G.importScripts("/research-stats.js?v=ra3-rod2");
    }
  } catch (err) {
    try {
      if (G && typeof G.importScripts === "function" && !G.SMD_RESEARCH_STATS) {
        G.importScripts("research-stats.js");
      }
    } catch (e2) {}
  }

  var ALLOWED = {
    parseCsv: 1,
    inferColumn: 1,
    describe: 1,
    chooseTest: 1,
    compare: 1,
    crosstab: 1,
    table1: 1,
    linear: 1,
    logistic: 1,
    formatP: 1,
    resultsSentence: 1,
    kaplanMeier: 1,
    logRank: 1,
    cox: 1,
    schoenfeld: 1,
    diagnosticPerStudy: 1,
    reitsma: 1,
    sroc: 1,
    matchedOr: 1
  };

  function getStats() {
    if (G && G.SMD_RESEARCH_STATS) return G.SMD_RESEARCH_STATS;
    if (typeof require === "function") {
      try { return require("./research-stats.js"); } catch (e) {}
    }
    return null;
  }

  function handleMessage(data) {
    var msg = data || {};
    var id = msg.id;
    var fn = msg.fn;
    var args = msg.args;
    var STATS = getStats();
    if (!STATS) {
      return {
        id: id,
        ok: false,
        error: { code: "stats_unavailable", message: "research-stats.js failed to load in worker" }
      };
    }
    if (typeof fn !== "string" || !ALLOWED[fn] || typeof STATS[fn] !== "function") {
      return {
        id: id,
        ok: false,
        error: { code: "invalid_spec", message: "Unsupported stats function: " + String(fn) }
      };
    }
    try {
      var res = STATS[fn].apply(STATS, Object.prototype.toString.call(args) === "[object Array]" ? args : []);
      return { id: id, ok: true, result: res };
    } catch (err) {
      var code = (err && err.code) ? String(err.code) : "stats_failed";
      var message = (err && err.message) ? String(err.message) : String(err || code);
      return { id: id, ok: false, error: { code: code, message: message } };
    }
  }

  if (G && typeof G.postMessage === "function" && typeof G.window === "undefined") {
    G.onmessage = function (e) {
      G.postMessage(handleMessage(e ? e.data : null));
    };
  }

  if (typeof module !== "undefined" && module.exports) {
    module.exports = { handleMessage: handleMessage };
  }

})(typeof self !== "undefined" ? self : (typeof globalThis !== "undefined" ? globalThis : this));
