/* StewardMD: compile schema v2 disease content (flowcharts, valueTables, citations) into
 * on-demand buckets: kb/dist/v2/b00.json .. b63.json, { <id>: { flowcharts, valueTables, citations } }.
 *
 * Kept out of kb.enrichment.js on purpose: those bundles sit near Cloudflare's 25 MiB per-file limit,
 * and v2 tables are only needed when one disease is opened. kb-v2-loader.js fetches one bucket then.
 * Bucket = djb2(id) % 64; the loader uses the same function.
 *
 * USAGE: node kb/tools/build-kb-v2.mjs
 */
import { readFileSync, writeFileSync, readdirSync, mkdirSync, existsSync, rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(ROOT, "kb", "dist", "v2");
const BUCKETS = 64;

export function bucketOf(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % BUCKETS;
}

/* entryFor(d) -> the bucket record for one article: flowcharts, value tables, citations,
// review status, and figures[] (drawn svg-spec pathways and image illustrations). Pure;
// unit-tested without touching kb/dist. */
export function entryFor(d) {
  const e = {
    flowcharts: d.flowcharts || [],
    valueTables: d.valueTables || [],
    citations: d.citations || [],
    status: (d.review && d.review.status) || "ai_drafted",
  };
  // figures ride only when present, so a rebuild without them is byte-identical
  if ((d.figures || []).length) e.figures = d.figures;
  return e;
}

export function hasV2(d) {
  return (d.flowcharts || []).length > 0 || (d.valueTables || []).length > 0 || (d.figures || []).length > 0;
}

function build() {
  const buckets = Array.from({ length: BUCKETS }, () => ({}));
  let n = 0;
  for (const dir of ["diseases", "reference"]) {
    const D = join(ROOT, "kb", dir);
    if (!existsSync(D)) continue;
    for (const f of readdirSync(D).filter((x) => x.endsWith(".json") && x !== "index.json")) {
      const d = JSON.parse(readFileSync(join(D, f), "utf8"));
      if (!d.id) continue;
      if (!hasV2(d)) continue;
      // A diagnostic disease wins over a reference entry with the same id (same rule as the enrichment build).
      const b = buckets[bucketOf(d.id)];
      if (b[d.id] && dir === "reference") continue;
      b[d.id] = entryFor(d);
      n++;
    }
  }

  if (existsSync(OUT)) rmSync(OUT, { recursive: true });
  mkdirSync(OUT, { recursive: true });
  let maxBytes = 0;
  buckets.forEach((b, i) => {
    const s = JSON.stringify(b);
    maxBytes = Math.max(maxBytes, s.length);
    writeFileSync(join(OUT, "b" + String(i).padStart(2, "0") + ".json"), s);
  });
  console.log(`kb v2: ${n} entries in ${BUCKETS} buckets, largest bucket ${(maxBytes / 1048576).toFixed(2)} MiB`);
  return { n, maxBytes };
}

const invoked = process.argv[1] && import.meta.url === new URL("file://" + process.argv[1]).href;
if (invoked) build();
