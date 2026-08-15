/* ONCOTREE engine: deterministic pathway evaluation, disabledBy provenance, phenotype collection,
 * rebase, and search - exercised against the REAL breast navigator graph (kb/oncotree/breast.json). */
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

test("start node is active, downstream unresolved before any answer", () => {
  const s = E.evaluate(GRAPH, {});
  assert.equal(s.nodes.n_histology.status, "active");
  assert.equal(s.nodes.n_stage.status, "unresolved");     // reachable but source unanswered
  assert.equal(s.nodes.n_tx_her2.status, "unresolved");
});

test("invasive -> stage -> setting activates the spine; dcis branch stays inactive", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"] });
  assert.equal(s.nodes.n_stage.status, "active");
  assert.equal(s.nodes.n_dcis.status, "disabled");        // dcis link is false (answered invasive)
  assert.deepEqual(s.nodes.n_dcis.disabledBy.map(d => d.nodeId), ["n_histology"]);
});

test("HER2 positive: HER2 branch active, HER2-negative subtree DISABLED with disabledBy provenance", () => {
  const answers = { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["pos"] };
  const s = E.evaluate(GRAPH, answers);
  assert.equal(s.nodes.n_tx_her2.status, "active");        // HER2-positive treatment reached
  assert.equal(s.nodes.n_hr.status, "disabled");           // HER2-negative HR branch excluded
  assert.equal(s.nodes.n_hrpos.status, "disabled");
  assert.equal(s.nodes.n_tnbc.status, "disabled");
  // disabledBy names the responsible decision (HER2 = positive), not a raw node id only
  const db = s.nodes.n_hr.disabledBy[0];
  assert.equal(db.nodeId, "n_her2");
  assert.deepEqual(db.answers, ["HER2 positive (IHC 3+ / ISH amplified)"]);
  // and it propagates to the deeper excluded nodes (root cause traced upstream)
  assert.equal(s.nodes.n_tnbc.disabledBy[0].nodeId, "n_her2");
});

test("HER2 negative + HR positive routes to the HR-positive treatment; TNBC disabled", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s4"], n_setting: ["metastatic"], n_her2: ["neg"], n_hr: ["pos"] });
  assert.equal(s.nodes.n_tx_her2.status, "disabled");
  assert.equal(s.nodes.n_hr.status, "active");
  assert.equal(s.nodes.n_hrpos.status, "active");
  assert.equal(s.nodes.n_tnbc.status, "disabled");
  assert.equal(s.nodes.n_tnbc.disabledBy[0].nodeId, "n_hr");
});

test("HER2 negative + HR negative routes to TNBC", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["neoadjuvant"], n_her2: ["neg"], n_hr: ["neg"] });
  assert.equal(s.nodes.n_tnbc.status, "active");
  assert.equal(s.nodes.n_hrpos.status, "disabled");
});

test("phenotype is collected only from active, answered nodes; multi-key option sets setting+intent", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["metastatic"], n_her2: ["neg"], n_hr: ["pos"] });
  assert.equal(s.phenotype.diseaseId, "breast_cancer");
  assert.equal(s.phenotype.histology, "invasive breast carcinoma");
  assert.equal(s.phenotype.stage, "II");
  assert.equal(s.phenotype.setting, "metastatic");
  assert.equal(s.phenotype.intent, "palliative");         // set by the same option as setting
  assert.equal(s.phenotype.biomarkers.HER2, "negative");
  assert.equal(s.phenotype.biomarkers.HR, "positive");
});

test("never invents: an 'unknown' option contributes nothing to the phenotype", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["adjuvant"], n_her2: ["unk"] });
  assert.equal(s.phenotype.biomarkers.HER2, undefined);   // unknown sets nothing
  // HER2 answered-as-unknown => its outbound links are false (no pos/neg), so both branches disabled,
  // not silently guessed
  assert.equal(s.nodes.n_tx_her2.status, "disabled");
  assert.equal(s.nodes.n_hr.status, "disabled");
});

test("required missing fields are reported on the active frontier", () => {
  const s = E.evaluate(GRAPH, { n_histology: ["invasive"] });
  const ids = s.missingRequired.map(m => m.id);
  assert.ok(ids.indexOf("n_stage") >= 0);                 // stage is active + required + unanswered
});

test("rebase starts the pathway mid-graph (Start Here)", () => {
  const s = E.evaluate(GRAPH, { n_her2: ["pos"] }, { rebaseId: "n_her2" });
  assert.equal(s.nodes.n_her2.status, "active");
  assert.equal(s.nodes.n_tx_her2.status, "active");
  assert.equal(s.startIds[0], "n_her2");
});

test("deterministic + non-mutating", () => {
  const answers = { n_histology: ["invasive"], n_stage: ["s2"], n_setting: ["adjuvant"], n_her2: ["pos"] };
  const frozen = JSON.stringify(answers);
  const a = E.evaluate(GRAPH, answers), b = E.evaluate(GRAPH, answers);
  assert.deepEqual(a.phenotype, b.phenotype);
  assert.deepEqual(Object.keys(a.nodes).map(k => a.nodes[k].status), Object.keys(b.nodes).map(k => b.nodes[k].status));
  assert.equal(JSON.stringify(answers), frozen);          // input untouched
});

test("search finds nodes by text and groups by category", () => {
  const r = E.search(GRAPH, "HER2");
  assert.ok(r.all.length >= 1);
  assert.ok(r.all.some(h => h.id === "n_her2"));
  const r2 = E.search(GRAPH, "triple-negative");
  assert.ok(r2.groups.treatment.some(h => h.id === "n_tnbc"));
});

test("graph has no orphan links and every link endpoint exists", () => {
  const ids = new Set(GRAPH.nodes.map(n => n.id));
  for (const l of GRAPH.links) { assert.ok(ids.has(l.from), l.from); assert.ok(ids.has(l.to), l.to); }
});
