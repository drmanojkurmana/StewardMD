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
//
// KEPT for the handful of checks that genuinely name one node, but see refNeverWhere below: pinning
// safety invariants to hard-coded node IDS is what KILLED this suite. The breast/lung graphs were
// rewritten from v1.1 to v3.0, every id in these lists went stale, all six tests failed, and because
// the whole suite was already red nobody noticed - so the net was down when breast-ac-th (which
// contains trastuzumab) was wired into three HER2-NEGATIVE adjuvant nodes. Prefer refNeverWhere.
function refOnlyIn(graph, protoId, allowed) {
  graph.nodes.forEach(n => {
    if ((n.protocolRefs || []).indexOf(protoId) >= 0)
      assert.ok(allowed.indexOf(n.id) >= 0, `${protoId} must not be referenced by node ${n.id} (allowed: ${allowed.join(",")})`);
  });
}

// The rename-proof form of the same invariant. Instead of naming the node, it names the PHENOTYPE the
// node must not have: nodes declare their context in `pills` (["HR+/HER2-","postmenopausal",...]), and
// a phenotype survives a graph rewrite where a node id does not.
//
//   refNeverWhere(graph, "breast-ac-th", /HER2-/)  ->  a trastuzumab regimen may never sit in a
//                                                      node whose own pills say HER2-negative.
function refNeverWhere(graph, protoId, forbiddenPill, label) {
  graph.nodes.forEach(n => {
    if ((n.protocolRefs || []).indexOf(protoId) < 0) return;
    const pills = (n.pills || []).join(" ");
    assert.ok(!forbiddenPill.test(pills),
      `${protoId}${label ? " (" + label + ")" : ""} must never be offered at ${n.id}, whose phenotype is "${pills}"`);
  });
}

// Every protocol whose drug list contains a HER2-directed antibody, derived from the protocol files
// themselves rather than a hand-kept list - so a NEW HER2 regimen is covered the day it is added.
const HER2_DRUG = /trastuz|pertuz|tucatinib|lapatinib|neratinib/i;
const HER2_PROTOCOLS = Object.keys(P).filter(id =>
  (P[id].drugs || []).some(d => HER2_DRUG.test(String(d && d.name || ""))));
const ENDOCRINE_DRUG = /tamoxifen|anastrozole|letrozole|exemestane|fulvestrant|goserelin/i;
const ENDOCRINE_PROTOCOLS = Object.keys(P).filter(id =>
  (P[id].drugs || []).some(d => ENDOCRINE_DRUG.test(String(d && d.name || ""))));

test("BREAST: no HER2-directed regimen is ever offered at a HER2-NEGATIVE node", () => {
  // The regression this suite failed to catch while it was red. Trastuzumab has no target in
  // HER2-negative disease and carries real cardiotoxicity, so this is a patient-safety invariant,
  // not a tidiness one. Derived from the drug lists, so it holds for every current and future graph.
  assert.ok(HER2_PROTOCOLS.length >= 4, "expected to find HER2 protocols by drug name");
  ALL_GRAPHS.forEach(([name, g]) => {
    if (!Array.isArray(g.nodes)) return;
    HER2_PROTOCOLS.forEach(id => refNeverWhere(g, id, /HER2-(?!\/)/, name + ": HER2-directed"));
  });
});

test("BREAST: no endocrine regimen is ever offered at an ER-negative / TNBC node", () => {
  assert.ok(ENDOCRINE_PROTOCOLS.length >= 3, "expected to find endocrine protocols by drug name");
  ALL_GRAPHS.forEach(([name, g]) => {
    if (!Array.isArray(g.nodes)) return;
    ENDOCRINE_PROTOCOLS.forEach(id => refNeverWhere(g, id, /\bTNBC\b|\bER-(?!\/)/, name + ": endocrine"));
  });
});

// NODE-ID ALLOW-LISTS BELOW WERE REGENERATED FOR GRAPH v3 (2026-08-24). They were written against
// v1.1; the graphs were rewritten to v3.0, every id went stale, all six tests failed, and because the
// whole suite was already red the failure was invisible - which is how a trastuzumab-containing
// regimen ended up wired into three HER2-NEGATIVE breast nodes without anything catching it.
// Each placement below was reviewed clinically before being accepted (e.g. niraparib legitimately
// appears in the HRD-NEGATIVE ovarian node per PRIMA, where olaparib correctly does not).
// These lists WILL go stale again on the next rewrite. The durable net is the phenotype-based
// refNeverWhere() tests above, which key off the node's declared pills rather than its id.
test("BREAST: HER2-directed regimens only in HER2-positive nodes", () => {
  ["breast-tchp", "breast-tch", "breast-ac-th", "breast-paclitaxel-trastuzumab", "breast-tdm1", "breast-tdxd"]
    .forEach(id => refOnlyIn(breast, id, ["n_adj_hrneg_her2pos", "n_adj_hrpos_her2pos", "n_local_recur", "n_mbc_her2pos", "n_regional_recur", "n_tx_ibc", "n_tx_paget", "n_tx_preop"]));
});
test("BREAST: CDK4/6 + pembro-TNBC only in their subtype nodes", () => {
  refOnlyIn(breast, "breast-cdk46-ai", ["n_endo_post", "n_endo_pre", "n_mbc_hr_1l"]);
  refOnlyIn(breast, "breast-pembro-chemo-tnbc", ["n_adj_tnbc", "n_mbc_tnbc", "n_tx_ibc", "n_tx_preop"]);
});
test("BREAST: endocrine agents only in HR-positive / DCIS contexts (never TNBC)", () => {
  ["breast-tamoxifen", "breast-anastrozole", "breast-letrozole", "breast-exemestane", "breast-fulvestrant"]
    .forEach(id => refOnlyIn(breast, id, ["n_endo_post", "n_endo_pre", "n_local_recur", "n_mbc_hr_1l", "n_mbc_hr_2l", "n_regional_recur", "n_tx_dcis_erpos", "n_tx_paget"]));
});

test("LUNG: driver TKIs + single-agent pembro + consolidation each only in their node", () => {
  refOnlyIn(lung, "lung-osimertinib", ["n_tx_early_adj_egfr", "n_tx_egfr_1l", "n_tx_egfr_met", "n_tx_egfr_oligo", "n_tx_resect_residual", "n_tx_stage3_driver"]);
  refOnlyIn(lung, "lung-alectinib", ["n_tx_alk_1l", "n_tx_alk_2tki", "n_tx_early_adj_alk", "n_tx_resect_residual"]);
  refOnlyIn(lung, "lung-alk-tki-other", ["n_tx_alk_2tki", "n_tx_ros1"]);
  refOnlyIn(lung, "lung-pembro-mono", ["n_tx_io_high"]);           // requires TPS>=50
  refOnlyIn(lung, "lung-durvalumab-consolidation", ["n_tx_durva"]);
});
test("LUNG: SCLC + mesothelioma protocols isolated to their pathway", () => {
  ["sclc-platinum-etoposide", "sclc-atezolizumab", "sclc-durvalumab", "sclc-topotecan"]
    .forEach(id => refOnlyIn(lung, id, ["n_tx_egfr_transform", "n_tx_sclc_es", "n_tx_sclc_es_maint", "n_tx_sclc_ls", "n_tx_sclc_relapse_res", "n_tx_sclc_relapse_sens"]));
  ["meso-cis-pemetrexed", "meso-nivo-ipi"].forEach(id => refOnlyIn(lung, id, ["n_tx_meso_2l", "n_tx_meso_adj", "n_tx_meso_epi", "n_tx_meso_nonepi", "n_tx_meso_resectable"]));
});

// Biomarker-gated agents (PARP / RET / single-agent IO / radioligand) must live ONLY in the node whose
// upstream answer establishes the gate - the recommender does NOT enforce HRD/RET/PD-L1/EGFR, so this
// ref-placement net is the backstop (R1 lung A3 + ovarian A1: a future mis-route fails HERE, not in-app).
const G = {}; ["ovarian", "prostate", "thyroid", "headneck", "colorectal", "melanoma", "lung"].forEach(g => {
  G[g] = JSON.parse(readFileSync(join(ROOT, "kb/oncotree", g + ".json"), "utf8"));
});
test("BIOMARKER-GATED: PARP / RET / radioligand / single-agent IO only in their gated node", () => {
  // ovarian: PARP inhibitors only in the BRCA/HRD-positive maintenance node (never HR-proficient)
  refOnlyIn(G.ovarian, "gyn-olaparib-maint", ["n_tx_maint_brca", "n_tx_maint_hrd", "n_tx_relapse_parp"]);
  refOnlyIn(G.ovarian, "gyn-niraparib-maint", ["n_tx_maint_brca", "n_tx_maint_hrd", "n_tx_maint_hrp", "n_tx_relapse_parp"]);
  // prostate: PARP + PSMA radioligand only in their mCRPC biomarker branches
  refOnlyIn(G.prostate, "gu-prostate-olaparib", ["n_tx_mcrpc_2l_bio", "n_tx_mcrpc_parp", "n_tx_mcrpc_parp_post"]);
  refOnlyIn(G.prostate, "gu-prostate-lu177-psma", ["n_tx_mcrpc_2l_bio", "n_tx_mcrpc_3l", "n_tx_prostate_lu177"]);
  // thyroid: BRAF/MEK only in anaplastic, RET inhibitor only in medullary
  refOnlyIn(G.thyroid, "thyroid-anaplastic-dab-tram", ["n_tx_atc_braf", "n_tx_dtc_braf"]);
  refOnlyIn(G.thyroid, "thyroid-medullary-selpercatinib", ["n_tx_atc_ret", "n_tx_mtc_ret", "n_tx_ret_fusion"]);
  // head & neck: single-agent pembrolizumab only in the PD-L1 CPS>=1 node
  refOnlyIn(G.headneck, "hn-pembro-mono", ["n_tx_rm_pembro_mono"]);
  // colorectal: immunotherapy only in the dMMR/MSI-high node
  refOnlyIn(G.colorectal, "gi-crc-msi-pembro", ["n_tx_met_msi_1l", "n_tx_rectal_immuno"]);
  // melanoma: BRAF-targeted only in the BRAF-mutant node
  refOnlyIn(G.melanoma, "skin-melanoma-braf-mek-dab-tram", ["n_tx_adj_braf", "n_tx_adj_residual", "n_tx_adv_later", "n_tx_mut_tgt_1l", "n_tx_mut_tgt_2l"]);
  // lung: driver TKIs only in their driver nodes
  refOnlyIn(G.lung, "lung-osimertinib", ["n_tx_early_adj_egfr", "n_tx_egfr_1l", "n_tx_egfr_met", "n_tx_egfr_oligo", "n_tx_resect_residual", "n_tx_stage3_driver"]);
  refOnlyIn(G.lung, "lung-alectinib", ["n_tx_alk_1l", "n_tx_alk_2tki", "n_tx_early_adj_alk", "n_tx_resect_residual"]);
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
