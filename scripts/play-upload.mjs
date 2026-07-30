#!/usr/bin/env node
/* Upload a signed AAB to a Google Play track via the Play Developer API (androidpublisher v3).
 * Pure Node (crypto + fetch) — no fastlane / gems. Needs a Play service-account JSON key with the
 * "Release apps to testing tracks" permission (Play Console → Setup → API access).
 *
 * Usage:
 *   node scripts/play-upload.mjs \
 *     --key /path/to/play-service-account.json \
 *     --aab android/app/build/outputs/bundle/release/app-release.aab \
 *     --track internal \
 *     --package in.stewardmd.app \
 *     --notes "Fix prescription scanning on Android + drug-name mapping"
 *
 * --dry-run  : do everything EXCEPT commit (creates the edit + uploads, then discards) — a safe test.
 * Env fallback: PLAY_SA_KEY (key path). track defaults to "internal"; package to in.stewardmd.app.
 */
import { readFileSync } from "node:fs";
import crypto from "node:crypto";

function arg(name, def) { const i = process.argv.indexOf("--" + name); return i > -1 && process.argv[i + 1] && !process.argv[i + 1].startsWith("--") ? process.argv[i + 1] : def; }
const has = (name) => process.argv.includes("--" + name);
const KEY = arg("key", process.env.PLAY_SA_KEY);
const AAB = arg("aab", "android/app/build/outputs/bundle/release/app-release.aab");
const TRACK = arg("track", "internal");
const PKG = arg("package", "in.stewardmd.app");
const NOTES = arg("notes", "");
const DRY = has("dry-run");
const API = "https://androidpublisher.googleapis.com/androidpublisher/v3/applications/" + PKG;
const UPLOAD = "https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/" + PKG;

if (!KEY) { console.error("ERROR: --key <play-service-account.json> (or PLAY_SA_KEY) is required."); process.exit(2); }

function b64url(buf) { return Buffer.from(buf).toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }

async function accessToken(sa) {
  const now = Math.floor(Date.now() / 1000);
  const head = b64url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const claim = b64url(JSON.stringify({ iss: sa.client_email, scope: "https://www.googleapis.com/auth/androidpublisher", aud: "https://oauth2.googleapis.com/token", iat: now, exp: now + 3600 }));
  const sig = b64url(crypto.sign("RSA-SHA256", Buffer.from(head + "." + claim), sa.private_key));
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: head + "." + claim + "." + sig }) });
  const j = await r.json();
  if (!j.access_token) throw new Error("OAuth token failed: " + JSON.stringify(j));
  return j.access_token;
}

async function api(tok, url, method, body, ctype) {
  const headers = { Authorization: "Bearer " + tok };
  if (ctype) headers["Content-Type"] = ctype;
  const r = await fetch(url, { method: method, headers: headers, body: body });
  const txt = await r.text();
  let j = null; try { j = txt ? JSON.parse(txt) : {}; } catch (e) { j = { raw: txt }; }
  if (!r.ok) throw new Error(method + " " + url.replace(API, "").replace(UPLOAD, "") + " → HTTP " + r.status + ": " + txt.slice(0, 400));
  return j;
}

(async () => {
  const sa = JSON.parse(readFileSync(KEY, "utf8"));
  const aabBytes = readFileSync(AAB);
  console.log("• package:", PKG, "· track:", TRACK, "· aab:", AAB, "(" + (aabBytes.length / 1048576).toFixed(1) + " MB)", DRY ? "· DRY-RUN" : "");
  const tok = await accessToken(sa);
  console.log("✓ authenticated as", sa.client_email);

  const edit = await api(tok, API + "/edits", "POST", "{}", "application/json");
  const editId = edit.id;
  console.log("✓ edit created:", editId);

  const up = await api(tok, UPLOAD + "/edits/" + editId + "/bundles?uploadType=media", "POST", aabBytes, "application/octet-stream");
  console.log("✓ AAB uploaded — versionCode", up.versionCode, "· sha1", (up.sha1 || "").slice(0, 12));

  const rel = { versionCodes: [String(up.versionCode)], status: "completed" };
  if (NOTES) rel.releaseNotes = [{ language: "en-US", text: NOTES }];
  await api(tok, API + "/edits/" + editId + "/tracks/" + TRACK, "PUT", JSON.stringify({ track: TRACK, releases: [rel] }), "application/json");
  console.log("✓ assigned versionCode", up.versionCode, "to track:", TRACK);

  if (DRY) {
    await api(tok, API + "/edits/" + editId, "DELETE", null, null).catch(() => {});
    console.log("• DRY-RUN: edit discarded (nothing published). Re-run without --dry-run to release.");
    return;
  }
  const done = await api(tok, API + "/edits/" + editId + ":commit", "POST", "{}", "application/json");
  console.log("✅ COMMITTED — release is live on the", TRACK, "track. editId:", done.id || editId);
})().catch((e) => { console.error("✗ UPLOAD FAILED:", e.message); process.exit(1); });
