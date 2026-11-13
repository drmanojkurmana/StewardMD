/* functions/api/content-key.js — GET /api/content-key
 *
 * Returns { keyId, key } (base64 AES-256 key) only when the request carries a valid
 * Firebase App Check token (X-Firebase-AppCheck) OR a valid Firebase ID token
 * (Authorization: Bearer …). Keys live in the Pages secret SMD_CONTENT_KEYS
 * (JSON map keyId → base64). Never committed.
 *
 * Query: ?keyId=<id> optional; default = env.SMD_CONTENT_KEY_ID or the sole map entry.
 * Cache-Control: private, no-store. Rate-limited per uid/IP.
 */
import { verifyFirebaseToken } from "../_fbauth.js";
import { verifyAppCheck } from "../_appcheck.js";
import { hitLimit, clientIp } from "../_ratelimit.js";
import { usageKv } from "../_usage.js";

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: {
      "Content-Type": "application/json",
      "Cache-Control": "private, no-store",
      "Pragma": "no-cache",
    },
  });
}

function parseKeys(env) {
  const raw = env && env.SMD_CONTENT_KEYS;
  if (!raw) return null;
  try {
    const m = typeof raw === "string" ? JSON.parse(raw) : raw;
    return m && typeof m === "object" ? m : null;
  } catch (e) { return null; }
}

function pickKey(map, wantId, env) {
  if (!map) return null;
  if (wantId) {
    // Explicit id requested: never fall back to another key (rotation / wrong-id must 404).
    if (map[wantId]) return { keyId: wantId, key: String(map[wantId]) };
    return null;
  }
  const def = (env && env.SMD_CONTENT_KEY_ID) || "";
  if (def && map[def]) return { keyId: def, key: String(map[def]) };
  const ids = Object.keys(map);
  if (ids.length === 1) return { keyId: ids[0], key: String(map[ids[0]]) };
  // Prefer the lexicographically latest id as a stable default when several exist.
  if (ids.length) {
    ids.sort();
    const id = ids[ids.length - 1];
    return { keyId: id, key: String(map[id]) };
  }
  return null;
}

export async function onRequest(context) {
  const { request, env, waitUntil } = context;
  if (request.method === "OPTIONS") {
    return new Response(null, {
      status: 204,
      headers: {
        "Access-Control-Allow-Methods": "GET, OPTIONS",
        "Access-Control-Allow-Headers": "Authorization, X-Firebase-AppCheck, Content-Type",
        "Access-Control-Max-Age": "86400",
        "Cache-Control": "private, no-store",
      },
    });
  }
  if (request.method !== "GET") return json({ error: "method" }, 405);

  // Gate: App Check OR Firebase ID token.
  let uid = null;
  let appOk = false;
  try {
    const ac = await verifyAppCheck(request, env);
    appOk = !!(ac && ac.ok);
  } catch (e) { appOk = false; }
  try {
    const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (tok) uid = await verifyFirebaseToken(tok, env);
  } catch (e) { uid = null; }

  if (!appOk && !uid) return json({ error: "auth", message: "App Check or signed-in account required" }, 401);

  // Rate limit: 30 / min per uid or IP.
  const store = usageKv(env);
  const bucketId = uid ? ("u:" + uid) : ("ip:" + (clientIp(request) || "anon"));
  const rl = await hitLimit(store, "content-key", bucketId, 30, 60, waitUntil);
  if (!rl.ok) return json({ error: "rate_limited" }, 429);

  const map = parseKeys(env);
  if (!map) return json({ error: "unconfigured", message: "SMD_CONTENT_KEYS secret not set" }, 503);

  let wantId = "";
  try { wantId = new URL(request.url).searchParams.get("keyId") || ""; } catch (e) {}
  const picked = pickKey(map, wantId, env);
  if (!picked) {
    if (wantId) return json({ error: "unknown_key", keyId: wantId }, 404);
    return json({ error: "unconfigured" }, 503);
  }

  // Sanity: key must be base64 of 32 bytes.
  try {
    const bin = atob(picked.key);
    if (bin.length !== 32) return json({ error: "bad_key" }, 500);
  } catch (e) { return json({ error: "bad_key" }, 500); }

  return json({ keyId: picked.keyId, key: picked.key });
}
