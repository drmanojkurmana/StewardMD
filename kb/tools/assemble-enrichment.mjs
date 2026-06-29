/* Phase-2 helper: assemble + integrity-check a specialty's agent outputs.
 * Reads enr_<id>.json from $CLAUDE_JOB_DIR/tmp, validates, resolves cross-links to
 * real KB ids (case-insensitively), flags treatment-dose leakage / missing page
 * cites, and writes <out>.json (a {id:enrichment} map) for apply-enrichment.mjs.
 * USAGE: node kb/tools/assemble-enrichment.mjs <outName> <id> <id> ...
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TMP = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp";
const outName = process.argv[2];
const ids = process.argv.slice(3);
const realIds = readdirSync(join(ROOT, "kb", "diseases")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
const lc = {}; realIds.forEach((i) => (lc[i.toLowerCase()] = i));
const results = {}; const issues = []; const rows = [];
for (const id of ids) {
  const p = join(TMP, "enr_" + id + ".json");
  if (!existsSync(p)) { issues.push(id + ": MISSING enr file"); continue; }
  let e; try { e = JSON.parse(readFileSync(p, "utf8")); } catch (x) { issues.push(id + ": BAD JSON " + x.message); continue; }
  const resolved = [], dropped = [];
  (e.crossLinks || []).forEach((x) => { const r = lc[String(x).toLowerCase()]; if (r && r !== id) resolved.push(r); else if (!r) dropped.push(x); });
  e.crossLinks = [...new Set(resolved)];
  if (dropped.length) issues.push(id + ": dropped crossLinks [" + dropped.join(",") + "]");
  if (!e.references || !e.references.length) issues.push(id + ": NO page refs");
  const text = JSON.stringify([e.clinicalPearls, e.pitfalls, e.redFlags, e.additionalInvestigations]);
  const dose = text.match(/\b\d+\s?(mg|mcg|g|units)\b\/?(kg|day|hr|h)?/gi) || [];
  if (dose.length) issues.push(id + ": dose-like tokens (review) [" + [...new Set(dose)].slice(0, 3).join(",") + "]");
  results[id] = e;
  rows.push(`  ${id.padEnd(20)} pearls:${(e.clinicalPearls || []).length} pitfalls:${(e.pitfalls || []).length} ddx:${(e.additionalDifferentials || []).length} mimics:${(e.infectionMimics || []).length + (e.nonInfectiousMimics || []).length} sev:${!!e.severityClassification} prog:${!!e.prognosis} refs:${(e.references || []).length} xlinks:${e.crossLinks.length}`);
}
writeFileSync(join(TMP, outName + ".json"), JSON.stringify(results, null, 1));
console.log(`assembled ${Object.keys(results).length}/${ids.length} -> ${outName}.json`);
rows.forEach((r) => console.log(r));
console.log(`INTEGRITY (${issues.length}):`); issues.forEach((i) => console.log("  - " + i));
