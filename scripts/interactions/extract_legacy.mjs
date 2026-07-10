/* Stage-0 migration helper: extract the CURRENT window.INTERACTION_RULES from
 * the committed interaction-rules.js EXACTLY (no hand-transcription), splitting
 * it into curated seed files the pipeline merges:
 *   curated/legacy_drugclasses.json  — the existing generic -> [classTags] map
 *   curated/legacy_rules.json        — the existing 41 rules (verbatim objects)
 *   curated/sources.json             — the existing provenance blocks
 * plus the current version string (for reference).
 *
 * Run ONCE to seed the pipeline. After that these are curated source-of-truth
 * (legacy rules may be edited by clinicians; auto-classification only ADDS tags).
 *
 * USAGE: node scripts/interactions/extract_legacy.mjs
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const CUR = join(HERE, "curated");

const src = readFileSync(join(ROOT, "interaction-rules.js"), "utf8");
const sandbox = { window: {} };
vm.createContext(sandbox);
vm.runInContext(src, sandbox, { filename: "interaction-rules.js" });

const IR = sandbox.window.INTERACTION_RULES;
if (!IR || !IR.rules || !IR.drugClasses) throw new Error("INTERACTION_RULES not found / malformed");

const write = (name, obj) => {
  const p = join(CUR, name);
  writeFileSync(p, JSON.stringify(obj, null, 2) + "\n");
  console.log(`wrote ${name}`);
};

write("legacy_drugclasses.json", {
  _comment: "EXACT extract of drugClasses from interaction-rules.js at migration time. Pipeline unions these tags with RxClass-derived tags (never removes). Edit via curated_overrides.json, not here.",
  drugClasses: IR.drugClasses
});
write("legacy_rules.json", {
  _comment: "EXACT extract of the pre-pipeline curated rules. These are preserved verbatim by build_rules.py so existing test/run-interactions.mjs assertions keep passing. New rules live in mechanism_rules.json.",
  rules: IR.rules
});
write("sources.json", {
  _comment: "Provenance blocks surfaced as INTERACTION_RULES.sources. Add rxnorm-rxclass here for auto-classification provenance.",
  sources: IR.sources || []
});
console.log(`legacy: ${Object.keys(IR.drugClasses).length} classified generics, ${IR.rules.length} rules, version ${IR.version}`);
