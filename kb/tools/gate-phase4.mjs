/* KB Phase 4 — integrity gate for the AI-drafted signatures.
 *
 * Reads the per-disease drafts produced by the kb-phase4-signatures workflow
 * (one JSON per disease in <draftsDir>), validates them against the engine's
 * controlled finding vocabulary, maps tiers → calibrated weights, and emits the
 * committed source of truth:  kb/expanded/ai-signatures.json
 *
 * Gate rules (deterministic, reproducible):
 *  - keys must be in the palette (vocab.json); unknown keys are dropped + counted.
 *  - a key appears in at most one tier (priority patho > disc > supp > neg).
 *  - tier caps: patho≤3, disc≤6, supp≤8, neg≤4 (keeps signatures focused).
 *  - weights (calibrated to the curated 140: min −20, p50 16, p90 30, max 55):
 *      pathognomonic 30, discriminative 20, supportive 10, negative −15.
 *  - keep a disease only if usable AND (patho+disc ≥ 1) AND ≥2 positive findings.
 *
 * USAGE: node kb/tools/gate-phase4.mjs <draftsDir> [vocabJson] [manifestJson]
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const draftsDir = process.argv[2];
const vocabJson = process.argv[3] || join(draftsDir, "..", "vocab.json");
const manifestJson = process.argv[4] || join(draftsDir, "..", "manifest.json");
if (!draftsDir || !existsSync(draftsDir)) { console.error("drafts dir not found:", draftsDir); process.exit(1); }

const PALETTE = new Set(JSON.parse(readFileSync(vocabJson, "utf8")));
const META = {};
JSON.parse(readFileSync(manifestJson, "utf8")).forEach((d) => { META[d.id] = d; });

const W = { pathognomonic: 30, discriminative: 20, supportive: 10, negative: -15 };
const CAP = { pathognomonic: 3, discriminative: 6, supportive: 8, negative: 4 };
const TIERS = ["pathognomonic", "discriminative", "supportive", "negative"];

let read = 0, droppedUnusable = 0, droppedThin = 0, unknownKeys = 0, parseFail = 0;
const list = [];

for (const f of readdirSync(draftsDir).filter((x) => x.endsWith(".json"))) {
  let d;
  try { d = JSON.parse(readFileSync(join(draftsDir, f), "utf8")); } catch (e) { parseFail++; continue; }
  read++;
  const id = d.id || f.replace(/\.json$/, "");
  const meta = META[id] || { name: id, system: "", class: "" };
  const seen = new Set(), tiers = { pathognomonic: [], discriminative: [], supportive: [], negative: [] }, find = {};
  for (const t of TIERS) {
    const arr = Array.isArray(d[t]) ? d[t] : [];
    for (const k of arr) {
      if (typeof k !== "string") continue;
      if (!PALETTE.has(k)) { unknownKeys++; continue; }        // drop hallucinated keys
      if (seen.has(k)) continue;                               // one tier per key
      if (tiers[t].length >= CAP[t]) continue;                 // cap tier size
      seen.add(k); tiers[t].push(k); find[k] = W[t];
    }
  }
  const positives = tiers.pathognomonic.length + tiers.discriminative.length + tiers.supportive.length;
  if (d.usable === false) { droppedUnusable++; continue; }
  if ((tiers.pathognomonic.length + tiers.discriminative.length) < 1 || positives < 2) { droppedThin++; continue; }
  list.push({
    id, name: meta.name, system: meta.system, class: meta.class,
    find, tiers, rationale: String(d.rationale || "").slice(0, 400),
    source: "ai_drafted", review: true
  });
}

list.sort((a, b) => a.id.localeCompare(b.id));
const outDir = join(ROOT, "kb", "expanded");
if (!existsSync(outDir)) mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, "ai-signatures.json"), JSON.stringify({ generated: "phase4", count: list.length, list }, null, 1) + "\n");

const avg = list.reduce((a, d) => a + Object.keys(d.find).length, 0) / (list.length || 1);
const inf = list.filter((d) => d.class === "infective" || d.class === "inf").length;
console.log(`drafts read=${read} parseFail=${parseFail}`);
console.log(`kept=${list.length} (inf=${inf} ni=${list.length - inf})  droppedUnusable=${droppedUnusable} droppedThin=${droppedThin}`);
console.log(`unknown keys dropped=${unknownKeys}  avg positive+neg findings/disease=${avg.toFixed(1)}`);
console.log(`-> kb/expanded/ai-signatures.json`);
