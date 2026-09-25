/* backend/medcore/pool.mjs — every open dataset we can legally use, in one extract.
 *
 * Three sources, all openly licensed and needing no credentialing: the eICU demo (2,477 stays
 * across 186 hospitals), the MIMIC-IV demo (140) and the MIMIC-III demo (136). Pooled they give
 * more events and, more usefully, a `dataset` stratum - so the subgroup gate asks the question a
 * product shipping to two countries actually needs answered: does this transfer, or does it work
 * at the hospital it was fitted to?
 *
 * Pooling is NOT free and the pipeline must not pretend otherwise. Three sources means three
 * charting cultures, three assay sets and three definitions of when a vasopressor is "started".
 * That heterogeneity is the point of measuring it, not a flaw to smooth away, so nothing here
 * harmonises anything beyond the unit allow-list every adapter already passes through.
 *
 * USAGE: node backend/medcore/pool.mjs --out backend/medcore/out/pooled.jsonl
 */
import { createWriteStream, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { resolveOut } from "./paths.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "../..");
const arg = (n, d) => {
  const i = process.argv.indexOf("--" + n);
  if (i === -1) return d;
  const v = process.argv[i + 1];
  return v === undefined || v.startsWith("--") ? true : v;
};

const SOURCES = [
  { name: "eicu-crd-demo", module: "./adapters/eicu-demo.mjs", dir: "backend/medcore/data-eicu" },
  { name: "mimic-iv-demo", module: "./adapters/mimic-iv-demo.mjs", dir: "backend/medcore/data-mimic" },
  { name: "mimic-iii-demo", module: "./adapters/mimic-iii-demo.mjs", dir: "backend/medcore/data-mimic3" }
];

const out = createWriteStream(resolveOut(ROOT, String(arg("out", "backend/medcore/out/pooled.jsonl"))));
let total = 0, events = 0;
const summary = [];

for (const src of SOURCES) {
  if (!existsSync(join(ROOT, src.dir))) { summary.push(`${src.name}: SKIPPED (no data - run its download.sh)`); continue; }
  const mod = await import(src.module);
  const r = mod.encounters({ dir: join(ROOT, src.dir) });
  let n = 0, e = 0;
  for (const enc of r.encounters) {
    out.write(JSON.stringify(enc) + "\n");
    n++; if (enc.events && enc.events.length) e++;
  }
  total += n; events += e;
  summary.push(`${src.name}: ${n} encounters, ${e} with an MC-3 event`);
}
await new Promise((res) => out.end(res));

console.log("pooled extract");
for (const line of summary) console.log("  " + line);
console.log(`  TOTAL ${total} encounters, ${events} with an event`);
console.log("  every row is REAL and openly licensed; none is synthetic");
