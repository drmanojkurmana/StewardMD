/* mgmt/apply.mjs — deterministic merge. For each sidecar kb/_mgmt/<id>.json,
   load the canonical kb/reference/<id>.json, set reference.management (or
   harrison.management) to the generated array, and write it back. No LLM ever
   touches the canonical file — only this script does the surgical insert, so
   no other field can be altered/dropped. Idempotent. */
import { readdirSync, readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REF = join(ROOT, "kb", "reference");
const MG = join(ROOT, "kb", "_mgmt");

let applied = 0, empty = 0, missingFile = 0, noBlock = 0;
const files = readdirSync(MG).filter((f) => f.endsWith(".json") && f !== "_index.json");
for (const f of files) {
  let sc;
  try { sc = JSON.parse(readFileSync(join(MG, f), "utf8")); } catch (e) { console.log("BADJSON " + f); continue; }
  if (!sc.id || !Array.isArray(sc.management) || !sc.management.length) { empty++; continue; }
  const fp = join(REF, sc.id + ".json");
  if (!existsSync(fp)) { missingFile++; continue; }
  const d = JSON.parse(readFileSync(fp, "utf8"));
  const blk = d.reference || d.harrison;
  if (!blk || typeof blk !== "object") { noBlock++; continue; }
  blk.management = sc.management.map(String);
  writeFileSync(fp, JSON.stringify(d, null, 2) + "\n");
  applied++;
}
console.log(`sidecars=${files.length} applied=${applied} empty=${empty} missingFile=${missingFile} noBlock=${noBlock}`);
