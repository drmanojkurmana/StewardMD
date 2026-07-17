/**
 * StewardMD — self-hosted OTA update backend for @capgo/capacitor-updater.
 * ---------------------------------------------------------------------------
 * Runs inside the existing stewardmd-api Worker (api.stewardmd.in) and stores
 * bundles in the existing R2 bucket (OFFLINE_BUCKET = stewardmd-offline) under
 * the `ota/` prefix. RUNTIME IS READ-ONLY — the release script
 * (scripts/ota-release.mjs) is the only writer (via `wrangler r2 object put`).
 *
 * Content-addressed layout → free delta updates (only changed files download)
 * and storage dedup (identical files across versions share one object):
 *   ota/channels/<channel>.json      { version, minNativeBuild, manifestKey, updatedAt }
 *   ota/manifests/<channel>/<v>.json { version, checksum, minNativeBuild, files:[{file_name,file_hash}], sessionKey? }
 *   ota/files/<sha256>               one web file, immutable (content-addressed)
 *   ota/bundles/<version>.zip        full bundle (the `url` fallback), immutable
 *
 * Endpoints (wired in src/index.js under /ota/*):
 *   GET  /ota/check                the plugin's updateUrl — decides if an update applies
 *   GET  /ota/file/<sha256>        serve one content-addressed file (immutable, ETag/304)
 *   GET  /ota/bundle/<version>.zip serve the full bundle zip (immutable, ETag/304)
 *   POST /ota/stats                the plugin's statsUrl — best-effort sink, always 200
 *
 * SECURITY / INTEGRITY: bundles are public (same files as the web app), so no
 * user auth is needed here — abuse is bounded by the Worker's per-IP rate limit
 * (RL) and a light app-id check. Tamper-resistance comes from the sha256
 * `checksum` the plugin verifies, and (optionally) end-to-end signing via a
 * `publicKey` in capacitor.config + a `sessionKey` in the manifest.
 */

const OTA_ORIGIN = "https://api.stewardmd.in";
const APP_ID = "in.stewardmd.app";

function j(data, status = 200, extra = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", ...extra },
  });
}

// The plugin sends these as request headers on each app-open check.
function capInfo(request, url) {
  const h = request.headers;
  const get = (k, q) => h.get(k) || url.searchParams.get(q) || "";
  return {
    platform: get("cap_platform", "platform"),
    appId: get("cap_app_id", "app_id"),
    nativeBuild: get("cap_version_build", "version_build"),   // native store build number
    current: get("cap_version_name", "version_name") || "builtin", // current OTA bundle, or "builtin"
    plugin: h.get("cap_plugin_version") || "",
    channel: get("cap_channel", "channel") || "production",
  };
}

// Compare dotted build numbers numerically (e.g. "42" >= "40", "1.2.0" >= "1.1.9").
function nativeAtLeast(build, min) {
  if (!min) return true;
  const a = String(build).split(".").map((n) => parseInt(n, 10) || 0);
  const b = String(min).split(".").map((n) => parseInt(n, 10) || 0);
  const len = Math.max(a.length, b.length);
  for (let i = 0; i < len; i++) { const x = a[i] || 0, y = b[i] || 0; if (x !== y) return x > y; }
  return true;
}

async function readJson(env, key) {
  const obj = await env.OFFLINE_BUCKET.get(key);
  if (!obj) return null;
  try { return JSON.parse(await obj.text()); } catch (_) { return null; }
}

// Any 200 body WITHOUT a `url` is a no-op for the plugin (it won't download).
// We echo the caller's current version so "no update" is unambiguous.
async function handleCheck(request, env, url) {
  if (!env.OFFLINE_BUCKET) return j({ message: "ota_unavailable" });
  const cap = capInfo(request, url);
  if (cap.appId && cap.appId !== APP_ID) return j({ version: cap.current, message: "unknown_app" });
  const channel = /^[a-z0-9_-]{1,32}$/i.test(cap.channel) ? cap.channel : "production";

  const ptr = await readJson(env, `ota/channels/${channel}.json`);
  if (!ptr || !ptr.version) return j({ version: cap.current, message: "no_channel" });
  if (ptr.version === cap.current) return j({ version: ptr.version, message: "up_to_date" });
  if (!nativeAtLeast(cap.nativeBuild, ptr.minNativeBuild))
    return j({ version: cap.current, message: "native_update_required" });

  const man = await readJson(env, ptr.manifestKey || `ota/manifests/${channel}/${ptr.version}.json`);
  if (!man || !man.version) return j({ version: cap.current, message: "manifest_missing" });

  const manifest = (man.files || []).map((f) => ({
    file_name: f.file_name,
    file_hash: f.file_hash,
    download_url: `${OTA_ORIGIN}/ota/file/${f.file_hash}`,
  }));
  const body = {
    version: man.version,
    url: `${OTA_ORIGIN}/ota/bundle/${encodeURIComponent(man.version)}.zip`, // fallback if plugin can't delta
    manifest,                                                               // delta: only changed hashes download
  };
  if (man.checksum) body.checksum = man.checksum;
  if (man.sessionKey) body.sessionKey = man.sessionKey; // present only when E2E-encrypted
  return j(body);
}

async function serveR2(request, env, key, contentType) {
  if (!env.OFFLINE_BUCKET) return j({ error: "ota_unavailable" }, 503);
  const obj = await env.OFFLINE_BUCKET.get(key);
  if (!obj) return j({ error: "not_found" }, 404);
  const etag = obj.httpEtag;
  if (request.headers.get("If-None-Match") === etag) return new Response(null, { status: 304, headers: { ETag: etag } });
  return new Response(obj.body, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Length": String(obj.size),
      "ETag": etag,
      // content-addressed / version-pinned → immutable, cache hard at the edge (free egress).
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

const isHash = (s) => /^[a-f0-9]{64}$/i.test(s);
const isVersion = (s) => /^[a-z0-9._-]{1,64}$/i.test(s);

async function handleStats(request, env) {
  try { await request.text(); } catch (_) {}   // accept + discard (no device telemetry stored)
  return j({ ok: true });
}

export async function handleOta(request, env, url) {
  const path = url.pathname.replace(/\/+$/, "");
  if (path === "/ota/check") {
    if (request.method !== "GET" && request.method !== "POST") return j({ error: "method_not_allowed" }, 405);
    return handleCheck(request, env, url);
  }
  if (path === "/ota/stats") return handleStats(request, env);
  if (request.method !== "GET") return j({ error: "method_not_allowed" }, 405);
  if (path.startsWith("/ota/file/")) {
    const hash = decodeURIComponent(path.slice("/ota/file/".length)).toLowerCase();
    if (!isHash(hash)) return j({ error: "bad_hash" }, 400);
    return serveR2(request, env, `ota/files/${hash}`, "application/octet-stream");
  }
  if (path.startsWith("/ota/bundle/")) {
    const v = decodeURIComponent(path.slice("/ota/bundle/".length)).replace(/\.zip$/i, "");
    if (!isVersion(v)) return j({ error: "bad_version" }, 400);
    return serveR2(request, env, `ota/bundles/${v}.zip`, "application/zip");
  }
  return j({ error: "not_found" }, 404);
}
