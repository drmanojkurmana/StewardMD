/* ONCOTREE lung: driver routing, histology safety, SCLC / mesothelioma isolation.
 *
 * REWRITTEN 2026-08-24 (graph v3). The previous version walked hard-coded answer paths to named
 * nodes ("answer non-squamous + EGFR+, then check n_tx_nsclc_egfr"). Graph v3 renamed every one of
 * those ids, so 12 of 13 tests died on `undefined` - including the one labelled CLINICAL SAFETY.
 *
 * The clinical guarantees are unchanged, but they are now asserted where each one actually LIVES:
 *
 *   - histology safety (pemetrexed vs squamous) lives in the RECOMMENDER, which filters a protocol
 *     out by its declared histology. The lung graph carries no "squamous" pill, so this can only be
 *     tested through recommend() - and that is the real mechanism anyway.
 *   - agent isolation (SCLC / mesothelioma / driver TKIs) lives in the GRAPH's protocolRefs, and is
 *     asserted against each node's declared pills, which survive a rename where an id does not.
 *
 * No node id appears in this file.
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
const LUNG = JSON.parse(readFileSync(join(ROOT, "kb/oncotree/lung.json"), "utf8"));
const LUNG_DISEASE = (P["lung-carbo-pemetrexed"] || {}).diseaseId;

const drugsOf = (id) => (P[id].drugs || []).map(d => String(d && d.name || "")).join(" ");
const byDrug = (re) => Object.keys(P).filter(id => re.test(drugsOf(id)));
const applicable = (pheno, ids) =>
  R.recommend(pheno, ids.map(i => P[i]).filter(Boolean)).applicable.map(a => a.id);

/* Every node offering `protoId`, with its declared phenotype. */
const offeredAt = (g, protoId) => g.nodes
  .filter(n => (n.protocolRefs || []).indexOf(protoId) >= 0)
  .map(n => ({ id: n.id, pills: (n.pills || []).join(" ") }));

/* ── the safety invariant, at the mechanism that enforces it ───────────────── */

test("CLINICAL SAFETY: pemetrexed is NEVER recommended for squamous disease", () => {
  // Pemetrexed is restricted to non-squamous NSCLC; offering it for squamous histology is both
  // ineffective and toxic. The protocols declare that restriction and recommend() must honour it.
  const pem = byDrug(/pemetrexed/i).filter(id => (P[id].diseaseId === LUNG_DISEASE));
  assert.ok(pem.length >= 2, "expected the lung pemetrexed protocols to exist");
  const offered = pem.concat(["lung-carbo-paclitaxel"]).filter(id => P[id]);

  const squam = applicable({ diseaseId: LUNG_DISEASE, histology: "squamous" }, offered);
  pem.forEach(id => assert.ok(squam.indexOf(id) < 0,
    id + " (pemetrexed) must not be recommended for squamous histology; got: " + squam.join(", ")));

  const nonSquam = applicable({ diseaseId: LUNG_DISEASE, histology: "non-squamous" }, offered);
  assert.ok(pem.some(id => nonSquam.indexOf(id) >= 0),
    "and it MUST still be recommended for non-squamous, or the filter is just rejecting everything");
});

test("CLINICAL SAFETY: the squamous filter is histology-specific, not a blanket exclusion", () => {
  // Guards against a filter that passes the test above by excluding every protocol.
  const offered = ["lung-carbo-paclitaxel", "lung-carbo-pemetrexed"].filter(id => P[id]);
  const squam = applicable({ diseaseId: LUNG_DISEASE, histology: "squamous" }, offered);
  assert.ok(squam.indexOf("lung-carbo-paclitaxel") >= 0,
    "a squamous-appropriate doublet must survive the same filter");
});

test("R1 C1: a driver TKI is histology-agnostic - squamous + EGFR+ still reaches osimertinib", () => {
  // A driver mutation outranks histology: squamous EGFR-mutant disease still gets the TKI.
  // NOTE the diseaseId: the lung protocol library carries BOTH "nsclc" and "neoplasms_of_the_lung"
  // tags (the drift the lung graph's matchDisease:false exists for), so each protocol is matched
  // against its OWN diseaseId rather than one hard-coded for the whole vertical.
  const osi = P["lung-osimertinib"];
  assert.ok(osi, "expected lung-osimertinib to exist");
  const out = applicable({ diseaseId: osi.diseaseId, histology: "squamous", biomarkers: { EGFR: "positive" } },
    ["lung-osimertinib"]);
  assert.deepEqual(out, ["lung-osimertinib"], "a driver TKI must not be filtered out by squamous histology");
});

test("the lung protocol library carries drifted diseaseId tags, which is why the graph sets matchDisease:false", () => {
  // Records the reason the test above cannot use a single diseaseId. If the library is ever
  // normalised to one tag, this fails and both this test and the graph flag can be revisited.
  const tags = new Set(Object.keys(P)
    .filter(id => /^lung-|^sclc-|^meso-/.test(id))
    .map(id => P[id].diseaseId).filter(Boolean));
  assert.ok(tags.size > 1, "expected >1 diseaseId tag across the lung protocols; got " + [...tags].join(", "));
  assert.equal(LUNG.matchDisease, false, "so the lung graph must opt out of diseaseId matching");
});

/* ── agent isolation, asserted against the node's own phenotype ────────────── */

function neverAt(protoId, forbidden, why) {
  const hits = offeredAt(LUNG, protoId).filter(n => forbidden.test(n.pills));
  assert.deepEqual(hits, [], `${protoId} must never be offered where ${why} - found at ` +
    hits.map(h => `${h.id} [${h.pills}]`).join(", "));
}
function offeredSomewhere(protoId) {
  assert.ok(offeredAt(LUNG, protoId).length > 0, protoId + " is offered nowhere in the lung graph (routing lost?)");
}

test("SCLC protocols never appear at a mesothelioma node, and vice versa", () => {
  ["sclc-platinum-etoposide", "sclc-atezolizumab", "sclc-topotecan"].filter(id => P[id]).forEach(id => {
    offeredSomewhere(id);
    neverAt(id, /mesothelioma/, "the node is mesothelioma");
  });
  ["meso-cis-pemetrexed", "meso-nivo-ipi"].filter(id => P[id]).forEach(id => {
    offeredSomewhere(id);
    neverAt(id, /\bSCLC\b/, "the node is small-cell");
  });
});

test("single-agent pembrolizumab stays in the PD-L1-high context", () => {
  offeredSomewhere("lung-pembro-mono");
  // Single-agent checkpoint blockade requires high PD-L1 expression; a PD-L1-low node must not
  // offer it (those patients get chemo-immunotherapy instead).
  neverAt("lung-pembro-mono", /PD-L1 low/, "the node's phenotype is PD-L1 low");
});

test("driver TKIs are not offered at driver-negative nodes", () => {
  ["lung-osimertinib", "lung-alectinib"].filter(id => P[id]).forEach(id => {
    offeredSomewhere(id);
    neverAt(id, /driver-neg/, "the node's phenotype is driver-negative");
  });
});

/* ── the recommender's own helpers ─────────────────────────────────────────── */

test("stageToken collapses granular labels (IIIA/IIIB -> iii, IV -> iv, I -> i)", () => {
  assert.equal(R._stageToken("IIIA"), "iii");
  assert.equal(R._stageToken("IIIB"), "iii");
  assert.equal(R._stageToken("IV"), "iv");
  assert.equal(R._stageToken("I"), "i");
});

test("recommend never invents a protocol that was not offered", () => {
  const offered = ["lung-carbo-paclitaxel", "lung-osimertinib"].filter(id => P[id]);
  const out = R.recommend({ diseaseId: LUNG_DISEASE, histology: "squamous" }, offered.map(i => P[i]));
  out.applicable.forEach(a => assert.ok(offered.indexOf(a.id) >= 0, a.id + " was never offered"));
  assert.ok(out.applicable.length <= offered.length);
});

test("every recommendation is flagged as requiring physician review", () => {
  // ONCOTREE is decision support: nothing it returns may read as an approved order.
  const out = R.recommend({ diseaseId: LUNG_DISEASE }, ["lung-carbo-paclitaxel"].map(i => P[i]).filter(Boolean));
  assert.ok(out.applicable.length >= 1, "expected at least one applicable protocol");
  out.applicable.forEach(a => {
    assert.ok(/review required|decision support|not auto-selected/i.test(a.rationale || ""),
      a.id + " rationale must state that physician review is required: " + (a.rationale || "").slice(0, 120));
  });
});
