/* ONCOTREE lung navigator: histology-driven routing (squamous vs non-squamous), the NSCLC driver
 * hierarchy (EGFR/ALK before PD-L1/chemo-IO), SCLC + mesothelioma branches, and the clinical safety
 * win that pemetrexed is never surfaced for squamous disease. Real graph + real lung protocols. */
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
const G = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/lung.json"), "utf8"));
const byId = {}; G.nodes.forEach(n => (byId[n.id] = n));
const P = {};
readdirSync(join(ROOT, "kb/protocols")).filter(f => /^(lung|sclc|meso)-/.test(f)).forEach(f => {
  const p = JSON.parse(readFileSync(join(ROOT, "kb/protocols", f), "utf8")); P[p.id] = p;
});
// recommend, scoped to a node's protocolRefs, from the engine-derived phenotype (as the UI does)
function atNode(nodeId, answers) {
  const s = E.evaluate(G, answers);
  const refs = (byId[nodeId].protocolRefs || []).map(r => P[r]).filter(Boolean);
  return { active: s.nodes[nodeId].status === "active", ids: R.recommend(s.phenotype, refs).applicable.map(a => a.id), pheno: s.phenotype };
}

test("non-squamous metastatic EGFR+ routes to EGFR-targeted therapy (osimertinib only)", () => {
  const r = atNode("n_tx_nsclc_egfr", { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["egfr"] });
  assert.ok(r.active);
  assert.deepEqual(r.ids, ["lung-osimertinib"]);
});

test("ALK+ routes to ALK TKIs; EGFR/driver-negative branches are excluded", () => {
  const s = E.evaluate(G, { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["alk"] });
  assert.equal(s.nodes.n_tx_nsclc_alk.status, "active");
  assert.equal(s.nodes.n_tx_nsclc_egfr.status, "disabled");
  assert.equal(s.nodes.n_lpdl1.status, "disabled");
  const r = atNode("n_tx_nsclc_alk", { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["alk"] });
  assert.ok(r.ids.indexOf("lung-alectinib") >= 0);
});

test("driver-negative + PD-L1 high routes to immunotherapy options incl. single-agent pembrolizumab", () => {
  const s = E.evaluate(G, { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["none"], n_lpdl1: ["high"] });
  assert.equal(s.nodes.n_tx_nsclc_iohigh.status, "active");
  assert.equal(s.nodes.n_tx_nsclc_egfr.status, "disabled");
  const r = atNode("n_tx_nsclc_iohigh", { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["none"], n_lpdl1: ["high"] });
  assert.ok(r.ids.indexOf("lung-pembro-mono") >= 0);
});

test("CLINICAL SAFETY: pemetrexed is NEVER surfaced for SQUAMOUS disease", () => {
  // squamous, driver-negative, PD-L1 low -> chemo-IO node
  const r = atNode("n_tx_nsclc_chemoio", { n_lh: ["sq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["none"], n_lpdl1: ["lowneg"] });
  assert.ok(r.ids.every(id => id.indexOf("pemetrexed") < 0), "no pemetrexed for squamous: " + r.ids.join(","));
  assert.ok(r.ids.indexOf("lung-keynote407") >= 0, "squamous chemo-IO = KEYNOTE-407");
  assert.ok(r.ids.indexOf("lung-keynote189") < 0, "KEYNOTE-189 (non-squamous) excluded for squamous");
  assert.ok(r.ids.indexOf("lung-cis-gemcitabine") >= 0, "gemcitabine applies to squamous");
});

test("non-squamous chemo-IO surfaces pemetrexed + KEYNOTE-189, excludes squamous-only regimens", () => {
  const r = atNode("n_tx_nsclc_chemoio", { n_lh: ["nsq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["none"], n_lpdl1: ["lowneg"] });
  assert.ok(r.ids.indexOf("lung-keynote189") >= 0, "non-squamous chemo-IO = KEYNOTE-189");
  assert.ok(r.ids.indexOf("lung-keynote407") < 0, "KEYNOTE-407 (squamous) excluded for non-squamous");
  assert.ok(r.ids.some(id => id.indexOf("pemetrexed") >= 0), "pemetrexed applies to non-squamous");
  assert.ok(r.ids.indexOf("lung-cis-gemcitabine") < 0, "gemcitabine (squamous) excluded for non-squamous");
});

test("resectable squamous surfaces platinum doublets, no pemetrexed", () => {
  const r = atNode("n_tx_nsclc_resectable", { n_lh: ["sq"], n_lnsclc_scenario: ["resectable"] });
  assert.ok(r.active);
  assert.ok(r.ids.every(id => id.indexOf("pemetrexed") < 0), "no pemetrexed for squamous resectable");
  assert.ok(r.ids.indexOf("lung-cis-gemcitabine") >= 0);
});

test("SCLC extensive-stage surfaces platinum-etoposide + checkpoint inhibitors", () => {
  const s = E.evaluate(G, { n_lh: ["sclc"], n_lsclc_stage: ["es"] });
  assert.equal(s.nodes.n_tx_sclc_es.status, "active");
  assert.equal(s.nodes.n_lnsclc_scenario.status, "disabled");   // NSCLC branch excluded for SCLC
  const r = atNode("n_tx_sclc_es", { n_lh: ["sclc"], n_lsclc_stage: ["es"] });
  assert.ok(r.ids.indexOf("sclc-platinum-etoposide") >= 0);
  assert.ok(r.ids.indexOf("sclc-atezolizumab") >= 0 || r.ids.indexOf("sclc-durvalumab") >= 0);
});

test("mesothelioma routes directly to its systemic options", () => {
  const s = E.evaluate(G, { n_lh: ["meso"] });
  assert.equal(s.nodes.n_tx_meso.status, "active");
  assert.equal(s.nodes.n_lnsclc_scenario.status, "disabled");
  assert.equal(s.nodes.n_lsclc_stage.status, "disabled");
  const r = atNode("n_tx_meso", { n_lh: ["meso"] });
  assert.ok(r.ids.indexOf("meso-cis-pemetrexed") >= 0);   // pemetrexed IS standard in mesothelioma (histology nc)
});

test("R1 C1: SQUAMOUS + EGFR+ still surfaces osimertinib (a driver TKI is histology-agnostic)", () => {
  const r = atNode("n_tx_nsclc_egfr", { n_lh: ["sq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["egfr"] });
  assert.ok(r.active);
  assert.deepEqual(r.ids, ["lung-osimertinib"], "osimertinib must NOT be excluded for squamous");
});

test("R1 C1: SQUAMOUS + ALK+ still surfaces ALK TKIs", () => {
  const r = atNode("n_tx_nsclc_alk", { n_lh: ["sq"], n_lnsclc_scenario: ["metastatic"], n_ldriver: ["alk"] });
  assert.ok(r.ids.indexOf("lung-alectinib") >= 0, "alectinib must NOT be excluded for squamous");
});

test("R1 I1: unresectable stage III surfaces the chemo doublets AND durvalumab consolidation", () => {
  const r = atNode("n_tx_nsclc_stage3", { n_lh: ["sq"], n_lnsclc_scenario: ["unresectable3"] });
  assert.ok(r.ids.indexOf("lung-durvalumab-consolidation") >= 0, "durvalumab consolidation");
  assert.ok(r.ids.indexOf("lung-cis-gemcitabine") >= 0, "squamous concurrent-chemoRT doublet (IIIA/IIIB) not dropped");
  assert.ok(r.ids.every(id => id.indexOf("pemetrexed") < 0), "still no pemetrexed for squamous");
});

test("stageToken collapses granular labels (IIIA/IIIB -> iii, IV -> iv, I -> i)", () => {
  assert.equal(R._stageToken("IIIA"), "iii");
  assert.equal(R._stageToken("IIIB"), "iii");
  assert.equal(R._stageToken("II"), "ii");
  assert.equal(R._stageToken("Stage IV (metastatic)"), "iv");
  assert.equal(R._stageToken("I (high-risk)"), "i");
  assert.equal(R._stageToken("limited-stage"), "limited-stage");
});

test("histology captured; matchDisease:false means diseaseId is not a matching criterion", () => {
  const s = E.evaluate(G, { n_lh: ["nsq"] });
  assert.equal(s.phenotype.histology, "non-squamous");
  assert.equal(s.phenotype.diseaseId, null);              // opted out (drifted lung diseaseId tags)
});
