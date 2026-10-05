#!/usr/bin/env node
// Upload the built PrepNucleus bank to R2 (bucket stewardmd-offline, prefix prep-bank/), where
// functions/api/prep/bank/[[path]].js serves it. Dev-only, run by the owner with wrangler logged in.
//
//   node tools/prep-upload-bank.mjs [--dir prep/bank/v1] [--only <subject>] [--yes] [--jobs 6]
//
// Without --yes it lists what it would upload and the total size. Uploads module and search files first and
// manifest.json last, so the app never sees a manifest that names files not yet in the bucket. Files are
// immutable within a version: rebuild into a new version folder (v2, ...) rather than overwrite a published one.
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "stewardmd-offline", PREFIX = "prep-bank";

export function listFiles(dir) {
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (f.name.endsWith(".json")) out.push(p); } };
  walk(dir);
  const ver = path.basename(dir);
  const rel = (p) => ver + "/" + path.relative(dir, p).split(path.sep).join("/");
  return out.map((p) => ({ src: p, key: `${PREFIX}/${rel(p)}`, bytes: fs.statSync(p).size, last: path.basename(p) === "manifest.json" }))
    .sort((a, b) => (a.last - b.last) || (a.key < b.key ? -1 : 1));
}
export function putArgs(f) {
  const cache = f.last ? "public, max-age=300" : "public, max-age=31536000, immutable";
  return ["wrangler", "r2", "object", "put", `${BUCKET}/${f.key}`, "--file", f.src, "--content-type", "application/json", "--cache-control", cache, "--remote"];
}
function run(args) {
  return new Promise((res, rej) => {
    const p = spawn("npx", args, { stdio: ["ignore", "ignore", "pipe"] });
    let err = "";
    p.stderr.on("data", (d) => { err += d; });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.slice(-400)))));
  });
}

async function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const dir = path.resolve(ROOT, arg("--dir", "prep/bank/v1"));
  const only = arg("--only", null);
  const jobs = Math.max(1, Math.min(16, Number(arg("--jobs", 6)) || 6));
  let files = listFiles(dir);
  if (only) files = files.filter((f) => f.key.includes(`/${only}/`));
  const mb = files.reduce((a, f) => a + f.bytes, 0) / 1e6;
  console.log(`${files.length} files, ${mb.toFixed(1)} MB -> r2://${BUCKET}/${PREFIX}/`);
  if (!argv.includes("--yes")) { for (const f of files.slice(0, 8)) console.log("  " + f.key); console.log("dry run: add --yes to upload"); return; }
  const body = files.filter((f) => !f.last), tail = files.filter((f) => f.last);
  let done = 0, i = 0;
  const worker = async () => { while (i < body.length) { const f = body[i++]; await run(putArgs(f)); if (++done % 50 === 0) console.log(`  ${done}/${files.length}`); } };
  await Promise.all(Array.from({ length: jobs }, worker));
  for (const f of tail) { await run(putArgs(f)); done++; }
  console.log(`uploaded ${done} files`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
