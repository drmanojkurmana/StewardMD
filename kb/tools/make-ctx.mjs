/* Phase-2 helper: write per-disease "existing curated content" context files
 * (ctx_<id>.json in $CLAUDE_JOB_DIR/tmp) so enrichment agents ADD ONLY MISSING info.
 * USAGE: node kb/tools/make-ctx.mjs <id> <id> ...
 */
import { readFileSync, existsSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TMP = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp";
for (const id of process.argv.slice(2)) {
  const dp = join(ROOT, "kb", "diseases", id + ".json");
  if (!existsSync(dp)) { console.log("MISSING " + id); continue; }
  const d = JSON.parse(readFileSync(dp, "utf8"));
  let tx = null; const tp = join(ROOT, "kb", "treatments", id + ".json");
  if (existsSync(tp)) tx = JSON.parse(readFileSync(tp, "utf8"));
  const ctx = {
    id, name: d.name, system: d.system, class: d.class,
    existing: {
      reasoning: d.matching && d.matching.reasoningTemplate,
      pathogens: d.pathogens || null,
      investigations: (d.investigations || []).map((x) => x.test),
      redFlags: d.redFlags || [],
      differentials: d.differentials || [],
      mimics: d.mimics || [],
      references: d.references || [],
      treatmentRegimens: tx && tx.recommendations ? tx.recommendations.map((r) => r.regimenLabel || (r.drugRefs || []).map((x) => x.composition).join("+") || r.line).filter(Boolean) : [],
      treatmentSteps: tx && tx.recommendations && tx.recommendations[0] ? (tx.recommendations[0].steps || []) : [],
    },
  };
  writeFileSync(join(TMP, "ctx_" + id + ".json"), JSON.stringify(ctx, null, 1));
}
console.log("ctx written for: " + process.argv.slice(2).join(", "));
