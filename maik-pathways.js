/* pathways.js — MaiK Ask clinical pathway engine (Phase B).
 * ===========================================================================
 * window.SMD_PATHWAYS — a PURE, deterministic engine that decides WHAT the next history question is
 * about (the LLM only decides HOW to word it, see maik-reasoning.js). Pathways are versioned,
 * clinician-reviewed JSON (clinical-pathways/*.json). Spec: docs/superpowers/specs/2026-08-14-maik-ask-design.md.
 *
 *   register(pathway)                    -> add a pathway to the registry
 *   loadAll(baseUrl)                     -> (browser) fetch clinical-pathways/index.json + each file
 *   match(complaintText, assessVals)     -> pathwayId | null
 *   get(id)                              -> pathway | null
 *   knownFrom(assessVals, pathway)       -> { field: value }   seed from existing Scribe state (no re-asking)
 *   nextTarget(pathway, known, opts)     -> { field, priority, emr, ask, kind } | null   (null = nothing worth asking)
 *   isComplete(pathway, known, opts)     -> bool
 *
 * Priority (1 highest -> 6 lowest): 1 red flags · 2 required core · 3 required detail · 4 associated
 * symptoms · 5 relevant negatives · 6 low value. nextTarget returns the highest-priority UNKNOWN target
 * at or above the ask threshold (default 4). The interview loop separately caps at pathway.maxQuestions.
 * Pure + Node-testable (module.exports); no DOM/network except loadAll.
 * ======================================================================== */
(function (root) {
  "use strict";

  var REG = {};   // id -> pathway
  var DEFAULT_THRESHOLD = 4;

  function norm(s) { return " " + String(s == null ? "" : s).toLowerCase().replace(/\s+/g, " ") + " "; }

  // Flatten a pathway's fields + associated + redFlags into one candidate list with resolved priority.
  function targets(pathway) {
    var out = [];
    function add(map, kind, defPri) {
      if (!map) return;
      Object.keys(map).forEach(function (name) {
        var d = map[name] || {};
        out.push({ field: name, kind: kind, priority: (typeof d.priority === "number") ? d.priority : defPri,
          emr: d.emr || "", ask: d.ask || "", cues: d.cues || null });
      });
    }
    add(pathway.redFlags, "redflag", 1);    // red flags default to priority 1 (safety-first) unless declared
    add(pathway.fields, "field", 3);
    add(pathway.associated, "associated", 4);
    return out;
  }

  function register(pathway) { if (pathway && pathway.id) REG[pathway.id] = pathway; return pathway; }
  function get(id) { return REG[id] || null; }
  function all() { return Object.keys(REG).map(function (k) { return REG[k]; }); }

  // Match the doctor's complaint text (or the Chief-complaints EMR value) to a pathway by keyword.
  function match(complaintText, assessVals) {
    var hay = norm(complaintText) + norm(assessVals && (assessVals.Chief_complaints_duration || assessVals.History_present_illness));
    var best = null;
    all().forEach(function (p) {
      (p.match || []).forEach(function (kw) {
        if (hay.indexOf(String(kw).toLowerCase()) >= 0 && !best) best = p.id;
      });
    });
    return best;
  }

  // Seed KNOWN fields from the existing Scribe state so MaiK never re-asks. Dedicated EMR fields are
  // known when non-empty; free-text-shared fields (History_present_illness) are known when a field's
  // `cues` appear in the text. Conservative: only mark known on a clear signal.
  function knownFrom(assessVals, pathway) {
    assessVals = assessVals || {};
    var known = {};
    targets(pathway).forEach(function (t) {
      if (!t.emr) return;
      var v = assessVals[t.emr];
      if (v == null || String(v).trim() === "") return;
      var text = norm(v);
      if (t.cues && t.cues.length) {
        for (var i = 0; i < t.cues.length; i++) {
          if (text.indexOf(String(t.cues[i]).toLowerCase()) >= 0) { known[t.field] = "documented"; break; }
        }
      } else {
        known[t.field] = String(v).trim();   // dedicated field -> its value is the known finding
      }
    });
    return known;
  }

  // Highest-priority UNKNOWN target at/above the ask threshold; null when nothing worth asking remains.
  function nextTarget(pathway, known, opts) {
    known = known || {};
    var threshold = (opts && typeof opts.threshold === "number") ? opts.threshold
      : (typeof pathway.askThreshold === "number") ? pathway.askThreshold : DEFAULT_THRESHOLD;
    var cands = targets(pathway).filter(function (t) { return t.priority <= threshold && !(t.field in known); });
    if (!cands.length) return null;
    cands.sort(function (a, b) { return a.priority - b.priority; });   // stable-ish: JSON order preserved within a priority
    return cands[0];
  }

  function isComplete(pathway, known, opts) { return nextTarget(pathway, known, opts) == null; }

  // Browser loader: fetch clinical-pathways/index.json (a list of filenames), then each pathway file.
  function loadAll(baseUrl) {
    baseUrl = baseUrl || "/clinical-pathways";
    if (typeof fetch !== "function") return Promise.resolve([]);
    return fetch(baseUrl + "/index.json").then(function (r) { return r.json(); }).then(function (list) {
      return Promise.all((list || []).map(function (fn) {
        return fetch(baseUrl + "/" + fn).then(function (r) { return r.json(); }).then(register).catch(function () { return null; });
      }));
    }).catch(function () { return []; });
  }

  var API = { _version: "phaseB", register: register, get: get, all: all, match: match,
    knownFrom: knownFrom, nextTarget: nextTarget, isComplete: isComplete, loadAll: loadAll, _targets: targets };
  if (root) root.SMD_PATHWAYS = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : null);
