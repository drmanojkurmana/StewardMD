/* StewardMD — build the DISEASE-LEVEL semantic index (docs + vectors).
 *
 * This regenerates the two artifacts the deployed hybrid-retrieval vector arm
 * actually serves (previously produced out-of-band, with no committed source):
 *   kb/dist/kb.disease-docs.json      [{ id, text }]                (one doc per disease)
 *   kb/dist/kb.disease-vectors.ndjson { id, values, metadata:{diseaseId} }
 *
 * The Vectorize index `stewardmd-kb` is DISEASE-LEVEL: functions/api/retrieve
 * reads m.metadata.diseaseId and m.id per match (section optional/null), which
 * is exactly this shape (id == diseaseId). (embed-upsert.mjs builds an
 * alternative CHUNK-level index; this disease-level index is the one deployed.)
 *
 * One doc per disease = its name + the paraphrased Harrison knowledge fields,
 * concatenated in a fixed, documented order and whitespace-normalized. Covers
 * both the diagnostic tier (kb/diseases/, fields under enrichment.harrison) and
 * the reference tier (kb/reference/, fields under top-level harrison).
 *
 * ENV (only needed for --embed): CLOUDFLARE_ACCOUNT_ID, CLOUDFLARE_API_TOKEN
 *   (Workers AI Read/Run scope).
 *
 * USAGE:
 *   node kb/tools/build-disease-vectors.mjs            # write docs + verify id-parity
 *   node kb/tools/build-disease-vectors.mjs --verify   # verify only, write nothing
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… \
 *     node kb/tools/build-disease-vectors.mjs --embed  # docs + embeddings
 *   npx wrangler vectorize insert stewardmd-kb --file kb/dist/kb.disease-vectors.ndjson
 *
 * Idempotent: upsert-by-id (diseaseId). Re-run after any content change, then
 * re-insert into Vectorize.
 */
import { readFileSync, writeFileSync, readdirSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const KB = join(dirname(fileURLToPath(import.meta.url)), "..");
const DOCS_OUT = join(KB, "dist", "kb.disease-docs.json");
const VEC_OUT = join(KB, "dist", "kb.disease-vectors.ndjson");
const MODEL = "@cf/baai/bge-base-en-v1.5";
const BATCH = 50;

const argv = process.argv.slice(2);
const VERIFY_ONLY = argv.includes("--verify");
const DO_EMBED = argv.includes("--embed");

const loadJson = (p) => JSON.parse(readFileSync(p, "utf8"));
const listJson = (d) => (existsSync(d) ? readdirSync(d).filter((f) => f.endsWith(".json")).sort() : []);
const norm = (s) => String(s || "").replace(/\s+/g, " ").trim();

// Field order for the concatenated doc. Diagnostic diseases carry these under
// enrichment.harrison; reference entries carry the same under top-level harrison.
const HARRISON_ARRAY_FIELDS = [
  "additionalDifferentials",
  "infectionMimics",
  "additionalInvestigations",
  "nonInfectiousMimics",
  "clinicalPearls",
  "redFlags",
  "pitfalls",
];
const HARRISON_TEXT_FIELDS = ["pathophysiology", "prognosis", "severityClassification"];

function docFor(entry) {
  const h = entry.enrichment?.harrison || entry.harrison || {};
  const parts = [];
  // aliases help lexical/semantic recall for synonym queries
  if (Array.isArray(entry.aliases) && entry.aliases.length) parts.push(entry.aliases.join(", "));
  // the disease's own curated differentials/investigations (diagnostic tier)
  if (Array.isArray(entry.differentials)) parts.push(...entry.differentials.map(norm));
  if (Array.isArray(entry.investigations)) parts.push(...entry.investigations.map((i) => norm(i.test + (i.why ? " — " + i.why : ""))));
  if (Array.isArray(entry.redFlags)) parts.push(...entry.redFlags.map(norm));
  for (const f of HARRISON_ARRAY_FIELDS) if (Array.isArray(h[f])) parts.push(...h[f].map(norm));
  for (const f of HARRISON_TEXT_FIELDS) if (h[f]) parts.push(norm(h[f]));
  const body = parts.filter(Boolean).join(" ");
  return norm(`${entry.name} — ${body}`);
}

// gather diagnostic + reference entries. If an id exists in BOTH tiers
// (e.g. sickle_cell_disease), the diagnostic entry wins — it is the richer,
// engine-scorable record. diseases/ is processed first so reference/ can't
// clobber it.
const byId = new Map();
for (const dir of ["diseases", "reference"]) {
  for (const f of listJson(join(KB, dir))) {
    const e = loadJson(join(KB, dir, f));
    if (!e.id || !e.name) continue;
    if (byId.has(e.id)) continue; // keep the diagnostic-tier doc
    byId.set(e.id, { id: e.id, text: docFor(e) });
  }
}
const docs = [...byId.values()];
docs.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
console.log(`built ${docs.length} disease docs (avg ${Math.round(docs.reduce((n, d) => n + d.text.length, 0) / docs.length)} chars)`);

// id-parity check against the currently-deployed docs artifact
if (existsSync(DOCS_OUT)) {
  const existing = loadJson(DOCS_OUT);
  const have = new Set((Array.isArray(existing) ? existing : []).map((d) => d.id));
  const want = new Set(docs.map((d) => d.id));
  const missing = [...want].filter((i) => !have.has(i));
  const extra = [...have].filter((i) => !want.has(i));
  console.log(`id-parity vs deployed docs: current=${have.size} generated=${want.size} new=${missing.length} removed=${extra.length}`);
  if (missing.length) console.log("  new ids:", missing.slice(0, 10).join(", ") + (missing.length > 10 ? " …" : ""));
  if (extra.length) console.log("  removed ids:", extra.slice(0, 10).join(", ") + (extra.length > 10 ? " …" : ""));
}

if (VERIFY_ONLY) { console.log("verify-only: nothing written."); process.exit(0); }

writeFileSync(DOCS_OUT, JSON.stringify(docs) + "\n");
console.log(`wrote ${docs.length} docs → ${DOCS_OUT}`);

if (!DO_EMBED) {
  console.log("skip embeddings (pass --embed with Cloudflare creds to build kb.disease-vectors.ndjson).");
  process.exit(0);
}

const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCT || !TOKEN) { console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI scope) for --embed."); process.exit(1); }

async function embed(texts) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${MODEL}`,
    { method: "POST", headers: { Authorization: "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ text: texts }) });
  const j = await r.json();
  if (!j.success) throw new Error("AI embed failed: " + JSON.stringify(j.errors || j).slice(0, 300));
  return j.result.data;
}

const lines = [];
for (let i = 0; i < docs.length; i += BATCH) {
  const batch = docs.slice(i, i + BATCH);
  const vecs = await embed(batch.map((d) => d.text.slice(0, 2000)));
  batch.forEach((d, k) => {
    if (!Array.isArray(vecs[k])) return;
    lines.push(JSON.stringify({ id: d.id, values: vecs[k], metadata: { diseaseId: d.id } }));
  });
  console.log(`embedded ${Math.min(i + BATCH, docs.length)}/${docs.length}`);
}
writeFileSync(VEC_OUT, lines.join("\n") + "\n");
console.log(`\nwrote ${lines.length} vectors → ${VEC_OUT}`);
console.log("now load them:\n  npx wrangler vectorize insert stewardmd-kb --file kb/dist/kb.disease-vectors.ndjson");
