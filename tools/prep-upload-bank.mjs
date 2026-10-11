#!/usr/bin/env node
// Upload the built PrepNucleus bank to R2 (bucket stewardmd-offline, prefix prep-bank/), where
// functions/api/prep/bank/[[path]].js serves it. Dev-only, run by the owner with wrangler logged in.
//
//   node tools/prep-upload-bank.mjs [--dir prep/bank/v1] [--only <subject>] [--yes] [--jobs 6]
//   After any upload with --yes the share ID index is rebuilt (node tools/prep-ids.mjs publish --yes; --no-ids skips).
//   node tools/prep-upload-bank.mjs --dir prep/pyq/out --as v2/pyq [--yes]     PYQ files (tools/prep-pyq.mjs): JSON and
//       webp images under prep-bank/v2/pyq/; index.json goes last and gets the short cache (it names the items file)
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

export function listFiles(dir, as) {
  const out = [];
  const walk = (d) => { for (const f of fs.readdirSync(d, { withFileTypes: true })) { const p = path.join(d, f.name); if (f.isDirectory()) walk(p); else if (/\.(json|webp)$/.test(f.name)) out.push(p); } };
  walk(dir);
  const ver = as || path.basename(dir);
  const rel = (p) => ver + "/" + path.relative(dir, p).split(path.sep).join("/");
  const lastName = as ? "index.json" : "manifest.json";
  return out.map((p) => ({ src: p, key: `${PREFIX}/${rel(p)}`, bytes: fs.statSync(p).size, last: path.relative(dir, p) === lastName }))
    .sort((a, b) => (a.last - b.last) || (a.key < b.key ? -1 : 1));
}
import { getR2Config, putR2Object } from "./prep-r2-s3.mjs";
const hasR2S3 = !!getR2Config();

export function putArgs(f) {
  const cache = f.last ? "public, max-age=300" : "public, max-age=31536000, immutable";
  return ["wrangler", "r2", "object", "put", `${BUCKET}/${f.key}`, "--file", f.src, "--content-type", /\.webp$/.test(f.key) ? "image/webp" : "application/json", "--cache-control", cache, "--remote"];
}
// R2 answers the odd transient 500 / auth-refresh error; retry each file a few times before giving up.
async function run(f, tries = 4) {
  for (let t = 1; ; t++) {
    try {
      if (hasR2S3) {
        const cache = f.last ? "public, max-age=300" : "public, max-age=31536000, immutable";
        const ct = /\.webp$/.test(f.key) ? "image/webp" : "application/json";
        return await putR2Object(f.key, f.src, ct, cache);
      }
      return await run1(putArgs(f));
    } catch (e) {
      if (t >= tries) throw e;
      await new Promise((r) => setTimeout(r, 2000 * t));
    }
  }
}
function run1(args) {
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
  const as = arg("--as", null);
  if (as && !/^(?:v\d{1,3}|overlay)\/[a-z0-9-]+$/.test(as)) throw new Error("--as must look like v2/pyq or overlay/maik1");
  let files = listFiles(dir, as);
  if (only) files = files.filter((f) => f.key.includes(`/${only}/`));
  const mb = files.reduce((a, f) => a + f.bytes, 0) / 1e6;
  console.log(`${files.length} files, ${mb.toFixed(1)} MB -> r2://${BUCKET}/${PREFIX}/`);
  if (!argv.includes("--yes")) { for (const f of files.slice(0, 8).concat(files.filter((f) => f.last))) console.log("  " + f.key); console.log("dry run: add --yes to upload"); return; }
  const body = files.filter((f) => !f.last), tail = files.filter((f) => f.last);
  const skip = Number(arg("--skip", 0)) || 0;  // resume an interrupted upload: skip the first n non-manifest files
  let done = skip, i = skip;
  const worker = async () => { while (i < body.length) { const f = body[i++]; await run(f); if (++done % 50 === 0) console.log(`  ${done}/${files.length}`); } };
  await Promise.all(Array.from({ length: jobs }, worker));
  for (const f of tail) { await run(f); done++; }
  console.log(`uploaded ${done} files`);
  // Share IDs: every MCQ and lesson has an ID derived from its item id (prep-ids.js), but the global index that resolves
  // IDs on phones without the content (v1/ids/) must list the new items. Rebuilt here after any bank, overlay, PYQ or
  // lesson upload (it reads the LIVE files, so run it after the upload, as here). --no-ids skips it.
  if (!/\/ids$/.test(as || "") && !argv.includes("--no-ids")) await rebuildIds();
}
export function rebuildIds() {
  console.log("share IDs: node tools/prep-ids.mjs publish --yes");
  return new Promise((res) => {
    const p = spawn(process.execPath, [path.join(ROOT, "tools/prep-ids.mjs"), "publish", "--yes"], { stdio: "inherit" });
    p.on("close", (c) => { if (c !== 0) console.error("share ID index NOT rebuilt (exit " + c + "): run node tools/prep-ids.mjs publish --yes"); res(c); });
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch((e) => { console.error(e.message); process.exit(1); });
