/* ============================================================================
   StewardMD — Drug–Drug Interaction Engine (browser module)
   ----------------------------------------------------------------------------
   ⚠️  Clinical decision support only. Fires curated rules from
   window.INTERACTION_RULES against a medication list. Deterministic and PURE:
   no network, no AI, no side effects. Absence of a finding does NOT mean a
   combination is safe — this is a starter ruleset requiring clinician sign-off.

   Exposes: window.INTERACTIONS.checkInteractions(meds, context)
     meds    — array of items like MEDLIST.getList() ({ generic, ... }).
     context — optional { renalImpairment?, prolongedQtc?, hyperkalaemia?, ... }.

   Returns:
     { critical, major, moderate, minor, monitor,   // severity buckets
       duplicates, combinations,                     // cross-cut buckets
       reviewedCount }                               // # meds w/ resolved generic

   Load order: AFTER interaction-rules.js and medlist.js.
   ========================================================================== */
(function () {
  "use strict";

  // Map rule sourceId -> the human-readable source title, so findings never
  // leak internal id slugs into the DOM.
  function buildSourceTitles(rules) {
    var titles = {};
    var srcs = (rules && rules.sources) || [];
    for (var i = 0; i < srcs.length; i++) {
      if (srcs[i] && srcs[i].id) titles[srcs[i].id] = srcs[i].title || "";
    }
    return titles;
  }

  // Context flag aliases: the ruleset uses snake_case context values
  // (renal_impairment / prolonged_qtc / hyperkalaemia) while callers pass a
  // camelCase context object. Accept both so either style fires the rule.
  var CONTEXT_ALIASES = {
    renal_impairment: ["renal_impairment", "renalImpairment"],
    prolonged_qtc: ["prolonged_qtc", "prolongedQtc", "prolongedQTc"],
    hyperkalaemia: ["hyperkalaemia", "hyperkalemia", "hyperKalaemia"]
  };

  function contextFlagOn(context, value) {
    if (!context) return false;
    var aliases = CONTEXT_ALIASES[value] || [value];
    for (var i = 0; i < aliases.length; i++) {
      if (context[aliases[i]] === true) return true;
    }
    // Direct match as a last resort (exact key === value).
    return context[value] === true;
  }

  // Normalize a med to { generic:<lowercased>, classes:[...] }.
  // classes come from INTERACTION_RULES.drugClasses[generic]; fallback to the
  // MEDDRUGS._list `cls` string if present. Returns null when there is no
  // resolved generic (unconfirmed meds are skipped).
  function normalizeMed(med, drugClasses, meddrugsList) {
    if (!med || !med.generic || typeof med.generic !== "string") return null;
    var generic = med.generic.trim().toLowerCase();
    if (!generic) return null;

    var ingredients = generic.split("+").map(function (s) {
      return s.trim().toLowerCase();
    }).filter(Boolean);

    var classes = [];
    for (var i = 0; i < ingredients.length; i++) {
      var ing = ingredients[i];
      var ingClasses = drugClasses[ing];
      if (Array.isArray(ingClasses)) {
        for (var j = 0; j < ingClasses.length; j++) {
          var c = ingClasses[j];
          if (c !== "epc:established_pharmacologic_classes" && classes.indexOf(c) === -1) {
            classes.push(c);
          }
        }
      }
    }

    return {
      generic: generic,
      ingredients: ingredients,
      classes: classes,
      strength: med.strength != null ? med.strength : null,
      unit: med.unit || null,
      route: med.route || null,
      form: med.form || null
    };
  }

  // Does normalized med `m` satisfy subject `s`?
  function medSatisfies(m, s) {
    if (!s) return false;
    if (s.kind === "generic") {
      return m.ingredients && m.ingredients.indexOf(s.value.toLowerCase().trim()) !== -1;
    }
    if (s.kind === "class") {
      return m.classes && m.classes.indexOf(s.value) !== -1;
    }
    return false;
  }

  // Find indices of meds that satisfy a subject.
  function matchingIndices(meds, s) {
    var out = [];
    for (var i = 0; i < meds.length; i++) if (medSatisfies(meds[i], s)) out.push(i);
    return out;
  }

  // Greedily assign each subject to a DISTINCT med. Returns the array of med
  // indices used (in subject order) or null if no distinct assignment exists.
  // Only used for small subject counts (pair=2, combination<=3), so the greedy
  // pass over sorted-by-fewest-options subjects is sufficient and stable.
  function assignDistinct(meds, subjects) {
    var order = subjects.map(function (s, idx) {
      return { idx: idx, opts: matchingIndices(meds, s) };
    }).sort(function (a, b) { return a.opts.length - b.opts.length; });
    var used = {};
    var assignment = new Array(subjects.length);
    for (var k = 0; k < order.length; k++) {
      var picked = -1;
      var opts = order[k].opts;
      for (var j = 0; j < opts.length; j++) {
        if (!used[opts[j]]) { picked = opts[j]; break; }
      }
      if (picked === -1) return null;
      used[picked] = true;
      assignment[order[k].idx] = picked;
    }
    return assignment;
  }

  // Human-readable drug names for a set of med indices (deduped, generic label).
  function drugNames(meds, indices) {
    var seen = {}, names = [];
    for (var i = 0; i < indices.length; i++) {
      var g = meds[indices[i]].generic;
      if (!seen[g]) { seen[g] = true; names.push(g); }
    }
    return names;
  }

  // Shape a finding from a rule + the med indices that fired it.
  function makeFinding(rule, meds, indices, sourceTitles) {
    return {
      drugs: drugNames(meds, indices),
      severity: rule.severity,
      mechanism: rule.mechanism || "",
      effect: rule.effect || "",
      action: rule.action || "",
      monitoring: rule.monitoring || "",
      source: (rule.sourceId && sourceTitles[rule.sourceId]) || "",
      specialistReview: rule.specialistReview === true,
      ruleType: rule.type
    };
  }

  var SEVERITY_BUCKET = {
    contraindicated: "critical",
    major: "major",
    moderate: "moderate",
    minor: "minor",
    monitor: "monitor"
  };

  function checkInteractions(meds, context) {
    var IR = window.INTERACTION_RULES || {};
    var drugClasses = IR.drugClasses || {};
    var rules = IR.rules || [];
    var sourceTitles = buildSourceTitles(IR);
    var meddrugsList = (window.MEDDRUGS && window.MEDDRUGS._list) || null;

    var result = {
      critical: [], major: [], moderate: [], minor: [], monitor: [],
      duplicates: [], combinations: [],
      reviewedCount: 0,
      coverage: {
        datasetVersion: (IR.version || "") + (IR.generated ? " (" + IR.generated + ")" : ""),
        submittedCount: 0, reviewedCount: 0, classifiedCount: 0,
        unclassified: [], unchecked: []
      }
    };

    // 1. Normalize; entries without a resolved generic are recorded as
    //    "unchecked" (previously silently dropped) so the UI can surface them.
    var norm = [];
    var list = Array.isArray(meds) ? meds : [];
    result.coverage.submittedCount = list.length;
    for (var i = 0; i < list.length; i++) {
      var n = normalizeMed(list[i], drugClasses, meddrugsList);
      if (n) {
        norm.push(n);
        if (!n.classes || n.classes.length === 0) {
          if (result.coverage.unclassified.indexOf(n.generic) === -1) result.coverage.unclassified.push(n.generic);
        }
      } else {
        var src = list[i] || {};
        var label = (src.raw || src.name || src.brand || src.generic || "").toString().trim();
        if (label && result.coverage.unchecked.indexOf(label) === -1) result.coverage.unchecked.push(label);
      }
    }

    // Group normalized medicines by clinicalKey
    function getClinicalKey(ingredients) {
      if (!ingredients || ingredients.length === 0) return "";
      return ingredients.slice().sort().join("|");
    }

    var dedupedNorm = [];
    var seenKeys = {};
    for (var i = 0; i < norm.length; i++) {
      var n = norm[i];
      var key = getClinicalKey(n.ingredients) || ("unresolved-" + i);
      if (!seenKeys[key]) {
        seenKeys[key] = {
          generic: n.generic,
          ingredients: n.ingredients,
          classes: n.classes,
          products: []
        };
        dedupedNorm.push(seenKeys[key]);
      }
      seenKeys[key].products.push(n);
    }

    result.reviewedCount = dedupedNorm.length;
    result.coverage.reviewedCount = dedupedNorm.length;
    result.coverage.classifiedCount = dedupedNorm.length - result.coverage.unclassified.length;
    if (dedupedNorm.length === 0) return result;

    function hasIngredientOverlap(meds, indices) {
      var seen = {};
      for (var i = 0; i < indices.length; i++) {
        var m = meds[indices[i]];
        if (!m || !m.ingredients) continue;
        for (var j = 0; j < m.ingredients.length; j++) {
          var ing = m.ingredients[j];
          if (seen[ing]) return true;
          seen[ing] = true;
        }
      }
      return false;
    }

    function push(rule, indices) {
      if (hasIngredientOverlap(dedupedNorm, indices)) {
        return; // Exclude invalid self-overlap comparisons/alerts
      }
      var finding = makeFinding(rule, dedupedNorm, indices, sourceTitles);
      var bucket = SEVERITY_BUCKET[rule.severity] || "monitor";
      result[bucket].push(finding);
      if (rule.type === "duplicate_generic" || rule.type === "duplicate_class") result.duplicates.push(finding);
      if (rule.type === "combination") result.combinations.push(finding);
    }

    // 2. Evaluate each rule.
    for (var r = 0; r < rules.length; r++) {
      var rule = rules[r];
      var subjects = rule.subjects || [];

      if (rule.type === "pair") {
        // Both subjects present, satisfied by DIFFERENT meds.
        if (subjects.length < 2) continue;
        var pairAssign = assignDistinct(dedupedNorm, [subjects[0], subjects[1]]);
        if (pairAssign) push(rule, pairAssign);

      } else if (rule.type === "duplicate_generic") {
        // Explicit duplicate_generic rules (if any exist in ruleset)
        var counts = {};
        var firedGenerics = {};
        for (var g = 0; g < dedupedNorm.length; g++) {
          var gen = dedupedNorm[g].generic;
          counts[gen] = (counts[gen] || 0) + 1;
          if (counts[gen] >= 2 && !firedGenerics[gen]) {
            firedGenerics[gen] = true;
            var idxs = [];
            for (var m = 0; m < dedupedNorm.length; m++) if (dedupedNorm[m].generic === gen) idxs.push(m);
            push(rule, idxs);
          }
        }

      } else if (rule.type === "duplicate_class") {
        // >= 2 DISTINCT meds carry the class.
        var cls = subjects[0] && subjects[0].value;
        var members = matchingIndices(dedupedNorm, { kind: "class", value: cls });
        if (members.length >= 2) push(rule, members);

      } else if (rule.type === "combination") {
        // EVERY subject satisfied by distinct meds.
        var comboAssign = assignDistinct(dedupedNorm, subjects);
        if (comboAssign) push(rule, comboAssign);

      } else if (rule.type === "context") {
        // Drug/class subject present AND the named context flag is true.
        var drugSubjects = [], ctxValues = [];
        for (var s = 0; s < subjects.length; s++) {
          if (subjects[s].kind === "context") ctxValues.push(subjects[s].value);
          else drugSubjects.push(subjects[s]);
        }
        var ctxOn = ctxValues.length > 0 && ctxValues.every(function (v) { return contextFlagOn(context, v); });
        if (!ctxOn) continue;
        // At least one med must satisfy each drug/class subject (distinct not required).
        var indices = [];
        var allPresent = drugSubjects.every(function (ds) {
          var hit = matchingIndices(dedupedNorm, ds);
          if (hit.length === 0) return false;
          for (var h = 0; h < hit.length; h++) if (indices.indexOf(hit[h]) === -1) indices.push(hit[h]);
          return true;
        });
        if (allPresent && drugSubjects.length > 0) push(rule, indices);
      }
    }

    return result;
  }

  window.INTERACTIONS = { checkInteractions: checkInteractions };
})();
