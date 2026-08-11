/* StewardMD — Grounds LLM differential + investigations in engine findings + KB.
 * ---------------------------------------------------------------------------
 * Merges engine-derived differential (from structured findings + decision tree)
 * with LLM suggestions, deduplicates case-insensitively, and sources each entry
 * as "engine" (KB-backed) or "ai" (LLM). Investigations pulled from KB + LLM,
 * deduplicated, capped.
 *
 * ground(transcript, llmSuggestions, opts) -> { ddx: [{label, source, score?}], investigations: [{label, source}] }
 *   transcript  = raw voice text (for context; not used in this version)
 *   llmSuggestions = { ddx: string[], investigations: string[] }
 *   opts.findings = string[] (extracted structured findings)
 *   opts.differential(findingKeys) -> [{dx, score}]
 *   opts.investigationsFor(dx) -> string[]
 *
 * window.SMD_SCRIBEGROUND + module.exports (Node-testable).
 */
(function (root) {
  "use strict";

  function ground(transcript, llmSuggestions, opts) {
    llmSuggestions = llmSuggestions || {};
    opts = opts || {};

    var findings = opts.findings || [];
    var differentialFn = opts.differential || function() { return []; };
    var investigationsForFn = opts.investigationsFor || function() { return []; };

    var engineDx = differentialFn(findings) || [];
    var llmDdx = llmSuggestions.ddx || [];
    var llmInvestigations = llmSuggestions.investigations || [];

    // ── Build engine ddx with source:"engine" ──
    var ddxMap = {}; // lowercase label -> {label, source, score}
    var ddxList = [];

    engineDx.forEach(function(item) {
      var label = item.dx || "";
      if (label) {
        var key = label.toLowerCase();
        if (!ddxMap[key]) {
          var entry = { label: label, source: "engine" };
          if (typeof item.score !== "undefined") entry.score = item.score;
          ddxMap[key] = entry;
          ddxList.push(entry);
        }
      }
    });

    // ── Add LLM ddx (source:"ai") that aren't already in engine ──
    llmDdx.forEach(function(label) {
      if (label) {
        var key = label.toLowerCase();
        if (!ddxMap[key]) {
          var entry = { label: label, source: "ai" };
          ddxMap[key] = entry;
          ddxList.push(entry);
        }
      }
    });

    // ── Cap ddx at 12 ──
    var finalDdx = ddxList.slice(0, 12);

    // ── Build investigations: union of KB (from each engine dx) + LLM ──
    var investigationsMap = {}; // lowercase label -> {label, source}
    var investigationsList = [];

    // From KB for each engine dx
    engineDx.forEach(function(item) {
      var dx = item.dx || "";
      if (dx) {
        var kbInvestigations = investigationsForFn(dx) || [];
        kbInvestigations.forEach(function(inv) {
          if (inv) {
            var key = inv.toLowerCase();
            if (!investigationsMap[key]) {
              var entry = { label: inv, source: "engine" };
              investigationsMap[key] = entry;
              investigationsList.push(entry);
            }
          }
        });
      }
    });

    // From LLM
    llmInvestigations.forEach(function(inv) {
      if (inv) {
        var key = inv.toLowerCase();
        if (!investigationsMap[key]) {
          var entry = { label: inv, source: "ai" };
          investigationsMap[key] = entry;
          investigationsList.push(entry);
        }
      }
    });

    // ── Cap investigations at 12 ──
    var finalInvestigations = investigationsList.slice(0, 12);

    return {
      ddx: finalDdx,
      investigations: finalInvestigations
    };
  }

  var API = { ground: ground, _version: "1.0" };
  if (root) root.SMD_SCRIBEGROUND = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
