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
import { readdirSync, statSync, readFileSync, mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { join, relative, extname, dirname } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";
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
  ".woff2": "font/woff2", ".woff": "font/woff", ".wasm": "application/wasm",
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
function r2PutFile(key, path, contentType) {
  if (DRY) { console.log(`  [dry-run] would upload ${key}`); return; }
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--file", path, "--content-type", contentType, "--remote"], { quiet: true });
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

  await pool(toUpload, 12, async (e) => {
    r2PutFile(`ota/files/${e.hash}`, e.abs, mimeFor(e.rel));
    known.add(e.hash);
    uploaded++;
    if (uploaded % 50 === 0) console.log(`  … ${uploaded}/${toUpload.length} uploaded`);
  });

  for (const e of entries) manifestFiles.push({ path: e.rel, hash: e.hash, size: e.size });
  manifestFiles.sort((a, b) => a.path.localeCompare(b.path));   // stable diffs between manifests

  const builtAt = new Date().toISOString();
  const manifest = {
    commit: COMMIT, message: MESSAGE, builtAt,
    totalFiles: entries.length, totalBytes, changedFiles: toUpload.length,
    files: manifestFiles,
  };
  r2PutJSON(`ota/manifests/${COMMIT}.json`, manifest);
  r2PutJSON("ota/known-hashes.json", Array.from(known));
  r2PutJSON("ota/candidate.json", { commit: COMMIT, manifestKey: `ota/manifests/${COMMIT}.json`, message: MESSAGE, builtAt });

  console.log(`✔ staged: ${uploaded} file(s) uploaded, candidate = ${COMMIT.slice(0, 12)}`);
  console.log(`  Nothing is live yet — an owner must press "Push to devices" in the admin console.`);
}

main().catch((e) => { console.error("✗ ota-stage failed:", e.message); process.exit(1); });
