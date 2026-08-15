/* StewardMD - oncotree-engine.js. ONCOTREE navigator: the PURE, deterministic pathway evaluator.
 *
 * ONE evaluated state tree (spec principle): evaluate(graph, answers, opts) returns the derived
 * active / disabled / unresolved state for every node + link, the collected clinical phenotype, and
 * the `disabledBy` provenance for every excluded branch. Every ONCOTREE view (pathway, map, TOC,
 * search, recommendation) reads THIS one state - answering a node re-derives it, nothing else.
 *
 * PURE like onco-dose.js / onco-recommend.js: no DOM, no fetch, no window read, no Date.now(), no
 * Math.random(). Same (graph, answers) in => same state out; runs in Node (tests) and the WebView.
 *
 * NOT a clinical decision-maker: it collects the phenotype the physician answers and marks branches
 * active/excluded; it never selects a treatment, never invents an answer, and surfaces exactly WHY a
 * branch is excluded (disabledBy). Treatment options come from the existing Standard Protocol library
 * via oncotree-recommend.js. Flag smd_onco_navigator (queue-flags.js), default OFF.
 *
 * window.SMD_ONCOTREE_ENGINE + module.exports. */
(function (root) {
  "use strict";

  var ACTIVE = "active", DISABLED = "disabled", UNRESOLVED = "unresolved", UNREACHABLE = "unreachable";

  function asArr(v) { return v == null ? [] : (v instanceof Array ? v : [v]); }
  function norm(v) { return v == null ? null : String(v).trim().toLowerCase(); }

  // Selected option ids for a node (answers keyed by nodeId).
  function answerOf(answers, nodeId) { return asArr(answers && answers[nodeId]).slice(); }

  // Is a conditional link satisfied by the source node's answer?  'true' | 'false' | 'unknown'.
  // Default link (no fromOptions) is always 'true'. An unanswered source is 'unknown' (never guessed).
  function linkSatisfied(link, answers) {
    var opts = asArr(link.fromOptions);
    if (!opts.length) return "true";                       // default / unconditional edge
    var ans = answerOf(answers, link.from);
    if (!ans.length) return "unknown";                     // source not yet answered
    var behavior = link.enableBehavior === "all" ? "all" : "any";
    if (behavior === "all") {
      for (var i = 0; i < opts.length; i++) if (ans.indexOf(opts[i]) < 0) return "false";
      return "true";
    }
    for (var j = 0; j < ans.length; j++) if (opts.indexOf(ans[j]) >= 0) return "true";
    return "false";
  }

  // Kahn topological order over links (from -> to). Nodes in a cycle (none should exist in a valid
  // navigator) are appended last so evaluation still terminates deterministically.
  function topoOrder(nodes, links) {
    var indeg = {}, adj = {}, ids = nodes.map(function (n) { return n.id; });
    ids.forEach(function (id) { indeg[id] = 0; adj[id] = []; });
    links.forEach(function (l) { if (adj[l.from] && indeg[l.to] != null) { adj[l.from].push(l.to); indeg[l.to]++; } });
    var queue = ids.filter(function (id) { return indeg[id] === 0; }), order = [], seen = {};
    while (queue.length) {
      var id = queue.shift(); if (seen[id]) continue; seen[id] = 1; order.push(id);
      adj[id].forEach(function (t) { if (--indeg[t] === 0) queue.push(t); });
    }
    ids.forEach(function (id) { if (!seen[id]) order.push(id); });   // leftover (cycle) - append stably
    return order;
  }

  // A node is "answered" if it carries a selected option, or it asks nothing (display/end/section).
  function isAnswered(node, answers) {
    if (node.nodeType === "display" || node.nodeType === "end" || node.nodeType === "section") return true;
    return answerOf(answers, node.id).length > 0;
  }

  function selectedOptions(node, answers) {
    var ans = answerOf(answers, node.id);
    return asArr(node.options).filter(function (o) { return ans.indexOf(o.id) >= 0; });
  }

  // evaluate(graph, answers, opts?) -> derived state. opts.rebaseId starts the pathway at that node
  // instead of graph.startNodeIds (Start Here), WITHOUT bypassing required upstream nodes: those are
  // reported in `missingRequired` so the UI can still demand them.
  function evaluate(graph, answers, opts) {
    graph = graph || {}; answers = answers || {}; opts = opts || {};
    var nodes = asArr(graph.nodes), links = asArr(graph.links);
    var byId = {}; nodes.forEach(function (n) { byId[n.id] = n; });
    var inbound = {}; nodes.forEach(function (n) { inbound[n.id] = []; });
    links.forEach(function (l) { if (inbound[l.to]) inbound[l.to].push(l); });

    var startIds = opts.rebaseId ? [opts.rebaseId] : asArr(graph.startNodeIds);
    var startSet = {}; startIds.forEach(function (id) { startSet[id] = 1; });

    var order = topoOrder(nodes, links);
    var st = {};        // nodeId -> derived node state
    var linkState = {}; // linkId -> derived link state

    order.forEach(function (id) {
      var node = byId[id]; if (!node) return;
      var status, disabledBy = [];
      if (startSet[id]) {
        status = ACTIVE;
      } else {
        var ins = inbound[id], anyActive = false, anyUnknown = false, allFalse = ins.length > 0, falseCauses = [];
        ins.forEach(function (l) {
          var src = st[l.from] || { status: UNREACHABLE, disabledBy: [] };
          var sat = linkSatisfied(l, answers);
          // A link is ACTIVE (source active + condition met), FALSE (source excluded, or source active +
          // condition contradicted), else UNKNOWN/pending (source still unresolved, or condition not yet
          // answered). An unresolved upstream keeps the target pending - never prematurely unreachable.
          var lActive = src.status === ACTIVE && sat === "true";
          var lFalse = (src.status === DISABLED || src.status === UNREACHABLE) || (src.status === ACTIVE && sat === "false");
          var lUnknown = !lActive && !lFalse;
          linkState[l.id] = { id: l.id, from: l.from, to: l.to, satisfied: sat, isActive: lActive, isDisabled: lFalse };
          if (lActive) anyActive = true;
          if (lUnknown) anyUnknown = true;
          if (!lFalse) allFalse = false;
          if (lFalse && sat === "false") {                                   // excluded by a concrete answer here
            var sn = byId[l.from] || {};
            falseCauses.push({ nodeId: l.from, nodeName: sn.name || sn.title || l.from,
              answers: selectedOptions(sn, answers).map(function (o) { return o.label; }) });
          } else if (lFalse && (src.status === DISABLED || src.status === UNREACHABLE)) {
            falseCauses = falseCauses.concat(src.disabledBy || []);          // propagate root cause upstream
          }
        });
        if (anyActive) status = ACTIVE;
        else if (anyUnknown) status = UNRESOLVED;
        else if (allFalse) { status = DISABLED; disabledBy = falseCauses; }
        else { status = UNREACHABLE; disabledBy = falseCauses; }
      }
      var answered = isAnswered(node, answers);
      st[id] = {
        id: id, status: status,
        isActive: status === ACTIVE, isDisabled: status === DISABLED || status === UNREACHABLE,
        isUnresolved: status === UNRESOLVED,
        isResolved: status === ACTIVE && answered,
        isAnswered: answered,
        isSelected: answerOf(answers, id).length > 0,
        disabledBy: disabledBy,
        options: asArr(node.options).map(function (o) {
          return { id: o.id, label: o.label, setsValue: o.setsValue, pills: o.pills || [],
            isSelected: answerOf(answers, id).indexOf(o.id) >= 0 };
        })
      };
    });

    var phenotype = buildPhenotype(graph, byId, st, answers);
    var missingRequired = nodes.filter(function (n) {
      return n.required && (st[n.id].status === ACTIVE || opts.rebaseId) && !st[n.id].isAnswered;
    }).map(function (n) { return { id: n.id, name: n.name || n.title, phenotypeKey: n.phenotypeKey }; });

    var activePathIds = order.filter(function (id) { return st[id].status === ACTIVE; });
    return {
      guideline: graph.guideline, navigatorVersion: graph.navigatorVersion, diseaseId: graph.diseaseId,
      nodes: st, links: linkState, byId: byId, order: order, startIds: startIds,
      phenotype: phenotype, missingRequired: missingRequired, activePathIds: activePathIds
    };
  }

  // Collect the clinical phenotype from ACTIVE, answered question nodes. phenotypeKey "biomarkers.HER2"
  // nests under biomarkers. Never infers a value the physician did not answer (never invents).
  function buildPhenotype(graph, byId, st, answers) {
    var ph = { diseaseId: graph.diseaseId || null, biomarkers: {}, _sources: {} };
    Object.keys(st).forEach(function (id) {
      var node = byId[id], s = st[id];
      if (!node || s.status !== ACTIVE || !s.isAnswered) return;   // only active, answered nodes contribute
      var selIds = {}; s.options.forEach(function (o) { if (o.isSelected) selIds[o.id] = 1; });
      var authored = asArr(node.options).filter(function (o) { return selIds[o.id]; });
      if (!authored.length) return;
      function put(key, val) {
        if (val == null) return;                                // "unknown/other" sets nothing (never invents)
        if (key.indexOf("biomarkers.") === 0) ph.biomarkers[key.slice(11)] = val;
        else ph[key] = val;
        ph._sources[key] = { nodeId: id, nodeName: node.name || node.title };
      }
      // option.sets {key:val,...} sets multiple phenotype keys (e.g. setting+intent); else the node's
      // phenotypeKey <- option.setsValue.
      authored.forEach(function (o) {
        if (o.sets && typeof o.sets === "object") { for (var k in o.sets) if (o.sets.hasOwnProperty(k)) put(k, o.sets[k]); }
        else put(node.phenotypeKey, o.setsValue);
      });
    });
    return ph;
  }

  // Client-side search over node text (name/title/description/path/option labels/pills). Returns node
  // ids grouped by nodeCategory + a flat list. Deterministic; no network.
  function search(graph, query) {
    var q = norm(query);
    var groups = { criteria: [], workup: [], treatment: [], surveillance: [], other: [] }, all = [];
    if (!q) return { all: all, groups: groups };
    asArr(graph.nodes).forEach(function (n) {
      var hay = [n.name, n.title, n.description, n.path].concat(
        asArr(n.options).map(function (o) { return o.label; }), asArr(n.pills)).join(" ");
      if (norm(hay).indexOf(q) >= 0) {
        var hit = { id: n.id, name: n.name || n.title, category: n.nodeCategory || "other", path: n.path || "" };
        all.push(hit); (groups[hit.category] || groups.other).push(hit);
      }
    });
    return { all: all, groups: groups };
  }

  var API = {
    evaluate: evaluate, buildPhenotype: buildPhenotype, search: search,
    linkSatisfied: linkSatisfied, _topoOrder: topoOrder, _version: "1.0"
  };
  if (root) root.SMD_ONCOTREE_ENGINE = API;
  if (typeof module !== "undefined" && module.exports) module.exports = API;
})(typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : null));
