/* ONCOTREE wave-2 verticals: head&neck, ovarian, upper-GI, RCC, bladder, testicular, myeloma, thyroid.
 * Real graphs + real protocols; asserts each key branch surfaces its clinically-correct protocols. */
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
const has = (r, id) => r.active && r.ids.indexOf(id) >= 0;

test("HEAD & NECK: locoregional -> chemoRT; recurrent/metastatic CPS+ -> immunotherapy", () => {
  assert.ok(has(at("headneck", "n_tx_hn_locoregional", { n_hn_setting: ["locoregional"] }), "hn-cisplatin-rt"));
  assert.ok(has(at("headneck", "n_tx_hn_io", { n_hn_setting: ["rm"], n_hn_pdl1: ["cpspos"] }), "hn-pembro-mono"));
});
test("OVARIAN: primary chemo; HRD+ maintenance -> PARP", () => {
  assert.ok(has(at("ovarian", "n_tx_ov_primary", { n_ov_phase: ["primary"] }), "gyn-carbo-paclitaxel"));
  assert.ok(has(at("ovarian", "n_tx_ov_hrd", { n_ov_phase: ["maintenance"], n_ov_hrd: ["hrd"] }), "gyn-olaparib-maint"));
});
test("UPPER-GI: gastric resectable FLOT; esophageal chemoRT", () => {
  assert.ok(has(at("uppergi", "n_tx_ugi_gastric_resect", { n_ugi_site: ["gastric"], n_ugi_gastric_setting: ["resectable"] }), "gi-flot"));
  assert.ok(has(at("uppergi", "n_tx_ugi_esophageal", { n_ugi_site: ["esophageal"] }), "gi-esophageal-crt-cross"));
});
test("RCC: IO-combination vs TKI monotherapy", () => {
  assert.ok(has(at("rcc", "n_tx_rcc_io", { n_rcc_approach: ["iocombo"] }), "gu-rcc-nivo-ipi"));
  assert.ok(has(at("rcc", "n_tx_rcc_tki", { n_rcc_approach: ["tki"] }), "gu-rcc-cabozantinib"));
});
test("BLADDER: muscle-invasive platinum; metastatic maintenance avelumab; later EV", () => {
  assert.ok(has(at("bladder", "n_tx_bl_mibc", { n_bl_setting: ["mibc"] }), "gu-uro-gem-cisplatin"));
  assert.ok(has(at("bladder", "n_tx_bl_maint", { n_bl_setting: ["metastatic"], n_bl_line: ["maint"] }), "gu-uro-avelumab-maintenance"));
  assert.ok(has(at("bladder", "n_tx_bl_later", { n_bl_setting: ["metastatic"], n_bl_line: ["later"] }), "gu-uro-enfortumab-vedotin"));
});
test("TESTICULAR: seminoma stage I carboplatin; NSGCT poor-risk VIP-capable", () => {
  assert.ok(has(at("testicular", "n_tx_test_sem_early", { n_test_hist: ["seminoma"], n_test_sem_stage: ["early"] }), "gu-seminoma-carboplatin"));
  assert.ok(has(at("testicular", "n_tx_test_nsgct_poor", { n_test_hist: ["nsgct"], n_test_nsgct_risk: ["poor"] }), "gu-testicular-vip"));
});
test("MYELOMA: newly-diagnosed induction; relapsed pomalidomide", () => {
  assert.ok(has(at("myeloma", "n_tx_mm_nd", { n_mm_phase: ["nd"] }), "heme-mm-vrd"));
  assert.ok(has(at("myeloma", "n_tx_mm_relapsed", { n_mm_phase: ["relapsed"] }), "heme-mm-pomalidomide-dex"));
});
test("THYROID: anaplastic BRAF+ -> dab-tram; medullary -> selpercatinib; BRAF-wt anaplastic pending", () => {
  assert.ok(has(at("thyroid", "n_tx_thy_anaplastic", { n_thy_type: ["anaplastic"], n_thy_anaplastic_braf: ["brafmut"] }), "thyroid-anaplastic-dab-tram"));
  assert.ok(has(at("thyroid", "n_tx_thy_medullary", { n_thy_type: ["medullary"] }), "thyroid-medullary-selpercatinib"));
  const wt = E.evaluate(JSON.parse(readFileSync(join(ROOT, "kb/oncotree/thyroid.json"), "utf8")), { n_thy_type: ["anaplastic"], n_thy_anaplastic_braf: ["brafwt"] });
  assert.notEqual(wt.nodes.n_tx_thy_anaplastic.status, "active");   // BRAF-wt anaplastic: no route (honest gap)
});
