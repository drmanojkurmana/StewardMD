#!/usr/bin/env node
/* Upload to R2 whatever tools/prep-r2-parity.mjs says the repo has and R2 lacks. Dev-only: needs the R2 S3 keys in
 * ~/.stewardmd-secrets/r2-s3.env (tools/prep-r2-s3.mjs) and the tools credential for the parity read.
 *
 *   node tools/prep-r2-sync.mjs            dry run: what would be uploaded
 *   node tools/prep-r2-sync.mjs --apply    upload, then re-run the parity check
 *
 * Safety: an index is only uploaded when every topic live today is still in the repo index (a rebuild that drops a
 * module is never pushed by this tool); overlay and module files are only ever added (a key that exists is never
 * overwritten: published files are immutable, ship changes under a new set or version). */
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { putR2Object } from "./prep-r2-s3.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const APPLY = process.argv.includes("--apply");
const IMMUTABLE = "public, max-age=31536000, immutable", SHORT = "public, max-age=300";
const par = spawnSync("node", [path.join(ROOT, "tools/prep-r2-parity.mjs"), "--json"], { encoding: "utf8", maxBuffer: 1 << 26 });
if (!par.stdout) { console.error(par.stderr || "parity run failed"); process.exit(2); }
const { gaps } = JSON.parse(par.stdout);
const jobs = [];
for (const g of gaps.overlay) jobs.push({ key: g.key, src: "prep/overlays/" + g.key.slice("overlay/".length), cc: IMMUTABLE });
for (const g of gaps.module) { const [v, sid, ...rest] = g.key.split("/"); jobs.push({ key: g.key, src: `prep/bank/${v}/${sid}/${rest.join("/")}`, cc: IMMUTABLE, optional: true }); }
for (const g of gaps.image) jobs.push({ key: g.key, src: "prep/lessons/media/" + g.key.split("/").pop(), cc: IMMUTABLE, type: "image/webp" });
for (const g of gaps.index) jobs.push({ key: g.key, src: "prep/bank/" + g.key, cc: SHORT, index: true });
let n = 0, skip = 0, bad = 0;
for (const j of jobs) {
  const f = path.join(ROOT, j.src);
  if (!fs.existsSync(f)) { if (!j.optional) { console.log("NO REPO FILE", j.key); bad++; } else skip++; continue; }
  if (j.index) {
    // never drop a live topic
    const r = await fetch(new URL("/api/prep/bank/" + j.key, "https://stewardmd.in"), { headers: { "X-SMD-Tool": fs.readFileSync(path.join(process.env.HOME, ".config/stewardmd/tool-token"), "utf8").trim(), Origin: "https://stewardmd.in" } });
    if (r.status === 200) {
      const live = new Set((await r.json()).topics.map((t) => t.id)), repo = new Set(JSON.parse(fs.readFileSync(f, "utf8")).topics.map((t) => t.id));
      const lost = [...live].filter((id) => !repo.has(id));
      if (lost.length) { console.log("SKIP index (would drop live topics)", j.key, lost.slice(0, 4).join(",")); bad++; continue; }
    }
  }
  if (APPLY) await putR2Object("prep-bank/" + j.key, fs.readFileSync(f), j.type || "application/json", j.cc);
  n++; if (n % 100 === 0) console.log(n + " ...");
}
console.log(`${APPLY ? "uploaded" : "would upload"} ${n}, skipped ${skip} optional, problems ${bad}`);
if (APPLY) { const p = spawnSync("node", [path.join(ROOT, "tools/prep-r2-parity.mjs")], { stdio: "inherit" }); process.exit(p.status || (bad ? 1 : 0)); }
