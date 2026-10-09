// Builds kb/dist/handouts/bNN.json: 64 on-demand buckets of patient handouts.
// Bucket = djb2(id) % 64, the same function as build-kb-v2.mjs (copied, because that
// file runs its build on import). Each bucket: { <id>: { title, sections, urgent, status } }.
// Atomic writes: temp file then rename.
// usage: node kb/tools/build-handouts.mjs
import { readdirSync, readFileSync, mkdirSync, writeFileSync, renameSync, rmSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { validateHandout } from "./validate-handouts.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const SRC = join(ROOT, "kb", "handouts");
const OUT = join(ROOT, "kb", "dist", "handouts");
const BUCKETS = 64;

export function bucketOf(id) {
  let h = 5381;
  for (let i = 0; i < id.length; i++) h = ((h * 33) ^ id.charCodeAt(i)) >>> 0;
  return h % BUCKETS;
}

const buckets = Array.from({ length: BUCKETS }, () => ({}));
let n = 0;
const skipped = [];
for (const f of readdirSync(SRC).filter((x) => x.endsWith(".json")).sort()) {
  const h = JSON.parse(readFileSync(join(SRC, f), "utf8"));
  const { errors } = validateHandout(h, f.replace(/\.json$/, ""));
  if (errors.length) {
    skipped.push(`${f}: ${errors[0]}`);
    continue;
  }
  buckets[bucketOf(h.id)][h.id] = { title: h.title, sections: h.sections, urgent: h.urgent, status: h.status };
  n++;
}

// Stage the whole output, then swap it in, so a failed run never leaves a half-written dir.
const stage = `${OUT}.tmp-${process.pid}`;
rmSync(stage, { recursive: true, force: true });
mkdirSync(stage, { recursive: true });
buckets.forEach((b, i) => {
  const name = `b${String(i).padStart(2, "0")}.json`;
  const tmp = join(stage, `${name}.tmp`);
  writeFileSync(tmp, JSON.stringify(b));
  renameSync(tmp, join(stage, name));
});
rmSync(OUT, { recursive: true, force: true });
renameSync(stage, OUT);
console.log(`handouts: ${n} entries in ${BUCKETS} buckets${skipped.length ? `, ${skipped.length} skipped` : ""}`);
for (const s of skipped) console.error(`skipped ${s}`);
