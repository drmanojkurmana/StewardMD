#!/usr/bin/env node
/**
 * StewardMD — self-hosted OTA release tool (Cloudflare R2 + the stewardmd-api Worker).
 * ---------------------------------------------------------------------------
 * Publishes the current web build as an OTA bundle that installed apps pick up
 * on next launch — NO app-store release. Content-addressed, so only changed
 * files are uploaded (release-side) and downloaded (device-side).
 *
 * Usage:
 *   node scripts/ota-release.mjs --min-native 3 [--channel production] [--dry-run]
 *   node scripts/ota-release.mjs --rollback <version> [--channel production]
 *
 * --min-native  native build number this web bundle needs (gates old binaries).
 * --channel     production (default) | beta | ...
 * --dry-run     hash + build manifest locally, print the plan, upload NOTHING.
 * --rollback    just repoint the channel to an already-published version.
 *
 * Requires: CLOUDFLARE_API_TOKEN (R2 edit) + CLOUDFLARE_ACCOUNT_ID in env, the
 * `zip` CLI, and network access. Reuses bucket `stewardmd-offline` (prefix ota/).
 */
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, readdirSync, statSync, mkdtempSync, rmSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const ROOT = new URL("..", import.meta.url).pathname;
const WWW = join(ROOT, "www");
const BUCKET = "stewardmd-offline";

function arg(name, def) {
  const i = process.argv.indexOf("--" + name);
  if (i < 0) return def;
  const v = process.argv[i + 1];
  return (v && !v.startsWith("--")) ? v : true;
}
const CHANNEL = String(arg("channel", "production"));
const DRY = !!arg("dry-run", false);
const ROLLBACK = arg("rollback", null);
const DISARM = !!arg("disarm", false);
const MIN_NATIVE = String(arg("min-native", "") || "");

function sh(cmd, args) { return execFileSync(cmd, args, { cwd: ROOT, stdio: ["ignore", "pipe", "pipe"] }); }
function wrangler(args) { return sh("npx", ["--yes", "wrangler", ...args]); }

function r2Put(key, file, contentType) {
  if (DRY) { console.log(`  [dry] put ${key}`); return; }
  const a = ["r2", "object", "put", `${BUCKET}/${key}`, "--file", file, "--remote"];
  if (contentType) a.push("--content-type", contentType);
  // R2 occasionally returns a transient 500 / connectivity blip on a single object; retry with
  // backoff so one hiccup doesn't abort a 283-file release.
  let lastErr;
  for (let attempt = 1; attempt <= 6; attempt++) {
    try { wrangler(a); return; }
    catch (e) {
      lastErr = e;
      if (attempt < 6) { try { console.warn(`  r2 put retry ${attempt}/5 — ${key.slice(-12)}`); execFileSync("sleep", [String(attempt * 2)]); } catch (x) {} }
    }
  }
  throw lastErr;
}
function r2GetJson(key) {
  if (DRY) return null;                     // dry-run stays fully offline (no wrangler/network)
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "o.json");
  try { wrangler(["r2", "object", "get", `${BUCKET}/${key}`, "--file", tmp, "--remote"]); }
  catch (_) { return null; }               // not found → treat as none
  try { return JSON.parse(readFileSync(tmp, "utf8")); } catch (_) { return null; }
}
function putJson(key, obj) {
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "j.json");
  writeFileSync(tmp, JSON.stringify(obj));
  r2Put(key, tmp, "application/json");
}
function walk(dir, base = dir, out = []) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name), st = statSync(p);
    if (st.isDirectory()) walk(p, base, out);
    else out.push({ abs: p, name: relative(base, p).split(sep).join("/") });
  }
  return out;
}
const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/* ---------------- rollback: repoint the channel, upload nothing else ------- */
if (ROLLBACK && typeof ROLLBACK === "string") {
  const man = r2GetJson(`ota/manifests/${CHANNEL}/${ROLLBACK}.json`);
  if (!man) { console.error(`✗ version ${ROLLBACK} not found on channel ${CHANNEL}`); process.exit(1); }
  putJson(`ota/channels/${CHANNEL}.json`, {
    version: man.version, minNativeBuild: man.minNativeBuild || "",
    manifestKey: `ota/manifests/${CHANNEL}/${man.version}.json`, updatedAt: new Date().toISOString(),
  });
  console.log(`✓ rolled ${CHANNEL} back to ${ROLLBACK}`);
  process.exit(0);
}

/* ---------------- disarm: remove the channel pointer so NOTHING is served (OTA retired) ---- */
if (DISARM) {
  // OTA is retired in favour of Xcode / App Store builds. Deleting the channel pointer makes
  // /ota/check return no_channel for this channel → any installed app (even a legacy
  // autoUpdate:true build) stops applying OTA bundles and runs its BUILT-IN (store) bundle.
  // This is the exact opposite of arming a bundle — reversible (a future release re-creates it).
  try { wrangler(["r2", "object", "delete", `${BUCKET}/ota/channels/${CHANNEL}.json`, "--remote"]); }
  catch (e) { console.warn(`  (channel ${CHANNEL} pointer may already be absent)`); }
  console.log(`✓ disarmed channel ${CHANNEL} — no OTA bundle will be served; installs use the store build`);
  process.exit(0);
}

/* ---------------- normal release ------------------------------------------- */
console.log(`OTA release → channel=${CHANNEL} min-native=${MIN_NATIVE || "(none)"} ${DRY ? "(dry-run)" : ""}`);
console.log("• building www …");
if (!DRY || !safeExists(WWW)) sh("bash", [join(ROOT, "scripts", "build-www.sh")]);

const files = walk(WWW);
if (!files.length) { console.error("✗ www/ is empty — build failed"); process.exit(1); }

// hash every file → manifest; note total + which files exist in the current channel manifest.
const entries = [];
const localFiles = new Map();          // hash -> abs path (dedup)
for (const f of files) {
  const buf = readFileSync(f.abs);
  const h = sha256(buf);
  entries.push({ file_name: f.name, file_hash: h });
  if (!localFiles.has(h)) localFiles.set(h, f.abs);
}
entries.sort((a, b) => a.file_name.localeCompare(b.file_name));

const version = `${stamp()}-${gitShort()}`;
console.log(`• version ${version} — ${files.length} files, ${localFiles.size} unique`);

// release-side delta: only upload hashes not already in the previous manifest.
const prevPtr = r2GetJson(`ota/channels/${CHANNEL}.json`);
const prevMan = prevPtr && prevPtr.version ? r2GetJson(`ota/manifests/${CHANNEL}/${prevPtr.version}.json`) : null;
const known = new Set((prevMan && prevMan.files || []).map((e) => e.file_hash));
const toUpload = [...localFiles.keys()].filter((h) => !known.has(h));
console.log(`• uploading ${toUpload.length} new/changed files (${localFiles.size - toUpload.length} reused)`);
for (const h of toUpload) r2Put(`ota/files/${h}`, localFiles.get(h), "application/octet-stream");

// full-bundle zip (the `url` fallback + first-install path).
const zip = join(mkdtempSync(join(tmpdir(), "ota-zip-")), `${version}.zip`);
if (!DRY) { sh("bash", ["-c", `cd "${WWW}" && zip -rqX "${zip}" .`]); }
const zipChecksum = DRY ? "(dry)" : sha256(readFileSync(zip));
r2Put(`ota/bundles/${version}.zip`, DRY ? WWW : zip, "application/zip");

// manifest, then the channel pointer LAST (atomic publish).
const manifest = { version, checksum: zipChecksum, minNativeBuild: MIN_NATIVE, files: entries, createdAt: new Date().toISOString() };
putJson(`ota/manifests/${CHANNEL}/${version}.json`, manifest);
putJson(`ota/channels/${CHANNEL}.json`, {
  version, minNativeBuild: MIN_NATIVE, manifestKey: `ota/manifests/${CHANNEL}/${version}.json`, updatedAt: new Date().toISOString(),
});

console.log(DRY ? `✓ dry-run OK — would publish ${version} to ${CHANNEL}` : `✓ published ${version} to ${CHANNEL} — installed apps will update on next launch`);
if (!DRY) try { rmSync(zip, { force: true }); } catch (_) {}

/* ---------------- helpers -------------------------------------------------- */
function stamp() {
  const d = new Date(), p = (n) => String(n).padStart(2, "0");
  return `${d.getUTCFullYear()}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}`;
}
function gitShort() { try { return sh("git", ["rev-parse", "--short", "HEAD"]).toString().trim() || "nogit"; } catch (_) { return "nogit"; } }
function safeExists(p) { try { statSync(p); return true; } catch (_) { return false; } }
