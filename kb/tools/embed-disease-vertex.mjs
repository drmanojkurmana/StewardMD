/* StewardMD: build the disease-level KB vectors with Vertex AI (text-embedding-005, 768-d, cosine).
 * Replaces the Workers AI embed step (owner 2026-10-15: no Workers AI). One doc per disease, same text as
 * build-disease-vectors.mjs (name + aliases + knowledge fields), cut to DOC_CHARS. Vectors go to a NEW Vectorize
 * index so the old one stays as a rollback.
 *
 *   node kb/tools/embed-disease-vertex.mjs [--limit N] [--out DIR] [--dry]
 *
 * Auth: gcloud application-default credentials (gcloud auth application-default login). Project from
 * GCP_PROJECT or the gcloud default. HARD SPEND CAP: stops at MAX_CHARS billable characters (default 14M, which at
 * the published online price is well under 1 USD; the cap exists so a wrong price assumption cannot run away).
 * Output: <out>/kb.disease-vectors.t5.ndjson  { id, values, metadata:{diseaseId} }  (load with wrangler vectorize insert).
 */
import { readFileSync, writeFileSync, readdirSync, existsSync, mkdirSync, appendFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import os from "node:os";

const KB = join(dirname(fileURLToPath(import.meta.url)), "..");
const argv = process.argv.slice(2);
const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
const LIMIT = Number(arg("--limit", 0)), OUT = arg("--out", join(os.homedir(), "prep-data/kb-vectors")), DRY = argv.includes("--dry");
export const MODEL = "text-embedding-005", DOC_CHARS = 1200, BATCH = 16, MAX_CHARS = Number(process.env.MAX_CHARS || 14000000);
const loc = process.env.GCP_LOCATION || "us-central1";
const project = process.env.GCP_PROJECT || execFileSync("gcloud", ["config", "get-value", "project"], { encoding: "utf8" }).trim();

const loadJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const listJson = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort() : []);
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();
const ARR = ["additionalDifferentials", "infectionMimics", "additionalInvestigations", "nonInfectiousMimics", "clinicalPearls", "redFlags", "pitfalls"];
const TXT = ["pathophysiology", "prognosis", "severityClassification"];
export function docFor(entry) {
  const h = entry.enrichment?.harrison || entry.harrison || entry.reference || {};
  const parts = [];
  if (Array.isArray(entry.aliases) && entry.aliases.length) parts.push(entry.aliases.join(", "));
  if (Array.isArray(entry.differentials)) parts.push(...entry.differentials.map(norm));
  if (Array.isArray(entry.investigations)) parts.push(...entry.investigations.map((i) => norm(i.test + (i.why ? " - " + i.why : ""))));
  if (Array.isArray(entry.redFlags)) parts.push(...entry.redFlags.map(norm));
  for (const f of ARR) if (Array.isArray(h[f])) parts.push(...h[f].map(norm));
  for (const f of TXT) if (h[f]) parts.push(norm(h[f]));
  return norm(`${entry.name} - ${parts.filter(Boolean).join(" ")}`).slice(0, DOC_CHARS);
}
const byId = new Map();
for (const dir of ["diseases", "reference"]) for (const f of listJson(join(KB, dir))) {
  const e = loadJson(join(KB, dir, f)); if (!e.id || !e.name || byId.has(e.id)) continue; byId.set(e.id, { id: e.id, text: docFor(e) });
}
let docs = [...byId.values()].sort((a, b) => (a.id < b.id ? -1 : 1)); if (LIMIT) docs = docs.slice(0, LIMIT);
const totalChars = docs.reduce((n, d) => n + d.text.length, 0);
console.log(`docs ${docs.length}, chars ${totalChars}, cap ${MAX_CHARS}`);
if (totalChars > MAX_CHARS) { console.error("over the character cap; raise MAX_CHARS deliberately or lower DOC_CHARS"); process.exit(1); }
const DOCS_OUT = arg("--docs-out", "");
if (DOCS_OUT) { writeFileSync(DOCS_OUT, JSON.stringify(docs)); console.log("wrote docs ->", DOCS_OUT); process.exit(0); }
if (DRY) process.exit(0);

mkdirSync(OUT, { recursive: true });
const outFile = join(OUT, "kb.disease-vectors.t5.ndjson"); writeFileSync(outFile, "");
let token = "", tokenAt = 0;
const tok = () => { if (!token || Date.now() - tokenAt > 30 * 60e3) { token = execFileSync("gcloud", ["auth", "application-default", "print-access-token"], { encoding: "utf8" }).trim(); tokenAt = Date.now(); } return token; };
const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${project}/locations/${loc}/publishers/google/models/${MODEL}:predict`;
let billed = 0, done = 0;
async function embed(batch) {
  for (let a = 0; a < 5; a++) {
    const r = await fetch(url, { method: "POST", headers: { Authorization: "Bearer " + tok(), "Content-Type": "application/json" },
      body: JSON.stringify({ instances: batch.map((d) => ({ content: d.text, task_type: "RETRIEVAL_DOCUMENT" })), parameters: { outputDimensionality: 768 } }) });
    if (r.status === 429 || r.status >= 500) { await new Promise((s) => setTimeout(s, 2000 * (a + 1))); continue; }
    if (!r.ok) throw new Error("vertex " + r.status + " " + (await r.text()).slice(0, 200));
    const j = await r.json(); billed += Number(j.metadata?.billableCharacterCount || 0);
    return j.predictions.map((p) => p.embeddings.values);
  }
  throw new Error("vertex retries exhausted");
}
for (let i = 0; i < docs.length; i += BATCH) {
  if (billed > MAX_CHARS) { console.error("HARD STOP: billable characters over the cap"); process.exit(2); }
  const b = docs.slice(i, i + BATCH), v = await embed(b);
  appendFileSync(outFile, b.map((d, k) => JSON.stringify({ id: d.id, values: v[k], metadata: { diseaseId: d.id } })).join("\n") + "\n");
  done += b.length; if (done % 400 < BATCH) console.log(`embedded ${done}/${docs.length}, billable chars ${billed}`);
}
console.log(`DONE ${done} vectors, billable chars ${billed} -> ${outFile}`);
