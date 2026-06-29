/* StewardMD KB Phase-2 — apply Harrison enrichment to disease files.
 *
 * NON-DESTRUCTIVE + IDEMPOTENT: writes ONLY disease.enrichment.harrison from the
 * results file; never touches curated fields (matching, pathogens, investigations,
 * reason, references, treatmentRef, etc.) or any other enrichment source. Re-running
 * a re-import replaces only enrichment.harrison — no duplication, no drift.
 *
 * USAGE: node kb/tools/apply-enrichment.mjs <results.json> <importedAt-ISO>
 *   results.json = { "<id>": { ...harrison enrichment fields... }, ... }
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const results = JSON.parse(readFileSync(process.argv[2], "utf8"));
const importedAt = process.argv[3] || null;

// cheap stable hash for change detection / re-import diffs
function hash(s) { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) >>> 0; return "h" + h.toString(16); }

let applied = 0, missing = [];
for (const id of Object.keys(results)) {
  const path = join(ROOT, "kb", "diseases", id + ".json");
  if (!existsSync(path)) { missing.push(id); continue; }
  const d = JSON.parse(readFileSync(path, "utf8"));
  const e = results[id];
  const block = {
    source: e.source || "Harrison's Principles of Internal Medicine, 22e (2025)",
    sourceEdition: e.sourceEdition || "22e-2025",
    pages: e.pages || null,
    clinicalPearls: e.clinicalPearls || [],
    pathophysiology: e.pathophysiology || null,
    additionalDifferentials: e.additionalDifferentials || [],
    infectionMimics: e.infectionMimics || [],
    nonInfectiousMimics: e.nonInfectiousMimics || [],
    additionalInvestigations: e.additionalInvestigations || [],
    redFlags: e.redFlags || [],
    prognosis: e.prognosis || null,
    pitfalls: e.pitfalls || [],
    severityClassification: e.severityClassification || null,
    references: e.references || [],
    crossLinks: e.crossLinks || [],
    conflicts: e.conflicts || [],
    importedAt: importedAt,
    contentHash: null,
  };
  block.contentHash = hash(JSON.stringify({ ...block, importedAt: null, contentHash: null }));
  // additive, isolated: only enrichment.harrison is written; everything else untouched
  d.enrichment = d.enrichment || {};
  d.enrichment.harrison = block;
  writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
  applied++;
}
console.log(`enrichment applied to ${applied} diseases${missing.length ? "; MISSING ids: " + missing.join(",") : ""}`);
