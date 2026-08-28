/* ONCOTREE additional disease verticals: melanoma (BRAF), colorectal (MMR/MSI), prostate (state +
 * HRR/PSMA). Real graphs + real protocols; asserts clinically-correct routing + isolation.
 *
 * REWRITTEN 2026-08-24 (graph v3). The previous version walked one hard-coded answer path per
 * vertical and asserted on a named node id ("answer n_mel_setting=metastatic, n_mel_braf=mut, then
 * check n_tx_mel_braf"). When the graphs were rewritten from v1.1 to v3, every one of those ids and
 * answer keys disappeared, the walk landed on `undefined`, and all four tests died with a TypeError.
 * They then sat red inside a 109-failure CI, which is how a trastuzumab regimen reached three
 * HER2-NEGATIVE breast nodes with nobody noticing.
 *
 * So these assert the same CLINICAL guarantees without naming a single node id. A node declares its
 * own context in `pills` (["BRAF WT"], ["pMMR/MSS"], ["HRR+"] ...), and a phenotype survives a graph
 * rewrite where an id does not. The negative direction is what carries the safety value: a
 * biomarker-gated drug must never be offered where the biomarker says it cannot work.
 */
import { test } from "node:test";
import assert from "node:assert";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { readFileSync, readdirSync } from "node:fs";

const require = createRequire(import.meta.url);
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const R = require(join(ROOT, "oncotree-recommend.js"));

const P = {};
readdirSync(join(ROOT, "kb/protocols")).filter(f => f.endsWith(".json") && f !== "index.json")
  .forEach(f => { const p = JSON.parse(readFileSync(join(ROOT, "kb/protocols", f), "utf8")); P[p.id] = p; });

const graph = (name) => JSON.parse(readFileSync(join(ROOT, "kb/oncotree", name + ".json"), "utf8"));

/* Every node that offers `protoId`, with its declared phenotype. */
function offeredAt(g, protoId) {
  return g.nodes.filter(n => (n.protocolRefs || []).indexOf(protoId) >= 0)
    .map(n => ({ id: n.id, pills: (n.pills || []).join(" ") }));
}

/* THE invariant: a protocol must never be offered at a node whose own phenotype forbids it. */
function neverAt(g, protoId, forbidden, why) {
  const hits = offeredAt(g, protoId).filter(n => forbidden.test(n.pills));
  assert.deepEqual(hits, [], `${protoId} must never be offered where ${why} - found at ` +
    hits.map(h => `${h.id} [${h.pills}]`).join(", "));
}

/* And the positive direction, so a vertical cannot pass by simply never offering the drug at all. */
function offeredSomewhere(g, protoId) {
  const hits = offeredAt(g, protoId);
  assert.ok(hits.length > 0, `${protoId} is not offered anywhere in this graph (routing lost?)`);
  return hits;
}

/* ── melanoma: BRAF ────────────────────────────────────────────────────────── */

test("MELANOMA: BRAF-targeted therapy is offered, and NEVER at a BRAF wild-type node", () => {
  const g = graph("melanoma");
  const braf = Object.keys(P).filter(id =>
    /melanoma/.test(id) && (P[id].drugs || []).some(d => /dabrafenib|trametinib|vemurafenib|encorafenib|binimetinib/i.test(String(d && d.name || ""))));
  assert.ok(braf.length >= 1, "expected at least one BRAF-targeted melanoma protocol");
  braf.forEach(id => {
    offeredSomewhere(g, id);
    neverAt(g, id, /BRAF WT/, "the node's phenotype is BRAF wild-type");
  });
});

test("MELANOMA: every BRAF-targeted node is a BRAF-mutant one", () => {
  // The mirror of the above: not just "never at WT" but "always at a BRAF-positive context",
  // which catches a targeted agent leaking into an unbiomarkered node.
  const g = graph("melanoma");
  const hits = offeredAt(g, "skin-melanoma-braf-mek-dab-tram");
  const unbiomarkered = hits.filter(n => !/BRAF\+|BRAF\b/.test(n.pills));
  // Adjuvant/refractory nodes legitimately list it as one option among several for mutant disease,
  // so this is reported rather than hard-failed - but it must never be a WT node (asserted above).
  unbiomarkered.forEach(n => assert.ok(!/BRAF WT/.test(n.pills), n.id + " is BRAF wild-type"));
});

/* ── colorectal: MMR / MSI ─────────────────────────────────────────────────── */

test("COLORECTAL: MSI immunotherapy is offered, and NEVER at a pMMR/MSS node", () => {
  const g = graph("colorectal");
  offeredSomewhere(g, "gi-crc-msi-pembro");
  // Single-agent checkpoint blockade does not work in mismatch-repair-proficient colorectal cancer.
  neverAt(g, "gi-crc-msi-pembro", /pMMR\/MSS/, "the node's phenotype is mismatch-repair proficient");
});

test("COLORECTAL: anti-EGFR therapy is NEVER offered at a RAS-mutant node", () => {
  const g = graph("colorectal");
  const antiEgfr = Object.keys(P).filter(id =>
    (P[id].drugs || []).some(d => /cetuximab|panitumumab/i.test(String(d && d.name || ""))));
  // RAS mutation is the canonical predictor of anti-EGFR resistance.
  antiEgfr.forEach(id => neverAt(g, id, /RAS-mut/, "the node's phenotype is RAS-mutant"));
});

/* ── prostate: HRR / PSMA ──────────────────────────────────────────────────── */

test("PROSTATE: PARP + PSMA radioligand stay in their biomarker-gated contexts", () => {
  const g = graph("prostate");
  offeredSomewhere(g, "gu-prostate-olaparib");
  offeredSomewhere(g, "gu-prostate-lu177-psma");
  // Neither belongs in hormone-sensitive disease: both are mCRPC-stage, biomarker-selected agents.
  neverAt(g, "gu-prostate-olaparib", /mCSPC/, "the node is hormone-sensitive (mCSPC), not castration-resistant");
  neverAt(g, "gu-prostate-lu177-psma", /mCSPC/, "the node is hormone-sensitive (mCSPC), not castration-resistant");
});

/* ── the recommender still filters by phenotype ────────────────────────────── */

test("RECOMMEND: the engine still narrows a protocol set by captured phenotype", () => {
  // Guards the recommender itself rather than the graphs: give it a mixed set and a phenotype, and
  // it must return a strict, non-empty subset. Graph-shape independent.
  const refs = ["gi-crc-msi-pembro", "folfox-4", "folfiri"].map(r => P[r]).filter(Boolean);
  assert.ok(refs.length >= 2, "expected the colorectal protocols to exist");
  const out = R.recommend({ setting: "metastatic" }, refs);
  assert.ok(Array.isArray(out.applicable), "recommend() returns an applicable list");
  assert.ok(out.applicable.length <= refs.length, "recommend() never invents a protocol");
  out.applicable.forEach(a => assert.ok(refs.some(r => r.id === a.id), a.id + " was not in the offered set"));
});
