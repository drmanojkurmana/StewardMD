#!/usr/bin/env node
/* scripts/ota-stage.mjs — stage a build for the OTA update system (Phase 1).
 *
 * Runs in CI on every push to main, AFTER `npm run build:www` has produced www/. It:
 *   1. Hashes every file in www/ (sha256).
 *   2. Uploads only the files whose hash R2 doesn't already have (content-addressed dedup via a
 *      known-hashes index, so a one-line CSS fix uploads one file, not the ~60MB bundle).
 *   3. Writes a manifest (commit + file list) and updates the `candidate` pointer.
 *
 * It NEVER touches the live channel (ota/channels/stable.json) — staging a build and going live
 * are deliberately two different acts by two different people (CI vs. the owner in the admin
 * console). See functions/_ota.js for why that separation exists.
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID (env) and `wrangler` on PATH.
 * Usage: node scripts/ota-stage.mjs [--commit SHA] [--message "..."] [--dry-run]
 */
import { createHash } from "node:crypto";
import { readdirSync, statSync, readFileSync, mkdtempSync, writeFileSync, rmSync, existsSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync, execFile } from "node:child_process";
import { promisify } from "node:util";
const execFileP = promisify(execFile);
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const WWW = join(ROOT, "www");
const BUCKET = "stewardmd-offline";
const args = process.argv.slice(2);
const flag = (name, def) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : def; };
const DRY = args.includes("--dry-run");
const COMMIT = flag("--commit", process.env.GITHUB_SHA || "local");
const MESSAGE = flag("--message", process.env.OTA_COMMIT_MESSAGE || "");

const MIME = {
  ".js": "application/javascript", ".css": "text/css", ".html": "text/html; charset=utf-8",
  ".json": "application/json", ".png": "image/png", ".jpg": "image/jpeg", ".jpeg": "image/jpeg",
  ".webp": "image/webp", ".svg": "image/svg+xml", ".ico": "image/x-icon", ".gif": "image/gif",
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm", ".mp4": "video/mp4",
  ".manifest": "text/cache-manifest", ".webmanifest": "application/manifest+json",
};
function mimeFor(path) { return MIME[extname(path).toLowerCase()] || "application/octet-stream"; }

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    if (name === ".DS_Store") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
function sha256(buf) { return createHash("sha256").update(buf).digest("hex"); }

function wrangler(args, opts = {}) {
  return execFileSync("wrangler", args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
}
function r2Get(key, fallback) {
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "obj");
  try {
    execFileSync("wrangler", ["r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--file", tmp], { stdio: "pipe" });
    const text = readFileSync(tmp, "utf8");
    rmSync(tmp, { force: true });
    return JSON.parse(text);
  } catch (e) { return fallback; }
}
function r2PutJSON(key, obj) {
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "obj.json");
  writeFileSync(tmp, JSON.stringify(obj));
  if (DRY) { console.log(`  [dry-run] would write ${key} (${JSON.stringify(obj).length}B)`); return; }
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--file", tmp, "--content-type", "application/json", "--remote"], { quiet: true });
}
/* Asynchronous on purpose (2026-11-20): this used execFileSync, which blocks the event loop, so pool(…, 24) below ran
   ONE upload at a time and a large change (about 2,000 new files after the calculators and lessons merges) took most of
   the 120-minute job, cancelled again by every newer push to main. Awaiting a child process lets 24 run at once. */
// `wrangler r2 object put` refuses files over 300 MiB (the app zip passed that on 2026-11-22: 304.5 MiB).
// Bigger files go through R2's S3-compatible API with the AWS CLI (preinstalled on ubuntu-latest), which
// does multipart uploads on its own. Credentials come from the SAME CLOUDFLARE_API_TOKEN wrangler uses
// (Cloudflare's documented mapping: access key id = the token's id, secret = sha256 hex of the token
// value), so no extra secret is needed. R2_ACCESS_KEY_ID / R2_SECRET_ACCESS_KEY override it if set.
const WRANGLER_MAX = 300 * 1024 * 1024;
let _s3Creds = null;
async function s3Creds() {
  if (_s3Creds) return _s3Creds;
  if (process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    return (_s3Creds = { id: process.env.R2_ACCESS_KEY_ID, secret: process.env.R2_SECRET_ACCESS_KEY });
  }
  const tok = process.env.CLOUDFLARE_API_TOKEN, acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!tok) throw new Error("no CLOUDFLARE_API_TOKEN for the large-file upload");
  const urls = ["https://api.cloudflare.com/client/v4/user/tokens/verify",
                acct && `https://api.cloudflare.com/client/v4/accounts/${acct}/tokens/verify`].filter(Boolean);
  for (const u of urls) {
    try {
      const r = await fetch(u, { headers: { Authorization: `Bearer ${tok}` } });
      const j = await r.json();
      if (j && j.success && j.result && j.result.id) {
        return (_s3Creds = { id: j.result.id, secret: createHash("sha256").update(tok).digest("hex") });
      }
    } catch (e) { /* try the next form */ }
  }
  throw new Error("could not read the API token id for R2 S3 credentials");
}
function s3Args(key, path, contentType) {
  const acct = process.env.CLOUDFLARE_ACCOUNT_ID;
  if (!acct) throw new Error("CLOUDFLARE_ACCOUNT_ID is not set");
  return ["s3", "cp", path, `s3://${BUCKET}/${key}`, "--content-type", contentType,
          "--endpoint-url", `https://${acct}.r2.cloudflarestorage.com`, "--region", "auto", "--only-show-errors"];
}
const s3Env = (c) => ({ ...process.env, AWS_ACCESS_KEY_ID: c.id, AWS_SECRET_ACCESS_KEY: c.secret,
  AWS_REQUEST_CHECKSUM_CALCULATION: "WHEN_REQUIRED", AWS_RESPONSE_CHECKSUM_VALIDATION: "WHEN_REQUIRED" });

async function r2PutFile(key, path, contentType) {
  if (DRY) { console.log(`  [dry-run] would upload ${key}`); return; }
  const big = statSync(path).size > WRANGLER_MAX;
  let lastErr = null;
  for (let attempt = 1; attempt <= 3; attempt++) {
    try {
      if (big) await execFileP("aws", s3Args(key, path, contentType), { encoding: "utf8", maxBuffer: 16 * 1024 * 1024, env: s3Env(await s3Creds()) });
      else await execFileP("wrangler", ["r2", "object", "put", `${BUCKET}/${key}`, "--file", path, "--content-type", contentType, "--remote"], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      return;
    } catch (e) {
      lastErr = e;
      if (attempt < 3) {
        console.warn(`  ⚠️ Retry ${attempt}/3 for ${key}: ${e.message}`);
        await new Promise((r) => setTimeout(r, 2000));
      }
    }
  }
  throw lastErr;
}

// Bounded concurrency — thousands of individual `wrangler` process spawns run serially by default,
// which would make a first-ever (cold-cache) run take far too long in a 15-minute CI job.
async function pool(items, limit, fn) {
  const results = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; results[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return results;
}

async function main() {
  console.log(`▸ OTA stage — commit ${COMMIT.slice(0, 12)}${DRY ? " (DRY RUN)" : ""}`);
  const files = walk(WWW);
  if (!files.length) { console.error(`✗ ${WWW} is empty — run \`npm run build:www\` first`); process.exit(1); }

  const known = new Set(r2Get("ota/known-hashes.json", []));
  const manifestFiles = [];
  let uploaded = 0, totalBytes = 0;

  const entries = files.map((abs) => {
    const rel = relative(WWW, abs).split("\\").join("/");   // posix path even if staged on Windows
    const buf = readFileSync(abs);
    const hash = sha256(buf);
    totalBytes += buf.length;
    return { abs, rel, hash, size: buf.length };
  });

  const toUpload = entries.filter((e) => !known.has(e.hash));
  console.log(`▸ ${entries.length} files, ${(totalBytes / 1e6).toFixed(1)} MB total; ${toUpload.length} new (content-addressed dedup)`);

  // BUG (2026-08-22/23): a `wrangler r2 object put` invocation costs ~15-20s of CLI overhead per
  // file (cold Node start + wrangler's own init), not network time - a first-ever run (all files
  // "new") blew well past the 15-minute CI timeout 3 runs in a row tonight. Worse, known-hashes.json
  // used to write only ONCE at the very end, so a timeout-killed run saved NO dedup progress - the
  // next run started from zero and timed out again too, forever. Persist the cache every 100 files
  // (and in `finally`, so even a hard kill leaves whatever got through), so a second run only has to
  // upload what the first one didn't finish, converging instead of repeating.
  try {
    await pool(toUpload, 24, async (e) => {
      await r2PutFile(`ota/files/${e.hash}`, e.abs, mimeFor(e.rel));
      known.add(e.hash);
      uploaded++;
      if (uploaded % 50 === 0) console.log(`  … ${uploaded}/${toUpload.length} uploaded`);
      if (uploaded % 100 === 0) r2PutJSON("ota/known-hashes.json", Array.from(known));
    });
  } finally {
    if (uploaded > 0) r2PutJSON("ota/known-hashes.json", Array.from(known));
  }

  for (const e of entries) manifestFiles.push({ path: e.rel, hash: e.hash, size: e.size });
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path));   // stable diffs between manifests

  // @capgo/capacitor-updater's download() wants ONE zip URL (index.html at the root or inside a
  // single top-level folder) — it does not fetch a per-file manifest itself. The per-file hashes
  // above are still useful (admin diff stats, future delta path) but the zip is what a device
  // actually pulls. `zip` is preinstalled on the GitHub Actions ubuntu-latest image.
  const zipPath = join(mkdtempSync(join(tmpdir(), "ota-")), `${COMMIT}.zip`);
  console.log("▸ zipping www/ …");
  execFileSync("zip", ["-r", "-q", "-X", zipPath, "."], { cwd: WWW, stdio: "inherit" });   // local-only, safe under --dry-run too
  let zipHash = null, zipSize = 0;
  if (existsSync(zipPath)) {
    const zipBuf = readFileSync(zipPath);
    zipHash = sha256(zipBuf); zipSize = zipBuf.length;
    if (!known.has(zipHash)) { await r2PutFile(`ota/files/${zipHash}`, zipPath, "application/zip"); known.add(zipHash); }
    console.log(`  zip: ${(zipSize / 1e6).toFixed(1)} MB, sha256 ${zipHash.slice(0, 12)}…`);
  }

  const builtAt = new Date().toISOString();
  const manifest = {
    commit: COMMIT, message: MESSAGE, builtAt,
    totalFiles: entries.length, totalBytes, changedFiles: toUpload.length,
    zipHash, zipSize,
    files: manifestFiles,
  };
  r2PutJSON(`ota/manifests/${COMMIT}.json`, manifest);
  r2PutJSON("ota/known-hashes.json", Array.from(known));
  r2PutJSON("ota/candidate.json", { commit: COMMIT, manifestKey: `ota/manifests/${COMMIT}.json`, message: MESSAGE, builtAt });

  console.log(`✔ staged: ${uploaded} file(s) uploaded, candidate = ${COMMIT.slice(0, 12)}`);
  console.log(`  Nothing is live yet — an owner must press "Push to devices" in the admin console.`);
}

main().catch((e) => { console.error("✗ ota-stage failed:", e.message); process.exit(1); });
