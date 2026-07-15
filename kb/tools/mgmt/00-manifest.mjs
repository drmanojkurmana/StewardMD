/* mgmt/00-manifest.mjs — prep step for adding `management` to reference diseases.
   Scans kb/reference/*.json, and for every entry that does NOT already have a
   management array (in the canonical file OR an existing sidecar), emits a
   grounding record. Records are chunked into batch files that generation agents
   read. Idempotent / resumable: re-running only queues the still-missing ones. */
import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";

const ROOT = process.cwd();
const REF = join(ROOT, "kb", "reference");
const OUT = join(ROOT, "kb", "_mgmt");
const BATCHES = join(OUT, "_batches");
mkdirSync(BATCHES, { recursive: true });

const BATCH_SIZE = Number(process.argv[2] || 20);
const files = readdirSync(REF).filter((f) => f.endsWith(".json")).sort();

const todo = [];
let already = 0;
for (const f of files) {
  const d = JSON.parse(readFileSync(join(REF, f), "utf8"));
  const blk = d.reference || d.harrison || {};
  if (Array.isArray(blk.management) && blk.management.length) { already++; continue; }
  if (existsSync(join(OUT, d.id + ".json"))) { already++; continue; }
  todo.push({
    id: d.id,
    name: d.name,
    class: d.class || "",
    system: d.system || "",
    specialty: d.specialty || "",
    pathophysiology: (blk.pathophysiology || "").slice(0, 800),
    clinicalPearls: (blk.clinicalPearls || []).slice(0, 6),
    additionalInvestigations: (blk.additionalInvestigations || []).slice(0, 6),
    prognosis: (blk.prognosis || "").slice(0, 300),
  });
}

let bi = 0;
for (let i = 0; i < todo.length; i += BATCH_SIZE) {
  const batch = todo.slice(i, i + BATCH_SIZE);
  writeFileSync(join(BATCHES, "batch-" + String(bi).padStart(4, "0") + ".json"), JSON.stringify(batch, null, 2));
  bi++;
}
writeFileSync(join(OUT, "_index.json"), JSON.stringify({ total: todo.length, already, batchSize: BATCH_SIZE, batches: bi }, null, 2));
console.log(`reference files=${files.length} alreadyDone=${already} todo=${todo.length} batches=${bi} (size ${BATCH_SIZE})`);
