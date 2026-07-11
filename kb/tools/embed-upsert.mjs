/* StewardMD — embed the KB chunk corpus and upsert it to the Vectorize index.
 *
 * The hybrid-retrieval "vector arm" (functions/api/retrieve) queries a Vectorize
 * index of KB-chunk embeddings. This tool builds that index's contents:
 *   1. read kb/dist/kb.index.json  (run `node kb/tools/build-kb-index.mjs` first)
 *   2. embed each chunk.text with Workers AI (@cf/baai/bge-base-en-v1.5, 768-d)
 *   3. write kb/dist/kb.vectors.ndjson  ({ id, values, metadata:{diseaseId,section} })
 *   4. print the `wrangler vectorize insert` command to load it.
 *
 * ENV (your Cloudflare account — an API token with Workers AI + a token/OAuth for
 * the vectorize insert; the embed step here uses the REST API):
 *   CLOUDFLARE_ACCOUNT_ID   (5476a757e49205bd1cce40b144eb59a9 for this account)
 *   CLOUDFLARE_API_TOKEN    (scope: Workers AI — Read/Run)
 *
 * USAGE:
 *   node kb/tools/build-kb-index.mjs
 *   CLOUDFLARE_ACCOUNT_ID=… CLOUDFLARE_API_TOKEN=… node kb/tools/embed-upsert.mjs
 *   npx wrangler vectorize insert stewardmd-kb --file kb/dist/kb.vectors.ndjson
 *
 * Idempotent: upsert-by-id (chunkId), so re-running after a KB change refreshes.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const IN = join(ROOT, "kb", "dist", "kb.index.json");
const OUT = join(ROOT, "kb", "dist", "kb.vectors.ndjson");
const MODEL = "@cf/baai/bge-base-en-v1.5";
const BATCH = 50;                         // texts per Workers AI request

const ACCT = process.env.CLOUDFLARE_ACCOUNT_ID;
const TOKEN = process.env.CLOUDFLARE_API_TOKEN;
if (!ACCT || !TOKEN) { console.error("Set CLOUDFLARE_ACCOUNT_ID and CLOUDFLARE_API_TOKEN (Workers AI scope)."); process.exit(1); }

let raw; try { raw = JSON.parse(readFileSync(IN, "utf8")); } catch (e) { console.error("Missing/invalid " + IN + " — run `node kb/tools/build-kb-index.mjs` first."); process.exit(1); }
const chunks = (Array.isArray(raw) ? raw : (raw.chunks || raw.index && raw.index.chunks || [])).filter((c) => c && c.chunkId && c.text);
if (!chunks.length) { console.error("No chunks found in " + IN); process.exit(1); }
console.log("chunks to embed:", chunks.length);

async function embed(texts) {
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${ACCT}/ai/run/${MODEL}`,
    { method: "POST", headers: { "Authorization": "Bearer " + TOKEN, "Content-Type": "application/json" }, body: JSON.stringify({ text: texts }) });
  const j = await r.json();
  if (!j.success) throw new Error("AI embed failed: " + JSON.stringify(j.errors || j).slice(0, 300));
  return j.result.data;                   // [[...768], ...] aligned to `texts`
}

const lines = [];
for (let i = 0; i < chunks.length; i += BATCH) {
  const batch = chunks.slice(i, i + BATCH);
  const vecs = await embed(batch.map((c) => String(c.text).slice(0, 2000)));
  batch.forEach((c, k) => {
    if (!Array.isArray(vecs[k])) return;
    lines.push(JSON.stringify({ id: c.chunkId, values: vecs[k], metadata: { diseaseId: c.diseaseId, section: c.section } }));
  });
  console.log(`embedded ${Math.min(i + BATCH, chunks.length)}/${chunks.length}`);
}

writeFileSync(OUT, lines.join("\n") + "\n");
console.log(`\nwrote ${lines.length} vectors → ${OUT}`);
console.log("now load them:\n  npx wrangler vectorize insert stewardmd-kb --file kb/dist/kb.vectors.ndjson");
