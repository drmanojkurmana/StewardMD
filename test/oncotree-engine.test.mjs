/* ONCOTREE engine: deterministic pathway evaluation, disabledBy provenance, phenotype collection,
 * rebase, and search - exercised against the REAL breast navigator graph (kb/oncotree/breast.json).
 * Graph v1.1: HER2 status routes through an HR question in BOTH the HER2+ and HER2- branches. */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const E = require(join(ROOT, "oncotree-engine.js"));
const GRAPH = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/breast.json"), "utf8"));

const spine = { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"] };

test("start node is active, downstream unresolved before any answer", () => {
  const s = E.evaluate(GRAPH, {});
  assert.equal(s.nodes.n_histology.status, "active");
  assert.equal(s.nodes.n_stage.status, "unresolved");
  assert.equal(s.nodes.n_tx_her2_hrpos.status, "unresolved");
});

test("invasive -> stage spine activates; dcis branch disabled with provenance", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"] });
  assert.equal(s.nodes.n_stage.status, "active");
  assert.equal(s.nodes.n_dcis_er.status, "disabled");   // DCIS ER-status branch excluded for invasive
  assert.deepEqual(s.nodes.n_dcis_er.disabledBy.map(d => d.nodeId), ["n_histology"]);
});

test("DCIS ER-positive surfaces endocrine; ER-negative surfaces no systemic protocol", () => {
  const erpos = E.evaluate(GRAPH, { n_histology: ["dcis"], n_dcis_er: ["erpos"] });
  assert.equal(erpos.nodes.n_tx_dcis.status, "active");
  assert.equal(erpos.phenotype.biomarkers.HR, "positive");
  const erneg = E.evaluate(GRAPH, { n_histology: ["dcis"], n_dcis_er: ["erneg"] });
  assert.equal(erneg.nodes.n_tx_dcis.status, "active");
  assert.equal(erneg.phenotype.biomarkers.HR, "negative");   // ER- => tamoxifen will be excluded by recommend
});

test("HER2-low routes as HER2-negative (into the HR pathway), labeled distinctly", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s4"], n_setting: ["metastatic"], n_her2: ["low"] });
  assert.equal(s.nodes.n_hr2n.status, "active");        // HER2-low uses the HER2-negative HR question
  assert.equal(s.phenotype.biomarkers.HER2, "negative");
});

test("HER2 positive routes to the HER2+ HR question; the HER2-negative HR subtree is DISABLED", () => {
  const s = E.evaluate(GRAPH, Object.assign({}, spine, { n_her2: ["pos"] }));
  assert.equal(s.nodes.n_hr2p.status, "active");        // HER2+ HR question is the frontier
  assert.equal(s.nodes.n_hr2n.status, "disabled");      // HER2- HR question excluded
  assert.equal(s.nodes.n_hrpos.status, "disabled");
  assert.equal(s.nodes.n_tnbc.status, "disabled");
  const db = s.nodes.n_hr2n.disabledBy[0];
  assert.equal(db.nodeId, "n_her2");
  assert.deepEqual(db.answers, ["HER2 positive (IHC 3+ / ISH amplified)"]);
  assert.equal(s.nodes.n_tnbc.disabledBy[0].nodeId, "n_her2");   // root cause traced upstream
});

test("HER2 positive + HR positive (triple-positive) reaches the HER2+/HR+ node; captures HR", () => {
  const s = E.evaluate(GRAPH, Object.assign({}, spine, { n_her2: ["pos"], n_hr2p: ["pos"] }));
  assert.equal(s.nodes.n_tx_her2_hrpos.status, "active");
  assert.equal(s.nodes.n_tx_her2_hrneg.status, "disabled");
  assert.equal(s.phenotype.biomarkers.HER2, "positive");
  assert.equal(s.phenotype.biomarkers.HR, "positive");   // HR now captured for HER2+ disease (R1 fix)
});

test("HER2 positive + HR negative reaches the HER2+/HR- node", () => {
  const s = E.evaluate(GRAPH, Object.assign({}, spine, { n_her2: ["pos"], n_hr2p: ["neg"] }));
  assert.equal(s.nodes.n_tx_her2_hrneg.status, "active");
  assert.equal(s.nodes.n_tx_her2_hrpos.status, "disabled");
});

test("HER2 negative + HR positive routes to HR-positive treatment; TNBC disabled", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s4"], n_setting: ["metastatic"], n_her2: ["neg"], n_hr2n: ["pos"] });
  assert.equal(s.nodes.n_hr2n.status, "active");
  assert.equal(s.nodes.n_hrpos.status, "active");
  assert.equal(s.nodes.n_tnbc.status, "disabled");
  assert.equal(s.nodes.n_tx_her2_hrpos.status, "disabled");
});

test("HER2 negative + HR negative routes to TNBC", () => {
  const s = E.evaluate(GRAPH, Object.assign({}, spine, { n_her2: ["neg"], n_hr2n: ["neg"] }));
  assert.equal(s.nodes.n_tnbc.status, "active");
  assert.equal(s.nodes.n_hrpos.status, "disabled");
});

test("phenotype from active answered nodes; multi-key option sets setting+intent", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["metastatic"], n_her2: ["neg"], n_hr2n: ["pos"] });
  assert.equal(s.phenotype.diseaseId, "breast_cancer");
  assert.equal(s.phenotype.histology, "invasive breast carcinoma");
  assert.equal(s.phenotype.stage, "II");
  assert.equal(s.phenotype.setting, "metastatic");
  assert.equal(s.phenotype.intent, "palliative");
  assert.equal(s.phenotype.biomarkers.HER2, "negative");
  assert.equal(s.phenotype.biomarkers.HR, "positive");
});

test("never invents: an 'unknown' HER2 answer contributes nothing and disables both branches", () => {
  const s = E.evaluate(GRAPH, Object.assign({}, spine, { n_her2: ["unk"] }));
  assert.equal(s.phenotype.biomarkers.HER2, undefined);
  assert.equal(s.nodes.n_hr2p.status, "disabled");
  assert.equal(s.nodes.n_hr2n.status, "disabled");
});

test("required missing fields reported on the active frontier only", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"] });
  const ids = s.missingRequired.map(m => m.id);
  assert.ok(ids.indexOf("n_stage") >= 0);
  assert.ok(ids.indexOf("n_her2") < 0);                 // not yet active -> not flagged
});

test("rebase starts mid-graph and only flags required nodes on the active branch", () => {
  const s = E.evaluate(GRAPH, { n_her2: ["pos"], n_hr2p: ["pos"] }, { rebaseId: "n_her2" });
  assert.equal(s.nodes.n_her2.status, "active");
  assert.equal(s.nodes.n_tx_her2_hrpos.status, "active");
  assert.equal(s.startIds[0], "n_her2");
  // the HER2-negative HR question must NOT be reported missing (it is on an excluded branch)
  assert.ok(s.missingRequired.every(m => m.id !== "n_hr2n"));
});

test("deterministic + non-mutating", () => {
  const answers = Object.assign({}, spine, { n_her2: ["pos"], n_hr2p: ["pos"] });
  const frozen = JSON.stringify(answers);
  const a = E.evaluate(GRAPH, answers), b = E.evaluate(GRAPH, answers);
  assert.deepEqual(a.phenotype, b.phenotype);
  assert.equal(JSON.stringify(answers), frozen);
});

test("search finds nodes by text and groups by category", () => {
  const r = E.search(GRAPH, "HER2");
  assert.ok(r.all.some(h => h.id === "n_her2"));
  const r2 = E.search(GRAPH, "triple-negative");
  assert.ok(r2.groups.treatment.some(h => h.id === "n_tnbc"));
});

test("graph has no orphan links and every link endpoint exists", () => {
  const ids = new Set(GRAPH.nodes.map(n => n.id));
  for (const l of GRAPH.links) { assert.ok(ids.has(l.from), l.from); assert.ok(ids.has(l.to), l.to); }
});
