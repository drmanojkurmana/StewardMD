/* Cloudflare Pages Function — KardioX AI edge Worker.
 *
 * The stable, same-origin endpoint the iOS RemoteAnalyzer hits (baseUrl "/api/kardiox"). It:
 *   1. authenticates the caller (hook; StewardMD's _middleware already gates /api/* — this is defence
 *      in depth),
 *   2. stores the uploaded ECG image in R2 EPHEMERALLY under uploads/<sessionId>,
 *   3. calls the FastAPI pipeline with { sessionId } (the pipeline reads the image from R2),
 *   4. DELETES the R2 object immediately (privacy contract — zero server retention),
 *   5. returns the pipeline JSON verbatim (contract-shaped) to the app.
 *
 * Bindings (Pages project → Settings → Functions):
 *   R2 bucket binding: KARDIOX_R2
 *   env vars: KARDIOX_PIPELINE_URL (FastAPI base), KARDIOX_PIPELINE_TOKEN (shared secret),
 *             KARDIOX_APP_TOKEN (optional edge auth), KARDIOX_R2_PREFIX (default "uploads/")
 *
 * No PII in logs — correlate by sessionId only.
 */
import { identify, usageKv } from "../../_usage.js";
import { gateAndCount } from "../../_ai_usage.js"; // AI Control Center per-module daily cap (module "ecg")

const MEDIA = "application/vnd.kardiox.v1+json";
const MAX_BYTES = 12 * 1024 * 1024;                          // 12 MiB hard cap on an ECG image
const OK_TYPE = /^image\/(jpe?g|png|heic|heif|webp)$/i;      // MIME allow-list

function log(obj) { try { console.log(JSON.stringify({ svc: "kardiox-edge", ...obj })); } catch (e) {} }
function uuid() { try { return crypto.randomUUID(); } catch (e) { return "kx-" + Date.now() + "-" + Math.floor(Math.random() * 1e9); } }

// Security headers on every response (defense-in-depth; CF adds TLS/HSTS at the edge).
function secHeaders(extra) {
  return Object.assign({
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Referrer-Policy": "no-referrer",
    "Cache-Control": "no-store",
  }, extra || {});
}
function err(status, code, message, stage) {
  return new Response(JSON.stringify({ error: { code, message, stage: stage || "report" } }),
    { status, headers: secHeaders({ "content-type": MEDIA }) });
}

// Magic-byte sniff of the first bytes — reject anything that is not a real image regardless of MIME.
async function sniffImage(file) {
  try {
    const b = new Uint8Array(await file.slice(0, 16).arrayBuffer());
    if (b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "image/jpeg";
    if (b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "image/png";
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 &&
        b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "image/webp";
    if (b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70) return "image/heic"; // ftyp box
    return null;
  } catch (e) { return null; }
}

// Auth hook. StewardMD's coming-soon _middleware already gates /api/*; add an optional app-token check.
function authOk(request, env) {
  if (!env || !env.KARDIOX_APP_TOKEN) return true;                 // not configured → rely on _middleware
  const t = request.headers.get("X-SMD-App") || request.headers.get("Authorization") || "";
  return t.indexOf(env.KARDIOX_APP_TOKEN) >= 0;
}

async function pipeline(env, sessionId, body, method, extraPath) {
  const base = env && env.KARDIOX_PIPELINE_URL;
  if (!base) return { ok: false, status: 503, json: { error: { code: "pipeline_unavailable", message: "Pipeline URL not configured", stage: "report" } } };
  const url = base.replace(/\/$/, "") + (extraPath || "/v1/ecg/analyze");
  const headers = { "Accept": MEDIA, "X-Session-ID": sessionId };
  if (env.KARDIOX_PIPELINE_TOKEN) headers["X-Pipeline-Token"] = env.KARDIOX_PIPELINE_TOKEN;
  if (body) headers["content-type"] = "application/json";
  const res = await fetch(url, { method: method || "POST", headers, body: body ? JSON.stringify(body) : undefined });
  let json = null; try { json = await res.json(); } catch (e) {}
  return { ok: res.ok, status: res.status, json };
}

async function handleAnalyze(request, env) {
  if (request.method !== "POST") return err(405, "method_not_allowed", "Use POST", "upload");
  if (!authOk(request, env)) return err(401, "unauthorized", "Missing or invalid app token", "upload");

  // AI Control Center — per-doctor DAILY cap on ECG uploads (module "ecg", default 10/day, env
  // AI_LIMIT_ECG). One call = one analysed ECG, so this is the correct unit. Fail-open on any metering
  // error so a clinical read is never blocked by the meter. Counts the attempt before the pipeline runs.
  try {
    const store = usageKv(env);
    if (store) {
      const who = await identify(request, env);
      const mq = await gateAndCount(env, store, "ecg", who.id, who.guest ? "guest" : "unknown", Date.now());
      if (!mq.ok) return err(429, "daily_limit", "Daily limit reached: " + mq.limit + " ECG uploads per day. This resets at midnight.", "upload");
    }
  } catch (e) { /* fail-open */ }

  const sessionId = request.headers.get("X-Session-ID") || uuid();
  const prefix = (env && env.KARDIOX_R2_PREFIX) || "uploads/";
  const key = prefix + sessionId;

  let form;
  try { form = await request.formData(); } catch (e) { return err(400, "bad_image", "Malformed multipart body", "upload"); }
  const image = form.get("image");
  if (!image || typeof image === "string") return err(400, "bad_image", "No image in upload", "upload");
  // upload validation: size cap, MIME allow-list, magic-byte sniff (defense-in-depth with the pipeline).
  if (typeof image.size === "number" && image.size > MAX_BYTES) return err(400, "bad_image", "Image too large", "upload");
  if (image.type && !OK_TYPE.test(image.type)) return err(400, "bad_image", "Unsupported image type", "upload");
  const sniffed = await sniffImage(image);
  if (!sniffed) return err(400, "bad_image", "File is not a recognized image", "upload");
  const layoutHint = form.get("layoutHint") || null;
  const pages = form.get("pages") ? parseInt(form.get("pages"), 10) : null;

  if (!env || !env.KARDIOX_R2) return err(503, "pipeline_unavailable", "R2 bucket not bound", "upload");

  const t0 = Date.now();
  try {
    // 1. ephemeral upload
    await env.KARDIOX_R2.put(key, image.stream(), { httpMetadata: { contentType: image.type || "image/jpeg" } });
    log({ sessionId, ev: "r2.put", bytes: image.size });
    // 2. run the pipeline (reads the image from R2 by sessionId)
    const out = await pipeline(env, sessionId, { sessionId, layoutHint, pages }, "POST", "/v1/ecg/analyze");
    log({ sessionId, ev: "pipeline", status: out.status, ms: Date.now() - t0 });
    if (out.ok && out.json) {
      return new Response(JSON.stringify(out.json), { status: 200, headers: secHeaders({ "content-type": MEDIA }) });
    }
    const e = (out.json && out.json.error) || {};
    return err(out.status || 502, e.code || "pipeline_unavailable", e.message || "Pipeline error", e.stage);
  } catch (e) {
    log({ sessionId, ev: "error", msg: String(e && e.message) });
    return err(502, "pipeline_unavailable", "Edge/pipeline failure", "report");
  } finally {
    // 3. erase the ephemeral upload no matter what (zero retention)
    try { await env.KARDIOX_R2.delete(key); log({ sessionId, ev: "r2.delete" }); } catch (e) {}
  }
}

async function handleHealth(env) {
  const out = await pipeline(env, "health", null, "GET", "/v1/health");
  return new Response(JSON.stringify({ edge: "ok", pipeline: out.ok ? (out.json || "ok") : "unreachable", status: out.ok ? "ok" : "degraded" }),
    { status: 200, headers: secHeaders({ "content-type": "application/json" }) });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = "/" + parts.join("/");   // e.g. "/v1/ecg/analyze" or "/v1/health"

  if (path === "/v1/ecg/analyze") return handleAnalyze(request, env);
  if (path === "/v1/health") return handleHealth(env);
  return err(404, "not_found", "Unknown KardioX endpoint: " + path, "upload");
}
