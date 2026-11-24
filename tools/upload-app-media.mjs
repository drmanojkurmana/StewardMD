#!/usr/bin/env node
/* Upload the learning content that leaves the app bundle to R2, at app/<the same path it had in the bundle>
 * (bucket stewardmd-offline, prefix prep-bank/app/), where functions/api/prep/bank/[[path]].js serves it to signed-in
 * users only. Owner 2026-11-12: PrepNucleus lessons, their diagrams and CliniX photos load on first view from R2.
 *
 *   npm run build:www                                  # a normal build first: upload what the app would have shipped
 *   node tools/upload-app-media.mjs                    # list what would go up, and the total size
 *   node tools/upload-app-media.mjs --yes [--jobs 6]   # upload (R2 S3 keys from tools/prep-r2-s3.mjs, else wrangler)
 *   node tools/upload-app-media.mjs --check            # every file answers 200 from stewardmd.in (needs the tool token)
 *   SMD_REMOTE_MEDIA=1 npm run build:www               # ONLY after --check passes: the app stops carrying them
 *
 * Uploads from www/ (not the repo) so R2 holds exactly the shipped bytes: citations stripped (sanitize-sources.mjs) and
 * JSON minified. Re-running is safe: same key, same bytes.
 */
import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUCKET = "stewardmd-offline", PREFIX = "prep-bank/app/";
export const SOURCES = [
  { dir: "prep/lessons/v1", re: /^[a-z0-9-]{2,80}\.json$/, skip: /^index\.json$/ },
  { dir: "prep/lessons/media", re: /^[a-z0-9_-]{2,80}\.(?:svg|webp)$/ },
  { dir: "clinix/media/practicals", re: /^[a-z0-9_-]{2,120}\.webp$/ },
  { dir: "clinix/media/skills", re: /^[a-z0-9_-]{2,120}\.webp$/ },
  { dir: "media/anim", re: /^[a-z0-9_-]{2,80}\.(?:webp|av1\.mp4|mp4)$/ },
  { dir: "surgx/media", re: /^[a-z0-9_-]{2,80}\/[a-z0-9_-]{2,80}\.(?:webp|png|jpe?g)$/, skip: /\.json$/i },
  { dir: "kardia/media/clips", re: /^[a-z0-9_-]{2,80}\.mp4$/ },
  { dir: "kardia/learn/diagrams", re: /^[a-z0-9_-]{2,80}\.svg$/ },
  { dir: "tokos/media", re: /^[a-z0-9_-]{2,40}\/[a-z0-9_-]{2,80}\.(?:webp|svg|png|jpe?g)$/, skip: /\.json$/i },
  { dir: "tokos/learn", re: /^(?:[a-z0-9_-]{1,40}\/){1,2}[a-z0-9_-]{2,80}\.(?:webp|svg|png|jpe?g)$/, skip: /\.json$/i },
  { dir: "ophthalmos/learn/media", re: /^[a-z0-9_-]{2,40}\/[a-z0-9_-]{2,80}\.(?:webp|svg|png|jpe?g)$/, skip: /\.json$/i },
  { dir: "ophthalmos/learn/diagrams", re: /^[a-z0-9_-]{2,80}\.svg$/ },
];
const MEDIA_EXT = /\.(?:json|svg|webp|png|jpe?g|mp4)$/i;
export function contentType(f) {
  if (/\.mp4$/i.test(f)) return "video/mp4";
  if (/\.svg$/i.test(f)) return "image/svg+xml";
  if (/\.png$/i.test(f)) return "image/png";
  if (/\.jpe?g$/i.test(f)) return "image/jpeg";
  if (/\.webp$/i.test(f)) return "image/webp";
  return "application/json";
}

function walkFiles(dir, rel, out) {
  for (const name of fs.readdirSync(dir)) {
    const abs = path.join(dir, name);
    const child = rel ? `${rel}/${name}` : name;
    if (fs.statSync(abs).isDirectory()) walkFiles(abs, child, out);
    else out.push({ name, rel: child, abs, bytes: fs.statSync(abs).size });
  }
}

/* listFiles(www) -> [{ src, rel, key, bytes }], or throws when a file name would not pass the server's route.
 * JSON manifests and credits under the new folders are skipped (they stay in the app). GIF stays in the app too. */
export function listFiles(www) {
  const out = [], bad = [];
  for (const s of SOURCES) {
    const d = path.join(www, s.dir);
    if (!fs.existsSync(d)) throw new Error(`${d} is missing: run a normal "npm run build:www" first (without SMD_REMOTE_MEDIA)`);
    const found = [];
    walkFiles(d, "", found);
    for (const f of found) {
      if (s.skip && (s.skip.test(f.name) || s.skip.test(f.rel))) continue;
      if (!MEDIA_EXT.test(f.name)) continue;
      if (!s.re.test(f.rel)) { bad.push(`${s.dir}/${f.rel}`); continue; }
      const rel = `${s.dir}/${f.rel}`;
      out.push({ src: f.abs, rel, key: PREFIX + rel, bytes: f.bytes });
    }
  }
  if (bad.length) throw new Error("names the server would refuse:\n  " + bad.join("\n  "));
  return out;
}

function wrangler(f) {
  return new Promise((res, rej) => {
    const p = spawn("npx", ["wrangler", "r2", "object", "put", `${BUCKET}/${f.key}`, "--file", f.src, "--content-type", contentType(f.src), "--cache-control", "private, max-age=31536000", "--remote"], { stdio: ["ignore", "ignore", "pipe"] });
    let err = ""; p.stderr.on("data", (d) => { err += d; });
    p.on("close", (c) => (c === 0 ? res() : rej(new Error(err.slice(-400)))));
  });
}
async function put(f, s3) {
  for (let t = 1; ; t++) {
    try { return s3 ? await s3.putR2Object(f.key, f.src, contentType(f.src), "private, max-age=31536000") : await wrangler(f); }
    catch (e) { if (t >= 4) throw e; await new Promise((r) => setTimeout(r, 2000 * t)); }
  }
}
async function pool(items, jobs, fn) {
  let i = 0, done = 0, failed = [];
  await Promise.all(Array.from({ length: jobs }, async () => {
    while (i < items.length) {
      const f = items[i++];
      try { await fn(f); } catch (e) { failed.push(`${f.rel}: ${String(e.message || e).slice(0, 160)}`); }
      if (++done % 200 === 0) console.log(`  ${done}/${items.length}`);
    }
  }));
  return failed;
}

async function main(argv = process.argv.slice(2)) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const www = path.resolve(ROOT, arg("--from", "www"));
  const jobs = Math.max(1, Math.min(16, Number(arg("--jobs", 6)) || 6));
  const files = listFiles(www);
  const mb = (files.reduce((a, f) => a + f.bytes, 0) / 1e6).toFixed(1);

  if (argv.includes("--check")) {
    const { readToken } = await import("./_bank-token.mjs");
    const tok = readToken();
    if (!tok) throw new Error("no tool token ($SMD_TOOL_TOKEN or ~/.config/stewardmd/tool-token)");
    const failed = await pool(files, jobs, async (f) => {
      const r = await fetch("https://stewardmd.in/api/prep/bank/app/" + f.rel, { method: "HEAD", headers: { "X-SMD-Tool": tok } });
      if (r.status !== 200) throw new Error("HTTP " + r.status);
    });
    console.log(failed.length ? `MISSING ${failed.length} of ${files.length}:\n  ` + failed.slice(0, 40).join("\n  ") : `all ${files.length} files answer 200. Safe to build with SMD_REMOTE_MEDIA=1.`);
    process.exit(failed.length ? 1 : 0);
  }
  if (!argv.includes("--yes")) {
    console.log(`${files.length} files, ${mb} MB -> r2://${BUCKET}/${PREFIX}...  (add --yes to upload)`);
    for (const s of SOURCES) console.log(`  ${s.dir}: ${files.filter((f) => f.rel.startsWith(s.dir + "/")).length}`);
    return;
  }
  let s3 = null;
  try { const m = await import("./prep-r2-s3.mjs"); if (m.getR2Config()) s3 = m; } catch (e) {}
  console.log(`uploading ${files.length} files (${mb} MB) via ${s3 ? "R2 S3 API" : "wrangler"}, ${jobs} at a time`);
  const failed = await pool(files, jobs, (f) => put(f, s3));
  if (failed.length) { console.error(`FAILED ${failed.length}:\n  ` + failed.join("\n  ")); process.exit(1); }
  console.log("done. Next: node tools/upload-app-media.mjs --check");
}

if (import.meta.url === "file://" + process.argv[1]) main().catch((e) => { console.error(e.message || e); process.exit(1); });
