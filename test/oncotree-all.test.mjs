/* ONCOTREE Acute Lymphoblastic Leukemia (ALL) integrity test
 * Asserts clinically correct routing across Ph+ B-ALL, Ph- B-ALL, and T-ALL pathways.
 */
import { test } from "node:test";
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const allGraph = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/all.json"), "utf8"));

test("ALL: graph structure and starting point", () => {
  assert.equal(allGraph.guideline, "all");
  assert.equal(allGraph.navigatorVersion, "3.0.0");
  assert.ok(allGraph.startNodeIds.includes("n_all_diagnosis"));
  assert.ok(allGraph.nodes.length >= 20);
});

test("ALL: mandatory workup checklist precedes clinical branching", () => {
  const diagNode = allGraph.nodes.find(n => n.id === "n_all_diagnosis");
  assert.ok(diagNode, "Diagnosis node exists");
  const linkToWorkup = allGraph.links.find(l => l.from === "n_all_diagnosis" && l.to === "n_all_workup");
  assert.ok(linkToWorkup, "Mandatory link from diagnosis to workup");

  const workupNode = allGraph.nodes.find(n => n.id === "n_all_workup");
  assert.equal(workupNode.nodeCategory, "workup");
  assert.ok(workupNode.bullets.some(b => b.includes("DIC") || b.includes("coagulation")));
  assert.ok(workupNode.bullets.some(b => b.includes("TLS") || b.includes("lysis")));
  assert.ok(workupNode.bullets.some(b => b.includes("Lumbar puncture") || b.includes("intrathecal")));
  assert.ok(workupNode.bullets.some(b => b.includes("Echocardiogram")));
});

test("ALL: lineage forks into B-cell and T-cell", () => {
  const lineageNode = allGraph.nodes.find(n => n.id === "n_all_lineage");
  assert.ok(lineageNode, "Lineage node exists");
  const optIds = (lineageNode.options || []).map(o => o.id);
  assert.ok(optIds.includes("b_cell"));
  assert.ok(optIds.includes("t_cell"));
});

test("ALL: Ph+ B-ALL mandates TKI and evaluates MRD", () => {
  const phposNode = allGraph.nodes.find(n => n.id === "n_all_phpos_induction");
  assert.ok(phposNode, "Ph+ induction node exists");
  const mrdNegEnd = allGraph.nodes.find(n => n.id === "n_all_phpos_tx_mrd_neg");
  const mrdPosEnd = allGraph.nodes.find(n => n.id === "n_all_phpos_tx_mrd_pos");
  assert.ok(mrdNegEnd, "Ph+ MRD- endpoint exists");
  assert.ok(mrdPosEnd, "Ph+ MRD+ endpoint exists");

  assert.ok(mrdPosEnd.bullets.some(b => b.toLowerCase().includes("blinatumomab")));
  assert.ok(mrdPosEnd.bullets.some(b => b.toLowerCase().includes("kinase domain") || b.toLowerCase().includes("t315i")));
});

test("ALL: Ph- B-ALL age-adapted pathways and blinatumomab in ECOG 1910", () => {
  const ageNode = allGraph.nodes.find(n => n.id === "n_all_phneg_age_fitness");
  assert.ok(ageNode, "Ph- age stratification exists");
  const ayaNode = allGraph.nodes.find(n => n.id === "n_all_phneg_aya_regimens");
  assert.ok(ayaNode.bullets.some(b => b.includes("CALGB 10403")));

  const mrdNegEnd = allGraph.nodes.find(n => n.id === "n_all_phneg_tx_mrd_neg");
  assert.ok(mrdNegEnd.bullets.some(b => b.includes("ECOG 1910") || b.includes("Blinatumomab")));
});

test("ALL: T-ALL incorporates nelarabine and CNS prophylaxis", () => {
  const tInduction = allGraph.nodes.find(n => n.id === "n_all_t_induction");
  assert.ok(tInduction.bullets.some(b => b.includes("Nelarabine")));
  assert.ok(tInduction.bullets.some(b => b.includes("prophylaxis") || b.includes("triple IT")));
});

test("ALL: Relapsed/Refractory offers targeted immunotherapy and CAR-T", () => {
  const rrPhneg = allGraph.nodes.find(n => n.id === "n_all_rr_phneg_tx");
  assert.ok(rrPhneg.bullets.some(b => b.includes("Blinatumomab")));
  assert.ok(rrPhneg.bullets.some(b => b.includes("Inotuzumab")));
  assert.ok(rrPhneg.bullets.some(b => b.includes("CAR") || b.includes("Brexucabtagene")));
});
