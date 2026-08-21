#!/usr/bin/env node
/* Validate an OncoTree graph JSON against the engine's schema + reachability.
   Usage: node test/validate-oncotree.cjs kb/oncotree/<id>.json
   Exits 0 (green) or 1 (hard errors printed). Warnings never fail. */
"use strict";
const fs = require("fs");
const path = require("path");
const ENG = require(path.join(__dirname, "..", "oncotree-engine.js"));

function main() {
  const file = process.argv[2];
  if (!file) { console.error("usage: validate-oncotree.cjs <graph.json>"); process.exit(1); }
  let g;
  try { g = JSON.parse(fs.readFileSync(file, "utf8")); }
  catch (e) { console.error("HARD: not valid JSON - " + e.message); process.exit(1); }

  const errs = [], warns = [];
  const nodes = Array.isArray(g.nodes) ? g.nodes : [];
  const links = Array.isArray(g.links) ? g.links : [];
  const byId = {};
  nodes.forEach(n => { if (byId[n.id]) errs.push("duplicate node id: " + n.id); byId[n.id] = n; });

  if (!g.guideline) errs.push("missing top-level 'guideline'");
  if (!g.title) errs.push("missing top-level 'title'");
  if (!Array.isArray(g.startNodeIds) || !g.startNodeIds.length) errs.push("missing/empty startNodeIds[]");
  else g.startNodeIds.forEach(id => { if (!byId[id]) errs.push("startNodeIds references unknown node: " + id); });
  if (!nodes.length) errs.push("no nodes");

  // nodes
  const CATS = ["criteria", "workup", "treatment", "surveillance", "other"];
  const TYPES = ["question", "end", "display", "section"];
  nodes.forEach(n => {
    if (!n.id) errs.push("a node has no id");
    if (n.nodeType && TYPES.indexOf(n.nodeType) < 0) warns.push(n.id + ": unusual nodeType '" + n.nodeType + "'");
    if (n.nodeCategory && CATS.indexOf(n.nodeCategory) < 0) warns.push(n.id + ": unusual nodeCategory '" + n.nodeCategory + "'");
    if (n.nodeType === "question") {
      const opts = Array.isArray(n.options) ? n.options : [];
      if (!opts.length) errs.push(n.id + ": question node has no options");
      const seen = {};
      opts.forEach(o => { if (!o.id) errs.push(n.id + ": an option has no id"); if (seen[o.id]) errs.push(n.id + ": duplicate option id " + o.id); seen[o.id] = 1; if (!o.label) warns.push(n.id + "/" + o.id + ": option has no label"); });
    }
    if (n.tables) (Array.isArray(n.tables) ? n.tables : [n.tables]).forEach((t, i) => {
      if (t && t.rows && !Array.isArray(t.rows)) errs.push(n.id + ": table[" + i + "].rows not an array");
    });
  });

  // links
  const linkIds = {};
  links.forEach((l, i) => {
    const tag = "link[" + i + "]" + (l.id ? "(" + l.id + ")" : "");
    if (!l.id) warns.push(tag + ": link has no id");
    else { if (linkIds[l.id]) errs.push("duplicate link id: " + l.id); linkIds[l.id] = 1; }
    if (!byId[l.from]) errs.push(tag + ": from references unknown node '" + l.from + "'");
    if (!byId[l.to]) errs.push(tag + ": to references unknown node '" + l.to + "'");
    if (l.fromOptions) {
      const src = byId[l.from];
      const optIds = src && Array.isArray(src.options) ? src.options.map(o => o.id) : [];
      (Array.isArray(l.fromOptions) ? l.fromOptions : [l.fromOptions]).forEach(fo => {
        if (optIds.indexOf(fo) < 0) errs.push(tag + ": fromOptions '" + fo + "' is not an option of " + l.from);
      });
    }
  });

  // cycle detection (Kahn) over from->to
  const indeg = {}, adj = {};
  nodes.forEach(n => { indeg[n.id] = 0; adj[n.id] = []; });
  links.forEach(l => { if (adj[l.from] && indeg[l.to] != null) { adj[l.from].push(l.to); indeg[l.to]++; } });
  let q = nodes.filter(n => indeg[n.id] === 0).map(n => n.id), seen2 = 0;
  while (q.length) { const id = q.shift(); seen2++; adj[id].forEach(to => { if (--indeg[to] === 0) q.push(to); }); }
  if (seen2 < nodes.length) errs.push("graph has a cycle (topo covered " + seen2 + "/" + nodes.length + ") - must be a DAG");

  // reachability from start
  if (Array.isArray(g.startNodeIds) && g.startNodeIds.length) {
    const reach = {}, stack = g.startNodeIds.slice();
    while (stack.length) { const id = stack.pop(); if (reach[id]) continue; reach[id] = 1; (adj[id] || []).forEach(to => stack.push(to)); }
    const orphans = nodes.filter(n => !reach[n.id]).map(n => n.id);
    if (orphans.length) warns.push("unreachable from start (" + orphans.length + "): " + orphans.slice(0, 12).join(", "));
  }

  // engine smoke test: evaluate empty, then greedily answer first option to reach an end
  try {
    let ans = {}, reachedEnd = false;
    for (let pass = 0; pass < 60 && !reachedEnd; pass++) {
      const st = ENG.evaluate(g, ans, {});
      let acted = false;
      for (const id of st.order) {
        const ns = st.nodes[id], node = byId[id];
        if (ns.status === "active" && node.nodeType === "end") { reachedEnd = true; break; }
        if (ns.status === "active" && node.nodeType === "question" && !ns.isAnswered && node.options && node.options.length) {
          ans[id] = [node.options[0].id]; acted = true; break;
        }
      }
      if (!acted) break;
    }
    if (!reachedEnd) warns.push("greedy first-option walk never reached an 'end' node (check links/options)");
  } catch (e) { errs.push("engine.evaluate threw: " + e.message); }

  const endCount = nodes.filter(n => n.nodeType === "end").length;
  const qCount = nodes.filter(n => n.nodeType === "question").length;

  // ---- depth profile (breast benchmark: nodes 40, maxDepth 11, avgEndLayer 4.7, ends>=5-deep 10) ----
  const layer = {}; nodes.forEach(n => layer[n.id] = 0);
  const ind = {}, adj2 = {}; nodes.forEach(n => { ind[n.id] = 0; adj2[n.id] = []; });
  links.forEach(l => { if (adj2[l.from] && ind[l.to] != null) { adj2[l.from].push(l.to); ind[l.to]++; } });
  let qq = nodes.filter(n => ind[n.id] === 0).map(n => n.id);
  while (qq.length) { const id = qq.shift(); adj2[id].forEach(to => { if (layer[to] < layer[id] + 1) layer[to] = layer[id] + 1; if (--ind[to] === 0) qq.push(to); }); }
  const endLayers = nodes.filter(n => n.nodeType === "end").map(n => layer[n.id]);
  const maxDepth = Math.max(0, ...nodes.map(n => layer[n.id]));
  const avgEndLayer = +(endLayers.reduce((a, b) => a + b, 0) / (endLayers.length || 1)).toFixed(1);
  const endsDeep = endLayers.filter(l => l >= 5).length;
  const protoRefs = nodes.reduce((a, n) => a + (Array.isArray(n.protocolRefs) ? n.protocolRefs.length : 0), 0);
  const depth = { maxDepth, avgEndLayer, endsAtDepthGe5: endsDeep, protoRefs };
  // breast-depth targets (warnings only, so authors self-correct toward the benchmark)
  if (nodes.length < 40) warns.push("DEPTH: only " + nodes.length + " nodes (breast target >=40)");
  if (maxDepth < 9) warns.push("DEPTH: longest path " + maxDepth + " (breast 11; target >=9 - refine treatment arms with line-of-therapy / response sub-steps)");
  if (avgEndLayer < 4.3) warns.push("DEPTH: avg end depth " + avgEndLayer + " (breast 4.7; target >=4.3 - most arms are leaf-terminal, add refinement before the recommendation)");
  if (endsDeep < 8) warns.push("DEPTH: only " + endsDeep + " outcomes are >=5 decisions deep (breast 10; target >=8)");

  console.log(JSON.stringify({ file: path.basename(file), nodes: nodes.length, questions: qCount, ends: endCount, links: links.length, depth: depth, errors: errs, warnings: warns }, null, 2));
  if (errs.length) { console.error("VALIDATION FAILED: " + errs.length + " hard error(s)"); process.exit(1); }
  console.log("VALIDATION OK");
}
main();
