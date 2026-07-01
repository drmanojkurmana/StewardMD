/* M3.1 applier: apply non-infective find-map deltas to BOTH signature copies —
 * kb/diseases/<id>.json (matching.find, → kb.core.js runtime truth) and the
 * reasoning.js inline DDX_NI closure (kept in sync) — then callers rebuild kb.core.
 *
 * Input: a proposals JSON file (array of {targetId, changes:{key:weight}, ...}).
 * Only non-empty `changes` are applied; keys are validated against the finding
 * vocabulary. Prints exactly what changed. Idempotent-ish (re-applying same delta
 * is a no-op on values). Does NOT rebuild — run build-kb-core afterwards.
 *
 * USAGE: node kb/tools/apply-m3-ni.mjs <proposals.json>
 */
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const propPath = process.argv[2];
if (!propPath || !existsSync(propPath)) { console.error("need proposals JSON path"); process.exit(1); }
const proposals = JSON.parse(readFileSync(propPath, "utf8"));

// finding vocabulary
const M2 = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp/m2";
const vocab = new Set(readFileSync(join(M2, "vocab.txt"), "utf8").split("\n").map((l) => l.split(" — ")[0].trim()).filter(Boolean));

const RJS = join(ROOT, "reasoning.js");
let rjs = readFileSync(RJS, "utf8");
let appliedCount = 0, skipped = 0, closurePatched = 0;
const log = [];

// serialize a find map the way reasoning.js formats it: { k:v, k:v }
const fmtFind = (m) => "{ " + Object.keys(m).map((k) => k + ":" + m[k]).join(", ") + " }";

for (const p of proposals) {
  if (!p || !p.targetId) continue;
  const changes = p.changes || {};
  const keys = Object.keys(changes).filter((k) => vocab.has(k));
  if (!keys.length) { skipped++; log.push(`  ${p.targetId}: no valid changes (${p.confidence || "?"}) — ${(p.rationale || "").slice(0, 80)}`); continue; }

  const dzPath = join(ROOT, "kb", "diseases", p.targetId + ".json");
  if (!existsSync(dzPath)) { log.push(`  ${p.targetId}: SOURCE FILE MISSING`); skipped++; continue; }
  const d = JSON.parse(readFileSync(dzPath, "utf8"));
  if (!d.matching || !d.matching.find) { log.push(`  ${p.targetId}: not a find-based disease — skipped`); skipped++; continue; }

  const before = { ...d.matching.find };
  const after = { ...before };
  const applied = {};
  for (const k of keys) { after[k] = changes[k]; if (before[k] !== changes[k]) applied[k] = changes[k]; }
  if (!Object.keys(applied).length) { log.push(`  ${p.targetId}: already at target weights`); continue; }

  // 1) source JSON
  d.matching.find = after;
  // keep associatedFindings a sorted union of positive-weight keys
  d.matching.associatedFindings = Object.keys(after).filter((k) => after[k] > 0).sort();
  writeFileSync(dzPath, JSON.stringify(d, null, 2) + "\n");

  // 2) reasoning.js inline closure: replace find:{...} within this id's object
  const re = new RegExp('(id:"' + p.targetId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + '"[\\s\\S]*?find:)\\{[^}]*\\}');
  if (re.test(rjs)) { rjs = rjs.replace(re, "$1" + fmtFind(after)); closurePatched++; }
  else log.push(`  ${p.targetId}: WARN closure not found in reasoning.js (source JSON updated only)`);

  appliedCount++;
  log.push(`  ${p.targetId}: +${JSON.stringify(applied)}  (conf ${p.confidence || "?"})`);
}

writeFileSync(RJS, rjs);
console.log(`applied ${appliedCount} disease deltas | closures patched ${closurePatched} | skipped ${skipped}`);
log.forEach((l) => console.log(l));
