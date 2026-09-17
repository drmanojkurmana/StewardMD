#!/usr/bin/env node
/* scripts/ota-publish.mjs — publish staged OTA candidate live to devices.
 *
 * Reads `ota/candidate.json` from R2 (staged by CI during ota-stage.mjs),
 * increments the version counter in `ota/channels/stable.json`, and records
 * an audit entry in `ota/history.json`.
 *
 * Requires: CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID and `wrangler` on PATH.
 */
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { execFileSync } from "node:child_process";

const BUCKET = "stewardmd-offline";
const DRY = process.argv.includes("--dry-run");

function wrangler(args, opts = {}) {
  return execFileSync("wrangler", args, { stdio: opts.quiet ? "pipe" : "inherit", encoding: "utf8" });
}

function r2Get(key, fallback = null) {
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "obj");
  try {
    execFileSync("wrangler", ["r2", "object", "get", `${BUCKET}/${key}`, "--remote", "--file", tmp], { stdio: "pipe" });
    const text = readFileSync(tmp, "utf8");
    rmSync(tmp, { force: true });
    return JSON.parse(text);
  } catch (e) {
    return fallback;
  }
}

function r2PutJSON(key, obj) {
  const tmp = join(mkdtempSync(join(tmpdir(), "ota-")), "obj.json");
  writeFileSync(tmp, JSON.stringify(obj));
  if (DRY) {
    console.log(`  [dry-run] would write ${key} (${JSON.stringify(obj).length}B)`);
    return;
  }
  wrangler(["r2", "object", "put", `${BUCKET}/${key}`, "--file", tmp, "--content-type", "application/json", "--remote"], { quiet: true });
}

async function main() {
  console.log("▸ Reading candidate from R2…");
  const candidate = r2Get("ota/candidate.json");
  if (!candidate || !candidate.manifestKey) {
    throw new Error("No candidate staged in R2 (ota/candidate.json missing or invalid). Push a commit to main first.");
  }
  console.log(`▸ Candidate commit: ${candidate.commit} (${candidate.message || "no message"})`);

  console.log("▸ Verifying manifest exists in R2…");
  const manifest = r2Get(candidate.manifestKey);
  if (!manifest) {
    throw new Error(`Manifest missing in R2 at ${candidate.manifestKey}`);
  }
  console.log(`  manifest has ${manifest.totalFiles || (manifest.files && manifest.files.length) || 0} files, zip: ${manifest.zipHash ? manifest.zipHash.slice(0, 12) + "…" : "none"}`);

  console.log("▸ Reading current live channel…");
  const prevChannel = r2Get("ota/channels/stable.json", { version: 0, minNativeBuild: 0 });
  const prevVersion = Number.isFinite(prevChannel?.version) ? prevChannel.version : 0;
  const nextVersion = prevVersion + 1;
  const publishedAt = new Date().toISOString();
  const by = process.env.GITHUB_ACTOR || process.env.USER || "owner";

  const nextChannel = {
    version: nextVersion,
    commit: candidate.commit,
    manifestKey: candidate.manifestKey,
    message: candidate.message || "",
    minNativeBuild: prevChannel?.minNativeBuild || 0,
    rollout: 100,
    publishedAt,
    publishedBy: by,
  };

  console.log(`▸ Publishing v${nextVersion} (was v${prevVersion}) to ota/channels/stable.json…`);
  r2PutJSON("ota/channels/stable.json", nextChannel);

  console.log("▸ Updating audit trail in ota/history.json…");
  const history = r2Get("ota/history.json", []) || [];
  history.unshift({ ...nextChannel, action: "publish", rollbackOf: null });
  r2PutJSON("ota/history.json", history.slice(0, 200));

  console.log(`\n🎉 SUCCESS: Live OTA channel updated to version ${nextVersion}!`);
  console.log(`   Commit: ${candidate.commit}`);
  console.log(`   Published: ${publishedAt} by ${by}`);
  console.log(`   Devices will download this update on next app launch.\n`);
}

main().catch((err) => {
  console.error("✗ ota-publish failed:", err.message);
  process.exit(1);
});
