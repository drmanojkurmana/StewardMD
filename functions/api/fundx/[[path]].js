/* functions/api/fundx/[[path]].js — FundX AI backend router (Cloudflare Pages Function).
 *
 * The ONLY surface the mobile/web app talks to for AI:
 *   POST /api/fundx/vision    { image, metrics?, ctx? }        -> { findings: RetinalFindings }
 *   POST /api/fundx/clinical  { findings, patient? }           -> { assessment: ClinicalAssessment }
 *   GET  /api/fundx/health                                     -> { ok, providers, ... }
 *
 * Provider-specific logic lives entirely in functions/_fundx_ai.js. API keys never reach the
 * client. Auth = same gate as the MaiK/GHIS functions (Cf-Access / X-App-Token / allowed
 * Origin). Rate-limited per server-derived identity (reuses _usage.js identify + KV; FundX
 * counters are namespaced separately from MaiK). Fail-open on metering, fail-closed on auth.
 */
import { runVision, runClinical, health, logJSON, httpErr } from "../../_fundx_ai.js";
import { identify, usageKv } from "../../_usage.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function num(v, d) { const n = Number(v); return Number.isFinite(n) && n > 0 ? n : d; }
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }

// Same gate as functions/api/ai — Cf-Access email, matching app token, or an allowed Origin.
function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  const tok = request.headers.get("X-App-Token");
  if (tok && (tok === env.FUNDX_APP_TOKEN || tok === env.AI_APP_TOKEN || tok === env.GHIS_APP_TOKEN)) return true;
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}

// FundX rate limit — server-derived identity, KV-backed, namespaced apart from MaiK.
// min-interval between calls + per-identity daily cap. Fail-open if no KV is bound.
async function rateLimit(env, request) {
  const store = usageKv(env);
  if (!store) return { ok: true, meter: false };
  let who; try { who = await identify(request, env); } catch (e) { who = { id: null, guest: true }; }
  const id = who.id || "guest";
  const nowS = Math.floor(Date.now() / 1000);
  const rateSec = num(env.FUNDX_RATE_LIMIT_SECONDS, 2);
  const dailyLimit = num(env.FUNDX_DAILY_LIMIT, who.guest ? 20 : 200);
  const rkey = "fundx:rate:" + id;
  try {
    const last = await store.get(rkey);
    if (last && (nowS - Number(last)) < rateSec) return { ok: false, code: "rate_limited", status: 429, retryAfter: rateSec };
    await store.put(rkey, String(nowS), { expirationTtl: 120 });
    const day = new Date(nowS * 1000).toISOString().slice(0, 10);
    const ckey = "fundx:count:" + id + ":" + day;
    const cur = Number(await store.get(ckey)) || 0;
    if (cur >= dailyLimit) return { ok: false, code: "daily_limit", status: 429, limit: dailyLimit };
    await store.put(ckey, String(cur + 1), { expirationTtl: 90000 });
  } catch (e) { return { ok: true, meter: false }; }   // fail-open
  return { ok: true, meter: true, id, guest: !!who.guest };
}

// ---- monitoring + cost accounting (KV, per day, per provider) -----------
function fxDay() { return new Date(Date.now()).toISOString().slice(0, 10); }
async function persistMetrics(env, arr) {
  const store = usageKv(env); if (!store || !arr || !arr.length) return;
  const key = "fundx:metrics:" + fxDay();
  let m; try { m = JSON.parse(await store.get(key)) || {}; } catch (e) { m = {}; }
  m.providers = m.providers || {}; m.requests = (m.requests || 0) + 1;
  arr.forEach(function (x) {
    const p = m.providers[x.provider] = m.providers[x.provider] || { count: 0, errors: 0, latencyMs: 0, inTok: 0, outTok: 0, costUsd: 0 };
    if (x.status === "ok") { p.count++; p.latencyMs += x.latencyMs || 0; p.inTok += x.inTok || 0; p.outTok += x.outTok || 0; p.costUsd += x.costUsd || 0; }
    else if (x.status === "error" || x.status === "non_json") p.errors++;
  });
  m.updatedAt = Date.now();
  try { await store.put(key, JSON.stringify(m), { expirationTtl: 60 * 60 * 24 * 40 }); } catch (e) {}
}
async function readMetrics(env) {
  const store = usageKv(env); if (!store) return null;
  try {
    const m = JSON.parse(await store.get("fundx:metrics:" + fxDay())); if (!m) return null;
    const out = { day: fxDay(), requests: m.requests || 0, providers: {} };
    Object.keys(m.providers || {}).forEach(function (k) {
      const p = m.providers[k], denom = p.count + p.errors;
      out.providers[k] = { count: p.count, errors: p.errors, errorRate: denom ? +(p.errors / denom).toFixed(3) : 0, avgLatencyMs: p.count ? Math.round(p.latencyMs / p.count) : 0, tokens: p.inTok + p.outTok, costUsd: +p.costUsd.toFixed(4) };
    });
    return out;
  } catch (e) { return null; }
}

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const path = url.pathname.replace(/\/+$/, "");

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  // Health is unauthenticated-safe (reports only booleans, never secrets) but still gated by Origin.
  if (request.method === "GET" && path.endsWith("/health")) {
    if (!authorise(request, env)) return json({ error: "unauthorized", code: "unauthorized" }, 401, request);
    const h = health(env);
    const metrics = await readMetrics(env); if (metrics) h.metrics = metrics;
    return json(h, 200, request);
  }

  if (request.method !== "POST") return json({ error: "method_not_allowed", code: "method_not_allowed" }, 405, request);
  if (!authorise(request, env)) return json({ error: "unauthorized", code: "unauthorized" }, 401, request);

  // Guard obviously oversized bodies before buffering.
  const clen = Number(request.headers.get("Content-Length") || 0);
  if (clen && clen > 16 * 1024 * 1024) return json({ error: "payload_too_large", code: "payload_too_large" }, 413, request);

  const rl = await rateLimit(env, request);
  if (!rl.ok) return json({ error: rl.code, code: rl.code, retryAfter: rl.retryAfter, limit: rl.limit }, rl.status || 429, request);

  let body;
  try { body = await request.json(); }
  catch (e) { return json({ error: "invalid_json", code: "invalid_json" }, 400, request); }

  const metrics = [];                                   // per-provider events for this request
  const deps = { onMetrics: function (m) { metrics.push(m); } };
  function flush() { try { if (context.waitUntil) context.waitUntil(persistMetrics(env, metrics)); } catch (e) {} }
  try {
    if (path.endsWith("/vision")) {
      const findings = await runVision(env, body, deps); flush();
      return json({ findings }, 200, request);
    }
    if (path.endsWith("/clinical")) {
      const assessment = await runClinical(env, body, deps); flush();
      return json({ assessment }, 200, request);
    }
    return json({ error: "not_found", code: "not_found" }, 404, request);
  } catch (e) {
    flush();                                            // record error metrics too
    const status = e && e.status ? e.status : 500;
    logJSON({ path, status, code: e && e.code || "error" });
    return json({ error: e && e.code || "internal_error", code: e && e.code || "internal_error", detail: e && e.detail || null }, status, request);
  }
}
