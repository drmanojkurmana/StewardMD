/* StewardMD OTA update system — HTTP surface, PHASE 1.
 *
 *   Device-facing, PUBLIC, no auth (harmless if polled — worst case leaks "is there an update"):
 *     GET /api/ota/check?version=N&nativeBuild=N   → { ota:false } | { ota:true, version, files }
 *     GET /api/ota/file/<sha256>                   → the one content-addressed file, immutable-cached
 *
 *   Admin console, OWNER-gated (same ownerOK() every other admin surface uses):
 *     GET  /api/ota/candidate   → the latest build staged by CI from a push to main (or null)
 *     GET  /api/ota/channel     → what is currently LIVE
 *     GET  /api/ota/history     → publish/rollback/kill audit trail
 *     POST /api/ota/publish     { minNativeBuild? }        → push the candidate live
 *     POST /api/ota/rollback    { toVersion }               → republish an old version (new version #)
 *     POST /api/ota/kill        { on: true|false }          → the kill switch (no redeploy needed)
 *
 * PHASE 1 SCOPE: this is the complete control plane, exercised end to end from the admin console.
 * Nothing in the shipped app calls /api/ota/check yet — that is Phase 2's job, once the exact
 * @capgo/capacitor-updater wire contract is pinned down against the version actually installed.
 * Building that guess now, before a client exists to hold it to account, is how a format mismatch
 * would go unnoticed until the one time it matters.
 */
import { ownerOK, emailFromToken } from "../../_adminauth.js";
import * as OTA from "../../_ota.js";

const json = (obj, status = 200, extra = {}) => new Response(JSON.stringify(obj), {
  status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store", ...extra },
});
const HASH_RE = /^[0-9a-f]{64}$/;   // sha256, lowercase hex — reject anything else before it reaches R2

// Per-IP throttle on the public check endpoint — hygiene, not a hard requirement (R2 egress is
// free and the response carries nothing sensitive), mirrors the pattern in hospital-request.
async function checkThrottled(env, request) {
  const kv = env.UPDATES_KV || env.MAIK_KV || env.GHIS_KV; if (!kv) return false;
  const ip = request.headers.get("cf-connecting-ip") || request.headers.get("x-forwarded-for") || "unknown";
  try {
    const k = "ota:check:" + ip, n = parseInt((await kv.get(k)) || "0", 10);
    if (n >= 30) return true;               // generous — a real device checks a few times/hour at most
    await kv.put(k, String(n + 1), { expirationTtl: 300 });
  } catch (e) {}
  return false;
}
// Best-effort "who did this" for the audit trail — falls back to a generic label rather than
// failing the request if the token is malformed (the ownerOK gate already ran; this is cosmetic).
function whoIs(request) {
  try { const t = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, ""); if (t) return emailFromToken(t) || "owner"; } catch (e) {}
  return "owner";
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const seg = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const method = request.method;
  const r2 = env.OTA_R2;
  if (!r2) return json({ error: "ota-unavailable" }, 503);

  // ---- device-facing, public ----
  if (method === "GET" && seg[0] === "check") {
    if (await checkThrottled(env, request)) return json({ error: "rate_limited" }, 429);
    const url = new URL(request.url);
    const version = parseInt(url.searchParams.get("version") || "0", 10);
    const nativeBuild = parseInt(url.searchParams.get("nativeBuild") || "0", 10);
    const result = await OTA.checkForDevice(r2, { version, nativeBuild });
    return json(result, 200, { "Cache-Control": "no-store" });   // never let an edge/browser cache "is there an update"
  }
  if (method === "GET" && seg[0] === "file" && seg[1]) {
    const hash = String(seg[1]).toLowerCase();
    if (!HASH_RE.test(hash)) return json({ error: "bad-hash" }, 400);
    const obj = await OTA.getFile(r2, hash);
    if (!obj) return json({ error: "not-found" }, 404);
    // Content-addressed by definition — this exact hash can only ever mean this exact content, so
    // it is safe (and correct) to tell every cache in the path to keep it forever.
    return new Response(obj.body, {
      status: 200,
      headers: {
        "Content-Type": obj.httpMetadata?.contentType || "application/octet-stream",
        "Content-Length": String(obj.size),
        "Cache-Control": "public, max-age=31536000, immutable",
        "ETag": `"${hash}"`,
      },
    });
  }

  // ---- everything below is OWNER-only (admin console) ----
  if (!(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);

  if (method === "GET" && seg[0] === "candidate") return json({ ok: true, candidate: await OTA.getCandidate(r2) });
  if (method === "GET" && seg[0] === "channel") return json({ ok: true, channel: await OTA.getChannel(r2), kill: await OTA.getKillState(r2) });
  if (method === "GET" && seg[0] === "history") return json({ ok: true, history: await OTA.getHistory(r2) });

  if (method === "POST" && seg[0] === "publish") {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const by = whoIs(request);
    const minNativeBuild = Number.isFinite(+b.minNativeBuild) ? +b.minNativeBuild : undefined;
    const res = await OTA.publish(r2, { by, minNativeBuild });
    if (res && res.error) return json(res, res.error === "no-candidate" ? 404 : 500);
    return json({ ok: true, channel: res });
  }

  if (method === "POST" && seg[0] === "rollback") {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const toVersion = parseInt(b.toVersion, 10);
    if (!Number.isFinite(toVersion)) return json({ error: "bad-args" }, 400);
    const by = whoIs(request);
    const res = await OTA.rollback(r2, { toVersion, by });
    if (res && res.error) return json(res, res.error === "version-not-found" ? 404 : 500);
    return json({ ok: true, channel: res });
  }

  if (method === "POST" && seg[0] === "kill") {
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const by = whoIs(request);
    const res = await OTA.setKill(r2, { on: !!b.on, by });
    return json({ ok: true, kill: res });
  }

  return json({ error: "not-found" }, 404);
}
