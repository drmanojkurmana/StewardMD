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
const PROBE_FILL = new Uint8Array(1572864).fill(97);   // "a" x 1.5 MB, the speed-probe body (sliced per request)

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
    // @capgo/capacitor-updater's download() fetches natively, outside the WebView — it needs an
    // ABSOLUTE url, which only the router (not _ota.js) can construct from the live request.
    if (result.ota && result.zipHash) result.zipUrl = new URL(request.url).origin + "/api/ota/file/" + result.zipHash;
    // files[] (every www file with its hash, ~150KB of JSON) is only for the delta install, which asks for it with
    // files=1 at the moment of installing. Every other check (launch, resume) just needs to know "is there an update".
    if (result.ota && url.searchParams.get("files") !== "1") delete result.files;
    return json(result, 200, { "Cache-Control": "no-store" });   // never let an edge/browser cache "is there an update"
  }
  /* SPEED PROBE for the download card. A plain-text body of n ASCII bytes (1 KB to 1.5 MB, no-store, no R2, no KV): the app
   * times it to show a real link speed while the native updater downloads the bundle (native-ota.js startProbe). It used to
   * time a ranged piece of the zip itself, which needs a CORS preflight and a binary body and measured nothing on some
   * devices (owner, 2026-10-16: the card sat at 0.0 MB). Public and harmless: the content is constant filler. */
  if (seg[0] === "probe") {
    const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range, Content-Type", "Access-Control-Max-Age": "86400" };
    if (method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
    if (method === "GET" || method === "HEAD") {
      const n = Math.max(1024, Math.min(1572864, parseInt(new URL(request.url).searchParams.get("n") || "393216", 10) || 393216));
      return new Response(method === "HEAD" ? null : PROBE_FILL.subarray(0, n), { status: 200, headers: { ...cors, "Content-Type": "text/plain; charset=us-ascii", "Content-Length": String(n), "Cache-Control": "no-store" } });
    }
  }
  if (method === "OPTIONS" && (seg[0] === "file" || seg[0] === "check")) {
    return new Response(null, { status: 204, headers: { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Methods": "GET, HEAD, OPTIONS", "Access-Control-Allow-Headers": "Range, Content-Type", "Access-Control-Max-Age": "86400" } });
  }
  if (method === "GET" && seg[0] === "file" && seg[1]) {
    const hash = String(seg[1]).toLowerCase();
    if (!HASH_RE.test(hash)) return json({ error: "bad-hash" }, 400);
    /* RESUMABLE. A ~48MB bundle served as one un-resumable stream meant any drop restarted from zero
     * and the phone reported "download failed" (owner's iPhone, 2026-09-18). A Range request is now
     * answered 206 from R2, and Accept-Ranges is always advertised so the updater knows it may resume. */
    /* SERVE IT FROM THE EDGE. Cloudflare answered every download from origin (cf-cache-status DYNAMIC)
     * despite the immutable one-year header, because a Pages Function response is not cached unless the
     * function puts it there itself. Each phone therefore streamed the whole ~48MB bundle from R2 at
     * ~210KB/s, about four minutes, and the updater gave up with "download-failed" (owner's iPhone,
     * 2026-09-18). The file is content-addressed, so a cache hit can never be stale. */
    const edge = typeof caches !== "undefined" && caches.default ? caches.default : null;
    const wantsRange = !!request.headers.get("Range");
    /* BYTES MUST ARRIVE EXACTLY AS STORED. Cloudflare rewrites any text/html response on its way out (it injects a
     * /cdn-cgi/challenge-platform bot-detection script: index.html arrived 3,976 bytes bigger), so the updater's sha256 of every
     * .html file failed, the changes-only install was rejected and the phone fell back to the whole 188 MB zip (owner, 2026-10-27:
     * "still downloading whole file", about 3x the time). Every file is therefore served as an opaque binary: the device writes the
     * bytes to disk and never needs the type. The edge-cache key carries a version so entries cached earlier with a text/html
     * type are never served again. */
    const OPAQUE = { "Content-Type": "application/octet-stream", "X-Content-Type-Options": "nosniff" };
    const cacheKey = new Request(request.url.split("?")[0] + "?ct=2", { method: "GET" });
    if (edge && !wantsRange) {
      const hit = await edge.match(cacheKey).catch(() => null);
      if (hit) return hit;
    }
    const head = await OTA.getFile(r2, hash);
    if (!head) return json({ error: "not-found" }, 404);
    const wanted = OTA.parseRange(request.headers.get("Range"), head.size);
    if (wanted) {
      const part = await OTA.getFile(r2, hash, { range: wanted });
      if (part) {
        const end = wanted.offset + wanted.length - 1;
        return new Response(part.body, {
          status: 206,
          headers: {
            ...OPAQUE,
            "Content-Length": String(wanted.length),
            "Content-Range": "bytes " + wanted.offset + "-" + end + "/" + head.size,
            "Accept-Ranges": "bytes",
            "Cache-Control": "public, max-age=31536000, immutable, no-transform",
            "ETag": '"' + hash + '"',
          },
        });
      }
    }
    const obj = head;
    // Content-addressed by definition — this exact hash can only ever mean this exact content, so
    // it is safe (and correct) to tell every cache in the path to keep it forever.
    const full = new Response(obj.body, {
      status: 200,
      headers: {
        ...OPAQUE,
        "Content-Length": String(obj.size),
        "Cache-Control": "public, max-age=31536000, immutable, no-transform",
        "Accept-Ranges": "bytes",
        "ETag": `"${hash}"`,
      },
    });
    // Keep a copy at the edge so the next device is served from cache instead of streaming from R2.
    if (edge && !wantsRange) {
      try { context.waitUntil(edge.put(cacheKey, full.clone())); } catch (e) { /* best effort */ }
    }
    return full;
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
