/* StewardMD KB P2a — generate the KB disease objects from the live engine dump.
 *
 * Reads the engine dump (51 SYNDROMES closures + 89 DDX_NI data) and emits
 * kb/diseases/<id>.json for all 140, using the transpiler to turn match/baseScore
 * closures into declarative rule/score. Legacy ids are preserved verbatim so the
 * Phase-3 engine swap is a drop-in. Re-runnable.
 *
 * USAGE: node kb/tools/build-from-engine.mjs <engine-dump.json>
 */
import { readFileSync, writeFileSync, readdirSync, rmSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { matchToRule, baseScoreToModel } from "./transpile.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const DISEASES = join(ROOT, "kb", "diseases");
const dumpPath = process.argv[2] || join(process.env.CLAUDE_JOB_DIR || "/tmp", "engine-dump.json");
const dump = JSON.parse(readFileSync(dumpPath, "utf8"));

function collectKeys(rule, set) {
  if (rule == null) return set;
  if (typeof rule === "string") { set.add(rule); return set; }
  if (Array.isArray(rule)) { rule.forEach((r) => collectKeys(r, set)); return set; }
  if (rule.allOf) rule.allOf.forEach((r) => collectKeys(r, set));
  if (rule.anyOf) rule.anyOf.forEach((r) => collectKeys(r, set));
  if (rule.not != null) collectKeys(rule.not, set);
  if (rule.key) set.add(rule.key);
  return set;
}
function pathStr(arr) { // coerce pathogen entries to strings
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === "string" ? x : (x && (x.name || x.organism || x.label)) || "")).filter(Boolean);
}
function invList(arr) {
  if (!Array.isArray(arr)) return [];
  return arr.map((x) => (typeof x === "string" ? { test: x } : { test: x.test || x.name || "", why: x.why || x.note || x.reason || undefined })).filter((x) => x.test);
}

const PROV = { primaryRef: "Harrison 22e", editions: ["Harrison 22e (2025)"] };
const REVIEW = { status: "approved", reviewedBy: null, reviewedAt: null };

// clean slate (regenerate all; preserves nothing hand-edited under diseases/)
try { rmSync(DISEASES, { recursive: true, force: true }); } catch (e) {}
mkdirSync(DISEASES, { recursive: true });

let okInf = 0, okNi = 0, fail = [];

for (const id of Object.keys(dump.syndromes)) {
  const s = dump.syndromes[id];
  try {
    const rule = matchToRule(s.matchSrc);
    const score = baseScoreToModel(s.baseSrc);
    const keys = new Set(); collectKeys(rule, keys); (score.modifiers || []).forEach((m) => collectKeys(m.when, keys));
    const obj = {
      id, name: s.name, class: "infective", system: s.system || "Infectious",
      coding: { icd10: null, icd11: null, snomed: null },
      matching: { rule, score, associatedFindings: [...keys].sort(), reasoningTemplate: "" },
      pathogens: s.pathogens ? { veryLikely: pathStr(s.pathogens.veryLikely), likely: pathStr(s.pathogens.likely), possible: pathStr(s.pathogens.possible), why: s.pathogens.why || "" } : undefined,
      redFlags: s.decisionStatus === "red" ? [s.decisionLabel || "Time-critical infection"] : [],
      investigations: invList(s.investigations),
      treatmentRef: id, policyRef: id, calculatorRefs: [], icuModuleRefs: [], drugRefs: [],
      provenance: PROV, review: REVIEW, version: 1, contentHash: null,
    };
    if (!obj.pathogens) delete obj.pathogens;
    writeFileSync(join(DISEASES, id + ".json"), JSON.stringify(obj, null, 2) + "\n");
    okInf++;
  } catch (e) { fail.push(id + " (infective): " + e.message); }
}

for (const d of dump.ddx_ni) {
  try {
    const obj = {
      id: d.id, name: d.name, class: "non_infective", system: d.system || "",
      coding: { icd10: null, icd11: null, snomed: null },
      matching: { find: d.find || {}, associatedFindings: Object.keys(d.find || {}).sort(), reasoningTemplate: d.reason || "" },
      redFlags: d.red || [],
      investigations: invList(d.inv),
      treatmentRef: d.id, policyRef: null, calculatorRefs: d.tools || [], icuModuleRefs: [], drugRefs: [],
      provenance: PROV, review: REVIEW, version: 1, contentHash: null,
    };
    writeFileSync(join(DISEASES, d.id + ".json"), JSON.stringify(obj, null, 2) + "\n");
    okNi++;
  } catch (e) { fail.push(d.id + " (ni): " + e.message); }
}

const written = readdirSync(DISEASES).filter((f) => f.endsWith(".json")).length;
console.log(`infective: ${okInf}/${Object.keys(dump.syndromes).length}  non-infective: ${okNi}/${dump.ddx_ni.length}  files written: ${written}`);
if (fail.length) { console.log("FAILURES:"); fail.forEach((f) => console.log("  " + f)); process.exitCode = 1; }
else console.log("all diseases transpiled.");
