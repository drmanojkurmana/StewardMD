/* StewardMD KB — RAG-ready index builder (Phase 4, AI-ready / no AI)
 *
 * Emits kb/dist/kb.index.json: a flat array of ADDRESSABLE, individually-citable
 * knowledge chunks assembled from the existing KB (disease knowledge + Harrison
 * enrichment + treatment recommendations). This is the substrate a future
 * embedding/RAG pipeline indexes and a future Gemini explainer retrieves over —
 * it integrates NO AI and calls NO network. Every chunk carries:
 *   { chunkId, diseaseId, diseaseName, class, system, section, text,
 *     source:{ref,page}, crossLinks:[diseaseId], drugRefs:[composition],
 *     embedding:null }
 * embedding is ALWAYS null here (populated later by the embedding step).
 *
 * Knowledge is NOT duplicated or rewritten — chunks are derived from fields that
 * already exist in the KB. Pharmacology is referenced by `composition` only
 * (the Drug Index stays the single pharmacology DB). Pure data transform.
 *
 * USAGE: node kb/tools/build-kb-index.mjs            (writes kb/dist/kb.index.json)
 *        node kb/tools/build-kb-index.mjs --stdout   (print stats only)
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DZDIR = join(ROOT, "kb", "diseases");
const TXDIR = join(ROOT, "kb", "treatments");
const REFDIR = join(ROOT, "kb", "reference");
const OUT = join(ROOT, "kb", "dist", "kb.index.json");

const ids = readdirSync(DZDIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
const refIds = existsSync(REFDIR) ? readdirSync(REFDIR).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")) : [];
// cross-links resolve against BOTH diagnostic and reference disease ids
const realIds = new Set(ids.concat(refIds));
const lc = {}; ids.concat(refIds).forEach((i) => (lc[i.toLowerCase()] = i));
const resolveLinks = (arr) => [...new Set((arr || [])
  .map((x) => lc[String(x).toLowerCase()]).filter((x) => x && realIds.has(x)))];

const chunks = [];
let nDz = 0, nTx = 0, nRef = 0;
function push(d, section, text, source, extra) {
  if (!text || !String(text).trim()) return;
  chunks.push(Object.assign({
    chunkId: d.id + "#" + section + "#" + (chunks.filter((c) => c.diseaseId === d.id && c.section === section).length + 1),
    diseaseId: d.id, diseaseName: d.name, class: d.class, system: d.system || null,
    section, text: String(text).trim(),
    source: source || { ref: (d.provenance && d.provenance.primaryRef) || "StewardMD KB", page: null },
    crossLinks: [], drugRefs: [], embedding: null,
  }, extra || {}));
}

for (const id of ids) {
  const d = JSON.parse(readFileSync(join(DZDIR, id + ".json"), "utf8"));
  nDz++;
  const baseSrc = { ref: (d.provenance && d.provenance.primaryRef) || "Harrison 22e", page: null };

  // ---- curated knowledge (existing fields, not rewritten) ----
  const overview = [d.name, d.class === "infective" ? "(infective)" : "(non-infective)",
    d.system ? "— " + d.system : "", (d.aliases || []).length ? "Also: " + d.aliases.join(", ") : ""]
    .filter(Boolean).join(" ");
  push(d, "overview", overview, baseSrc, { crossLinks: resolveLinks(d.differentials), drugRefs: d.drugRefs || [] });
  if (d.matching && d.matching.reasoningTemplate) push(d, "reasoning", d.matching.reasoningTemplate, baseSrc);
  if (d.pathogens) {
    const pg = ["veryLikely", "likely", "possible"].map((t) => (d.pathogens[t] || []).length ? t + ": " + d.pathogens[t].join(", ") : "").filter(Boolean).join("; ");
    push(d, "pathogens", pg, baseSrc);
  }
  if ((d.mimics || []).length) push(d, "mimics", "Mimics: " + d.mimics.join(", "), baseSrc, { crossLinks: resolveLinks(d.mimics) });
  if ((d.redFlags || []).length) push(d, "redFlags", "Red flags: " + d.redFlags.join("; "), baseSrc);
  (d.investigations || []).forEach((iv) => push(d, "investigation", iv.test + (iv.why ? " — " + iv.why : ""), baseSrc));

  // ---- Harrison enrichment (paraphrased, page-cited) ----
  const h = d.enrichment && d.enrichment.harrison;
  if (h) {
    const hSrc = (pg) => ({ ref: h.source || "Harrison 22e", page: pg || h.pages || null });
    (h.clinicalPearls || []).forEach((t) => push(d, "harrison.pearl", t, hSrc()));
    if (h.pathophysiology) push(d, "harrison.pathophysiology", h.pathophysiology, hSrc());
    (h.additionalDifferentials || []).forEach((t) => push(d, "harrison.differential", t, hSrc()));
    (h.infectionMimics || []).forEach((t) => push(d, "harrison.infectionMimic", t, hSrc()));
    (h.nonInfectiousMimics || []).forEach((t) => push(d, "harrison.nonInfectiousMimic", t, hSrc()));
    (h.additionalInvestigations || []).forEach((t) => push(d, "harrison.investigation", t, hSrc()));
    (h.redFlags || []).forEach((t) => push(d, "harrison.redFlag", t, hSrc()));
    if (h.prognosis) push(d, "harrison.prognosis", h.prognosis, hSrc());
    (h.pitfalls || []).forEach((t) => push(d, "harrison.pitfall", t, hSrc()));
    if (h.severityClassification) push(d, "harrison.severity", h.severityClassification, hSrc());
    if (h.crossLinks && h.crossLinks.length) {
      // attach enrichment cross-links onto the overview chunk
      const ov = chunks.find((c) => c.diseaseId === d.id && c.section === "overview");
      if (ov) ov.crossLinks = [...new Set(ov.crossLinks.concat(resolveLinks(h.crossLinks)))];
    }
  }

  // ---- treatment recommendations (reference pharmacology by composition only) ----
  const tp = join(TXDIR, id + ".json");
  if (existsSync(tp)) {
    const t = JSON.parse(readFileSync(tp, "utf8"));
    nTx++;
    const prec = (t.precedence || []).join(" ▸ ");
    (t.recommendations || []).forEach((r) => {
      const drugs = (r.drugRefs || []).map((x) => x.regimenLabel || x.composition).filter(Boolean);
      const comps = (r.drugRefs || []).map((x) => x.composition).filter(Boolean);
      const why = (r.drugRefs || []).map((x) => x.why).filter(Boolean)[0] || "";
      const txt = [r.tier ? "[" + r.tier + "]" : "", r.line || "", drugs.length ? "→ " + drugs.join(" / ") : "", why].filter(Boolean).join(" ");
      push(d, "treatment", txt, { ref: (r.evidence && r.evidence.ref) || (r.tier === "icmr" ? "ICMR AMRSN 2024" : "guideline"), page: null },
        { drugRefs: comps, precedence: prec || null });
    });
  }
}

// ---- REFERENCE diseases (kb/reference): the broader Harrison disease universe,
// KNOWLEDGE-only (no treatment/scoring). Same citable-chunk shape, tagged
// referenceOnly so retrieval can distinguish them from diagnostic diseases. ----
for (const id of refIds) {
  const d = JSON.parse(readFileSync(join(REFDIR, id + ".json"), "utf8"));
  nRef++;
  const h = d.harrison || d.reference || {};   // `reference` = source-neutral key (Nelson/Parsons/etc.)
  const src = () => ({ ref: h.source || "Harrison 22e", page: h.pages || (d.page ? "p." + d.page : null) });
  const tag = { referenceOnly: true };
  const overview = [d.name, d.class === "infective" ? "(infective)" : "(non-infective)",
    d.system ? "— " + d.system : "", (d.aliases || []).length ? "Also: " + d.aliases.join(", ") : ""]
    .filter(Boolean).join(" ");
  push(d, "overview", overview, src(), Object.assign({ crossLinks: resolveLinks(h.crossLinks) }, tag));
  (h.clinicalPearls || []).forEach((t) => push(d, "harrison.pearl", t, src(), tag));
  if (h.pathophysiology) push(d, "harrison.pathophysiology", h.pathophysiology, src(), tag);
  (h.additionalDifferentials || []).forEach((t) => push(d, "harrison.differential", t, src(), tag));
  (h.infectionMimics || []).forEach((t) => push(d, "harrison.infectionMimic", t, src(), tag));
  (h.nonInfectiousMimics || []).forEach((t) => push(d, "harrison.nonInfectiousMimic", t, src(), tag));
  (h.additionalInvestigations || []).forEach((t) => push(d, "harrison.investigation", t, src(), tag));
  (h.redFlags || []).forEach((t) => push(d, "harrison.redFlag", t, src(), tag));
  if (h.prognosis) push(d, "harrison.prognosis", h.prognosis, src(), tag);
  (h.pitfalls || []).forEach((t) => push(d, "harrison.pitfall", t, src(), tag));
  if (h.severityClassification) push(d, "harrison.severity", h.severityClassification, src(), tag);
}

// stable ordering for reproducible builds (no Date/random)
chunks.sort((a, b) => a.chunkId < b.chunkId ? -1 : a.chunkId > b.chunkId ? 1 : 0);

const payload = {
  _meta: {
    note: "RAG-ready citable knowledge chunks. embedding is null until the embedding step runs. No AI integrated; no pharmacology duplicated (drugRefs = composition keys into the Drug Index).",
    schema: "chunkId|diseaseId|diseaseName|class|system|section|text|source{ref,page}|crossLinks[]|drugRefs[]|embedding(null)",
    diseases: nDz, referenceDiseases: nRef, totalDiseases: nDz + nRef, treatmentsIndexed: nTx, chunks: chunks.length,
  },
  chunks,
};

const sections = {};
chunks.forEach((c) => (sections[c.section.split(".")[0]] = (sections[c.section.split(".")[0]] || 0) + 1));

if (!process.argv.includes("--stdout")) {
  writeFileSync(OUT, JSON.stringify(payload));
  console.log("wrote " + OUT);
}
console.log(`diagnostic=${nDz} reference=${nRef} totalDiseases=${nDz + nRef} treatments=${nTx} chunks=${chunks.length}`);
console.log("by section group:", Object.entries(sections).map(([k, v]) => `${k}:${v}`).join("  "));
