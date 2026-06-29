/* Harrison reference-disease assembly: validate agent outputs (ref_<id>.json in
 * $CLAUDE_JOB_DIR/tmp) and write kb/reference/<id>.json — KNOWLEDGE/reference-only
 * disease entries (searchable + Harrison-cited, NOT diagnostic scoring candidates).
 * Integrity: valid JSON, has name + harrison block + page cites, crossLinks resolve
 * to real KB ids (diagnostic or reference), flags treatment-dose-like tokens.
 * USAGE: node kb/tools/assemble-reference.mjs <id> <id> ...
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TMP = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp";
const REF = join(ROOT, "kb", "reference");
mkdirSync(REF, { recursive: true });
const ids = process.argv.slice(2);

const dxIds = readdirSync(join(ROOT, "kb", "diseases")).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", ""));
const refIds = existsSync(REF) ? readdirSync(REF).filter((f) => f.endsWith(".json")).map((f) => f.replace(".json", "")) : [];
const all = {}; dxIds.concat(refIds).concat(ids).forEach((i) => (all[i.toLowerCase()] = i));

let wrote = 0; const issues = [], rows = [];
for (const id of ids) {
  const p = join(TMP, "ref_" + id + ".json");
  if (!existsSync(p)) { issues.push(id + ": MISSING ref file"); continue; }
  let e; try { e = JSON.parse(readFileSync(p, "utf8")); } catch (x) { issues.push(id + ": BAD JSON " + x.message); continue; }
  if (!e.name) { issues.push(id + ": no name"); continue; }
  const h = e.harrison || {};
  const resolved = [], dropped = [];
  (h.crossLinks || []).forEach((x) => { const r = all[String(x).toLowerCase()]; if (r && r !== id) resolved.push(r); else if (!r) dropped.push(x); });
  h.crossLinks = [...new Set(resolved)];
  if (dropped.length) issues.push(id + ": dropped crossLinks [" + dropped.slice(0, 4).join(",") + "]");
  if (!(h.references && h.references.length) && !e.page) issues.push(id + ": NO page refs");
  const text = JSON.stringify([h.clinicalPearls, h.pitfalls, h.redFlags, h.additionalInvestigations]);
  const dose = text.match(/\b\d+\s?(mg|mcg|units)\b\/?(kg|day|hr|h)?/gi) || [];
  if (dose.length) issues.push(id + ": dose-like tokens (review) [" + [...new Set(dose)].slice(0, 3).join(",") + "]");
  const out = {
    id, name: e.name, system: e.system || null, class: e.class || null,
    chapter: e.chapter || null, page: e.page || null,
    aliases: e.aliases || [], referenceOnly: true, review: { status: "ai_drafted" },
    harrison: h,
  };
  writeFileSync(join(REF, id + ".json"), JSON.stringify(out, null, 2) + "\n");
  wrote++;
  rows.push(`  ${id.padEnd(28)} pearls:${(h.clinicalPearls || []).length} ddx:${(h.additionalDifferentials || []).length} sev:${!!h.severityClassification} prog:${!!h.prognosis} refs:${(h.references || []).length}`);
}
console.log(`reference written: ${wrote}/${ids.length} -> kb/reference/`);
rows.forEach((r) => console.log(r));
console.log(`INTEGRITY (${issues.length}):`); issues.forEach((i) => console.log("  - " + i));
