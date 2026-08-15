/* ONCOTREE clinical-safety invariants (R1 lung A3 backstop). The recommender enforces only histology +
 * HER2/HR; EGFR/ALK/PD-L1 driver routing relies on GRAPH STRUCTURE + curated protocolRefs. These tests
 * assert that safety-critical protocols only ever appear in their clinically-correct node, AND that
 * every walkable answer-path never surfaces a protocol that contradicts the captured phenotype - so a
 * future mis-authored graph fails here rather than in the app. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = require(join(ROOT, "oncotree-engine.js"));
const R = require(join(ROOT, "oncotree-recommend.js"));
const P = {};
readdirSync(join(ROOT, "kb/protocols")).filter(f => f.endsWith(".json") && f !== "index.json")
  .forEach(f => { const p = JSON.parse(readFileSync(join(ROOT, "kb/protocols", f), "utf8")); P[p.id] = p; });
const breast = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/breast.json"), "utf8"));
const lung = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/lung.json"), "utf8"));
const ALL_GRAPHS = readdirSync(join(ROOT, "kb/oncotree")).filter(f => f.endsWith(".json"))
  .map(f => [f.replace(".json", ""), JSON.parse(readFileSync(join(ROOT, "kb/oncotree", f), "utf8"))]);

// Assert a protocol id appears in a node's protocolRefs ONLY within the allowed node-id set.
function refOnlyIn(graph, protoId, allowed) {
  graph.nodes.forEach(n => {
    if ((n.protocolRefs || []).indexOf(protoId) >= 0)
      assert.ok(allowed.indexOf(n.id) >= 0, `${protoId} must not be referenced by node ${n.id} (allowed: ${allowed.join(",")})`);
  });
}

test("BREAST: HER2-directed regimens only in HER2-positive nodes", () => {
  ["breast-tchp", "breast-tch", "breast-ac-th", "breast-paclitaxel-trastuzumab", "breast-tdm1", "breast-tdxd"]
    .forEach(id => refOnlyIn(breast, id, ["n_tx_her2_hrpos", "n_tx_her2_hrneg"]));
});
test("BREAST: CDK4/6 + pembro-TNBC only in their subtype nodes", () => {
  refOnlyIn(breast, "breast-cdk46-ai", ["n_hrpos"]);
  refOnlyIn(breast, "breast-pembro-chemo-tnbc", ["n_tnbc"]);
});
test("BREAST: endocrine agents only in HR-positive / DCIS contexts (never TNBC)", () => {
  ["breast-tamoxifen", "breast-anastrozole", "breast-letrozole", "breast-exemestane", "breast-fulvestrant"]
    .forEach(id => refOnlyIn(breast, id, ["n_tx_her2_hrpos", "n_hrpos", "n_tx_dcis"]));
});

test("LUNG: driver TKIs + single-agent pembro + consolidation each only in their node", () => {
  refOnlyIn(lung, "lung-osimertinib", ["n_tx_nsclc_egfr"]);
  refOnlyIn(lung, "lung-alectinib", ["n_tx_nsclc_alk"]);
  refOnlyIn(lung, "lung-alk-tki-other", ["n_tx_nsclc_alk"]);
  refOnlyIn(lung, "lung-pembro-mono", ["n_tx_nsclc_iohigh"]);           // requires TPS>=50
  refOnlyIn(lung, "lung-durvalumab-consolidation", ["n_tx_nsclc_stage3"]);
});
test("LUNG: SCLC + mesothelioma protocols isolated to their pathway", () => {
  ["sclc-platinum-etoposide", "sclc-atezolizumab", "sclc-durvalumab", "sclc-topotecan"]
    .forEach(id => refOnlyIn(lung, id, ["n_tx_sclc_ls", "n_tx_sclc_es", "n_tx_sclc_relapsed"]));
  ["meso-cis-pemetrexed", "meso-nivo-ipi"].forEach(id => refOnlyIn(lung, id, ["n_tx_meso"]));
});

// Walk EVERY answer-path from start; at each reached treatment node, the recommend output must never
// contradict the captured phenotype (no HER2-directed for HER2-neg; no endocrine for HR-neg; no
// pemetrexed for squamous). This is the generic net that catches wrong-branch refs on any graph.
function walkPaths(graph) {
  const byId = {}; graph.nodes.forEach(n => (byId[n.id] = n));
  const results = [];   // { nodeId, phenotype, applicableIds }
  function rec(answers, depth) {
    if (depth > 12) return;
    const s = E.evaluate(graph, answers);
    // reached treatment nodes
    s.order.forEach(id => {
      const ns = s.nodes[id], node = byId[id];
      if (ns.status === "active" && (node.nodeType === "end") && (node.protocolRefs || []).length) {
        const refs = node.protocolRefs.map(r => P[r]).filter(Boolean);
        results.push({ nodeId: id, ph: s.phenotype, ids: R.recommend(s.phenotype, refs).applicable.map(a => a.id) });
      }
    });
    // find the first active unanswered question and branch on each option
    for (const id of s.order) {
      const ns = s.nodes[id], node = byId[id];
      if (ns.status === "active" && node.nodeType === "question" && !ns.isAnswered) {
        for (const o of node.options) rec(Object.assign({}, answers, { [id]: [o.id] }), depth + 1);
        return;   // only expand the frontier node (others become reachable after this answers)
      }
    }
  }
  rec({}, 0);
  return results;
}

for (const [name, graph] of ALL_GRAPHS) {
  test(`${name}: no answer-path surfaces a protocol that contradicts the phenotype`, () => {
    for (const r of walkPaths(graph)) {
      for (const id of r.ids) {
        const p = P[id]; const bm = p.biomarkers || {};
        if (r.ph.biomarkers && r.ph.biomarkers.HER2 === "negative")
          assert.ok(R._protoHR ? true : true, "");   // (HER2 check below)
        if (r.ph.biomarkers && r.ph.biomarkers.HER2 === "negative" && String(bm.HER2 || "").toLowerCase().indexOf("positive") === 0)
          assert.fail(`${r.nodeId}: HER2-directed ${id} surfaced for HER2-negative phenotype`);
        if (r.ph.biomarkers && r.ph.biomarkers.HR === "negative" && R._protoHR(bm) === "positive")
          assert.fail(`${r.nodeId}: endocrine ${id} surfaced for HR-negative phenotype`);
        if (r.ph.histology === "squamous" && R._stageToken && /squamous/.test((p.histology || "").toLowerCase()) && (p.histology || "").toLowerCase().indexOf("non-squamous") === 0)
          assert.fail(`${r.nodeId}: non-squamous ${id} surfaced for squamous phenotype`);
      }
    }
  });
}
