/* ONCOTREE additional disease verticals: melanoma (BRAF), colorectal (MMR/MSI), prostate (state +
 * HRR/PSMA). Real graphs + real protocols; asserts clinically-correct routing + isolation. */
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
function at(guideline, nodeId, answers) {
  const g = JSON.parse(readFileSync(join(ROOT, "kb/oncotree", guideline + ".json"), "utf8"));
  const byId = {}; g.nodes.forEach(n => (byId[n.id] = n));
  const s = E.evaluate(g, answers);
  const refs = (byId[nodeId].protocolRefs || []).map(r => P[r]).filter(Boolean);
  return { active: s.nodes[nodeId].status === "active", ids: R.recommend(s.phenotype, refs).applicable.map(a => a.id) };
}

test("MELANOMA: BRAF-mutant surfaces targeted + immunotherapy; wild-type surfaces only immunotherapy", () => {
  const braf = at("melanoma", "n_tx_mel_braf", { n_mel_setting: ["metastatic"], n_mel_braf: ["mut"] });
  assert.ok(braf.active && braf.ids.indexOf("skin-melanoma-braf-mek-dab-tram") >= 0);
  const wt = at("melanoma", "n_tx_mel_io", { n_mel_setting: ["metastatic"], n_mel_braf: ["wt"] });
  assert.ok(wt.ids.indexOf("skin-melanoma-braf-mek-dab-tram") < 0, "no BRAF-targeted therapy for wild-type");
  assert.ok(wt.ids.indexOf("skin-melanoma-nivo-ipi") >= 0);
});
test("MELANOMA: adjuvant excludes metastatic-only nivo-ipi", () => {
  const adj = at("melanoma", "n_tx_mel_io", { n_mel_setting: ["adjuvant"], n_mel_braf: ["wt"] });
  assert.ok(adj.ids.indexOf("skin-melanoma-nivo-ipi") < 0, "nivo-ipi is metastatic-only");
  assert.ok(adj.ids.indexOf("skin-melanoma-nivolumab") >= 0);
});

test("COLORECTAL: adjuvant FOLFOX; metastatic dMMR->pembro; MSS->chemo backbones", () => {
  assert.deepEqual(at("colorectal", "n_tx_crc_adjuvant", { n_crc_setting: ["adjuvant"] }).ids.sort(), ["folfox-4", "modified-folfox-6"]);
  assert.deepEqual(at("colorectal", "n_tx_crc_msi", { n_crc_setting: ["metastatic"], n_crc_msi: ["dmmr"] }).ids, ["gi-crc-msi-pembro"]);
  const mss = at("colorectal", "n_tx_crc_mss", { n_crc_setting: ["metastatic"], n_crc_msi: ["pmmr"] });
  assert.ok(mss.ids.indexOf("folfox-4") >= 0 && mss.ids.indexOf("folfiri") >= 0);
  assert.ok(mss.ids.indexOf("gi-crc-msi-pembro") < 0, "immunotherapy not surfaced for MSS");
});

test("PROSTATE: state + mCRPC biomarker options each surface their protocols", () => {
  assert.deepEqual(at("prostate", "n_tx_prostate_localized", { n_prostate_state: ["localized"] }).ids, ["gu-prostate-adt"]);
  assert.deepEqual(at("prostate", "n_tx_prostate_parp", { n_prostate_state: ["mcrpc"], n_prostate_mcrpc_opt: ["hrr"] }).ids, ["gu-prostate-olaparib"]);
  assert.deepEqual(at("prostate", "n_tx_prostate_lu177", { n_prostate_state: ["mcrpc"], n_prostate_mcrpc_opt: ["psma"] }).ids, ["gu-prostate-lu177-psma"]);
  const std = at("prostate", "n_tx_prostate_mcrpc_std", { n_prostate_state: ["mcrpc"], n_prostate_mcrpc_opt: ["standard"] });
  assert.ok(std.ids.indexOf("gu-prostate-abiraterone") >= 0 && std.ids.indexOf("gu-prostate-olaparib") < 0);
});

test("all 5 disease graphs load with a title, diseaseId, and start node", () => {
  ["breast", "lung", "colorectal", "prostate", "melanoma"].forEach(g => {
    const graph = JSON.parse(readFileSync(join(ROOT, "kb/oncotree", g + ".json"), "utf8"));
    assert.ok(graph.title && graph.diseaseId && graph.startNodeIds.length >= 1, g);
  });
});
