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

const MEDIA = "application/vnd.kardiox.v1+json";

function log(obj) { try { console.log(JSON.stringify({ svc: "kardiox-edge", ...obj })); } catch (e) {} }
function uuid() { try { return crypto.randomUUID(); } catch (e) { return "kx-" + Date.now() + "-" + Math.floor(Math.random() * 1e9); } }
function err(status, code, message, stage) {
  return new Response(JSON.stringify({ error: { code, message, stage: stage || "report" } }),
    { status, headers: { "content-type": MEDIA } });
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

  const sessionId = request.headers.get("X-Session-ID") || uuid();
  const prefix = (env && env.KARDIOX_R2_PREFIX) || "uploads/";
  const key = prefix + sessionId;

  let form;
  try { form = await request.formData(); } catch (e) { return err(400, "bad_image", "Malformed multipart body", "upload"); }
  const image = form.get("image");
  if (!image || typeof image === "string") return err(400, "bad_image", "No image in upload", "upload");
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
      return new Response(JSON.stringify(out.json), { status: 200, headers: { "content-type": MEDIA } });
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
    { status: 200, headers: { "content-type": "application/json" } });
}

export async function onRequest(context) {
  const { request, env, params } = context;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = "/" + parts.join("/");   // e.g. "/v1/ecg/analyze" or "/v1/health"

  if (path === "/v1/ecg/analyze") return handleAnalyze(request, env);
  if (path === "/v1/health") return handleHealth(env);
  return err(404, "not_found", "Unknown KardioX endpoint: " + path, "upload");
}
