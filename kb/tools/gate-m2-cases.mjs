/* M2 gate: validate + clean the workflow-authored gold cases, then write them to
 * kb/validation/cases/<id>.json (executable by test/run-case-validation.mjs).
 * Integrity: valid JSON; findings use ONLY engine finding-keys (invalid dropped);
 * expected.acceptableIds/differentialIds ONLY engine disease ids (invalid dropped);
 * no diagnostic scoring fields; flags cases with no valid findings or empty acceptableIds
 * (documented gaps). Everything stays review.clinicianApproved:false.
 * USAGE: node kb/tools/gate-m2-cases.mjs   (reads $CLAUDE_JOB_DIR/tmp/case_*.json + m2/{vocab,diseases,briefs})
 */
import { readFileSync, writeFileSync, existsSync, mkdirSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const TMP = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp";
const M2 = (process.env.CLAUDE_JOB_DIR || "/tmp") + "/tmp/m2";
const OUT = join(ROOT, "kb", "validation", "cases"); mkdirSync(OUT, { recursive: true });

const vocab = new Set(readFileSync(join(M2, "vocab.txt"), "utf8").split("\n").map((l) => l.split(" — ")[0].trim()).filter(Boolean));
const dzIds = new Set(readFileSync(join(M2, "diseases.txt"), "utf8").split("\n").map((l) => l.split(" — ")[0].trim()).filter(Boolean));
const briefs = JSON.parse(readFileSync(join(M2, "briefs.json"), "utf8"));

let wrote = 0, parseFail = 0, droppedKeys = 0, droppedIds = 0, noFindings = 0, emptyAccept = 0;
const rows = [], specCount = {};
for (const b of briefs) {
  const p = join(TMP, "case_" + b.id + ".json");
  if (!existsSync(p)) { rows.push(b.id + ": MISSING"); continue; }
  let c; try { c = JSON.parse(readFileSync(p, "utf8")); } catch (e) { parseFail++; rows.push(b.id + ": BAD JSON"); continue; }
  // findings: keep only valid engine keys
  const f = {}; let dk = 0;
  for (const k in (c.findings || {})) { if (vocab.has(k)) f[k] = true; else dk++; }
  droppedKeys += dk;
  if (!Object.keys(f).length) noFindings++;
  c.findings = f;
  // expected ids: keep only real engine ids
  const exp = c.expected || {};
  const okIds = (arr) => (arr || []).filter((x) => { if (dzIds.has(x)) return true; droppedIds++; return false; });
  exp.acceptableIds = okIds(exp.acceptableIds);
  exp.differentialIds = okIds(exp.differentialIds);
  if (!exp.acceptableIds.length) emptyAccept++;
  c.expected = exp;
  // strip any accidental scoring fields; force review flag
  delete c.matching; delete c.find; delete c.score;
  c.review = { status: "ai_drafted", clinicianApproved: false };
  c.specialty = c.specialty || b.specialty;
  writeFileSync(join(OUT, b.id + ".json"), JSON.stringify(c, null, 2) + "\n");
  wrote++;
  specCount[c.specialty] = (specCount[c.specialty] || 0) + 1;
}
console.log(`gold cases written: ${wrote}/${briefs.length} -> kb/validation/cases/`);
console.log(`parseFail=${parseFail} | dropped invalid finding-keys=${droppedKeys} | dropped invalid expected-ids=${droppedIds}`);
console.log(`cases with NO valid findings=${noFindings} | cases with empty acceptableIds (dx not in diagnosable set)=${emptyAccept}`);
console.log("specialty coverage:", JSON.stringify(specCount));
rows.filter((r) => /MISSING|BAD/.test(r)).forEach((r) => console.log("  - " + r));
