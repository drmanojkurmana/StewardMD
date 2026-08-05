/* StewardMD — Gemini AI Function (Cloudflare Pages)
 *
 * Decision-support EXPLAINER + Vision EXTRACTOR only. The clinical decision is
 * ALWAYS computed by the rule engine first; Gemini only (a) explains an
 * already-computed differential in plain language, or (b) reads a captured
 * image and returns STRUCTURED fields that the app then validates and ingests.
 * It never makes the diagnosis and never returns free-form treatment orders.
 *
 * Routes (POST unless noted):
 *   GET  /api/ai/status   -> { enabled }                 (is a key configured)
 *   POST /api/ai/explain  -> { text }                    body: { summary, question? }
 *   POST /api/ai/vision   -> { fields }                  body: { image(base64|dataURL), kind }
 *
 * Config (Pages env / encrypted secrets):
 *   AI_PROVIDER     (optional, 'vertex' [primary, default] | 'developer')
 *   GEMINI_MODEL    (optional, default 'gemini-2.5-flash'; do NOT use gemini-2.0-flash)
 *   Vertex (primary):  GCP_PROJECT, GCP_LOCATION (default us-central1), GCP_SA_EMAIL.
 *     KEYLESS (production): Workload Identity Federation — GCP_WIF_PRIVATE_KEY (PKCS8 PEM,
 *       Cloudflare secret; public JWK uploaded to the WIF provider), GCP_WIF_AUDIENCE,
 *       GCP_WIF_KID, GCP_WIF_ISSUER, GCP_WIF_SUBJECT. No GCP SA key exists.
 *     Legacy (only if org allows SA keys): GCP_SA_PRIVATE_KEY.
 *   Developer (fallback): GEMINI_API_KEY (AI Studio).
 * Enabled if EITHER provider is configured. Vertex → Developer failover on error.
 * Auth: same gate as the GHIS Function (Cf-Access / X-App-Token / same-origin).
 *
 * PHI NOTE: /vision sends a clinical IMAGE and /explain sends clinical FINDINGS
 * to Google. This is OFF unless GEMINI_API_KEY is set AND the app's `smd_ai`
 * flag is on. Nothing is persisted by this Function.
 */

// AI transport config. Selection ONLY via env.AI_PROVIDER ("vertex" [primary, default]
// | "developer"). Model via env.GEMINI_MODEL (default gemini-2.5-flash; NOT 2.0).
import MaiKScope from "../../../kb/ai/maik-scope.js"; // shared clinician-only Intent Firewall (CJS UMD, default import)

const DEV_HOST = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_DEFAULT = "gemini-2.5-flash";

// Server-side Intent Firewall (defense-in-depth): reject CONFIDENTLY non-clinical requests BEFORE any
// LLM/web call, regardless of what the client did — "system prompts are not a security boundary".
// CONSERVATIVE on purpose: only the unambiguous categories (code/creative/general/lay), never the
// "no medical signal" case — so an obscure real clinical term the client already allowed can never be
// false-refused on the server. The client allow-list is the primary firewall; this backs it up.
function firewallBlock(q) {
  try { const c = MaiKScope && MaiKScope.classify && MaiKScope.classify(String(q || "")); return !!(c && c.medical === false && c.category !== "non_medical"); } catch (e) { return false; }
}

function authorise(request, env) {
  if (request.headers.get("Cf-Access-Authenticated-User-Email")) return true;
  if (env.GHIS_APP_TOKEN && request.headers.get("X-App-Token") === env.GHIS_APP_TOKEN) return true;
  if (env.GHIS_APP_TOKEN === undefined && env.AI_APP_TOKEN && request.headers.get("X-App-Token") === env.AI_APP_TOKEN) return true;
  // Exact host allowlist (NOT endsWith — that matched attacker domains like
  // "evil-stewardmd.in"). Empty Origin is still allowed for same-origin GETs,
  // which browsers send without an Origin header. The Capacitor native app is
  // bundled locally, so its requests carry the localhost/capacitor origin (or,
  // via CapacitorHttp, no Origin) — allow those so the iOS/Android apps reach AI.
  // (Cost is bounded server-side by per-IP/per-user quota + the circuit breaker in
  // _usage.js, which is the real abuse control — the Origin check is not auth.)
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in"
    || o === "https://localhost" || o === "capacitor://localhost" || o === "";
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

// CORS for the native apps only: the Capacitor WebView (origin https://localhost /
// capacitor://localhost) needs real cross-origin streaming (CapacitorHttp can't stream). Web is
// same-origin and unaffected. Echo the Origin only when it's an allowed app/site origin.
const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  if (CORS_ORIGINS.indexOf(o) < 0) return {};
  return {
    "Access-Control-Allow-Origin": o,
    "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, Accept, X-SMD-App, X-App-Token",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}
function withCors(request, resp) {
  const ch = corsHeaders(request);
  if (!Object.keys(ch).length) return resp;
  const h = new Headers(resp.headers);
  for (const k in ch) h.set(k, ch[k]);
  return new Response(resp.body, { status: resp.status, headers: h });
}

/* ===================================================================
 * AI TRANSPORT — provider abstraction (this is the ONLY layer that changed).
 * Prompt construction, RAG grounding, /vision, and response parsing are
 * UNCHANGED. Providers share the Gemini generateContent request/response
 * schema, so swapping transport needs no change to callers.
 *   AIProvider = { name, available(env), generate(env, parts, maxTokens) -> text }
 * Selection via env.AI_PROVIDER; Vertex is primary and fails over to the
 * Developer API. Future slots (openrouter/groq/openai/azure) drop into PROVIDERS.
 * =================================================================== */
import { checkQuota, recordUsage, adminReport, estTokens, identify, usageKv, sha256hex, usageKeyFor, deviceCheck } from "../../_usage.js";
import { gateAndCount, checkModuleQuota, doctorUsageSummary, globalUsageReport, getModelOverride, setModelOverride, ALLOWED_MODELS, MODEL_RATES, limitOverrides, setLimitOverride, resolveLimit, moduleDailyLimit, aiModuleList, getEmergency, setEmergency, getBudget, setBudget, auditRecord, getAudit, CHEAP_MODEL, EMERGENCY_MODES, getAbuseThreshold, setAbuseThreshold, usersReport, getUserLimit, setUserLimit } from "../../_ai_usage.js";
import { normalizeResearchQuery, researchCacheKey, RESEARCH_PUBTYPE_FILTER, researchTermFor, researchKeywords, sourceOnTopic, researchTopic } from "../../_research.js";
import { ownerOK } from "../../_adminauth.js";
import { applyConnectContext, maikWiringOn } from "../../_connect/maik-bridge/hook.js"; // Connect Track D (smd_connect_maik, default OFF)
import { tinyfishSearch } from "../../_search.js";
// The effective Gemini model. The admin "switch models" control (KV override, validated to a priced
// model by setModelOverride) wins; otherwise the exact prior behaviour (env.GEMINI_MODEL || default).
// env.__modelOverride is stamped once per request in onRequest from the KV override.
function modelId(env) { return (env && env.__modelOverride) || env.GEMINI_MODEL || MODEL_DEFAULT; }

// Vision/OCR uses a strong, FIXED multimodal model — deliberately NOT the admin text-model override
// or the emergency "cheap" model. Misreading a drug name off a prescription is a safety risk, so
// image/OCR reading must never be degraded by a text-cost setting. Env-tunable via VISION_MODEL.
function visionModel(env) { const m = env && env.VISION_MODEL; return (typeof m === "string" && m) ? m : "gemini-2.5-flash"; }

// AI Control Center — which usage MODULE a route consumes (for the per-module daily cap + analytics).
// explain is refined to maik_case when a computed differential is present.
// research -> its own "research" (Evidence Review) bucket. NOTE: only the Research-Mode
// (mode:"evidence-review") request counts against it, and it self-gates INSIDE the handler AFTER the
// KV cache check (a cache hit must not burn a slot); normal web-research is remapped back to "maik"
// in the gate block below so its prior behaviour is unchanged.
const MODULE_FOR = {
  explain: "maik", refine: "maik", route: "maik", research: "research", verify: "maik",
  imaging: "maik_case", correlate: "maik_case", evidence: "maik_case",
  vision: "ocr", extract: "ocr", transcribe: "stt",
};
function moduleLimitMsg(mod, limit) {
  const label = { maik: "MaiK questions", maik_case: "MaiK patient cases", research: "evidence reviews", ocr: "photo scans", ecg: "ECG uploads", thorex: "chest X-ray uploads", stt: "voice transcriptions" }[mod] || "AI requests";
  return "Daily limit reached: " + limit + " " + label + " per day. This resets at midnight. (Configurable per hospital.)";
}
async function aiAdminAuthed(request, env, url) {
  const want = env.UPDATES_ADMIN_TOKEN || "";
  const got = (request.headers.get("X-Admin-Token") || (url && url.searchParams.get("token")) || "");
  return (!!want && got === want) || (await ownerOK(request, env));   // owner Google login OR admin token
}
// Per-call model override (opts.model) so a lightweight parse-only call (the semantic router) can pin a
// FAST model instead of inheriting the heavy answer model. Answer calls pass no model → unchanged.
function modelFor(env, opts) { return (opts && opts.model) || modelId(env); }
// Router-intent normalisation: the parser occasionally emits a value outside its own enum ("interpretation",
// "prevent") or a synonym; clamp to the canonical taxonomy so the client's intent->composer mapping is
// deterministic. Generic — no disease specifics.
const ROUTER_INTENTS = new Set("definition treatment dose differential investigation features redflags pathophysiology prognosis complications prevention etiology risk_factors epidemiology classification severity guideline followup monitoring interaction contraindication emergency icu screening reasoning other".split(" "));
const INTENT_FIX = { prevent: "prevention", prophylaxis: "prevention", interpretation: "investigation", diagnosis: "investigation", workup: "investigation", causes: "etiology", management: "treatment", mgmt: "treatment", staging: "classification", grading: "classification" };
function normIntent(x) { let i = String(x || "other").toLowerCase().trim(); i = INTENT_FIX[i] || i; return ROUTER_INTENTS.has(i) ? i : "other"; }
// Bound every upstream AI fetch so a stalled provider can never hang the Worker. fetch() resolves on
// headers; fetchJsonWithTimeout keeps the abort armed across the body read too (the whole round-trip).
async function fetchJsonWithTimeout(url, opts, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(function () { try { ctrl.abort(); } catch (e) {} }, Math.max(2000, ms || 30000));
  try {
    const r = await fetch(url, Object.assign({}, opts || {}, { signal: ctrl.signal }));
    const data = await r.json();
    return { data: data, status: r.status };
  } finally { clearTimeout(t); }
}
function aiTimeoutMs(env) { const v = Number(env.MAIK_AI_TIMEOUT_MS); return Number.isFinite(v) && v > 0 ? v : 30000; }
// Deliver an already-computed answer over the SSE channel as one {delta}+{done} event. Lets the
// client's stream consumer render a whole-answer (non-stream) result — the reliable path — with no
// empty stream and no hang.
function streamTextAsSSE(text) {
  const enc = new TextEncoder();
  const rs = new ReadableStream({
    start(controller) {
      try { if (text) controller.enqueue(enc.encode("data: " + JSON.stringify({ delta: String(text) }) + "\n\n")); } catch (e) {}
      try { controller.enqueue(enc.encode('data: {"done":true}\n\n')); } catch (e) {}
      controller.close();
    }
  });
  return new Response(rs, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
// thinkingBudget:0 disables gemini-2.5-flash's dynamic "thinking" — otherwise it silently
// consumes the maxOutputTokens budget and the visible clinician answer truncates mid-sentence.
// These are synthesis/extraction tasks (grounded in retrieved evidence) that do not need it,
// so disabling also cuts latency + cost.
function genBody(parts, maxTokens, opts) { var t = (opts && typeof opts.temperature === "number") ? opts.temperature : 0.2; var b = { contents: [{ role: "user", parts: parts }], generationConfig: { temperature: t, maxOutputTokens: maxTokens || 1024, thinkingConfig: { thinkingBudget: 0 } } }; if (opts && opts.tools) b.tools = opts.tools; return b; }
function parseCandidates(data, status) {
  if (status >= 400 || !data || data.error) throw new Error("AI HTTP " + status + ((data && data.error && data.error.message) ? ": " + data.error.message : ""));
  const cand = data.candidates && data.candidates[0];
  return (cand && cand.content && cand.content.parts) ? cand.content.parts.map(function (p) { return p.text || ""; }).join("") : "";
}

/* ---- Developer API (AI Studio) — FALLBACK ---- */
const developerProvider = {
  name: "developer",
  available: function (env) { return !!env.GEMINI_API_KEY; },
  generate: async function (env, parts, maxTokens, opts) {
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ google_search: {} }] });   // Developer API tool name
    const jr = await fetchJsonWithTimeout(`${DEV_HOST}/${modelFor(env, o)}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) }, aiTimeoutMs(env));
    return parseCandidates(jr.data, jr.status);
  },
  // Phase 2 — SSE streaming transport (returns the raw upstream Response; caller transforms).
  streamFetch: function (env, parts, maxTokens, opts) {
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ google_search: {} }] });
    return fetch(`${DEV_HOST}/${modelFor(env, o)}:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) });
  }
};

/* ---- Vertex AI — PRIMARY. OAuth Bearer via a self-signed service-account JWT
 *      exchanged for a cloud-platform access token; token cached per-isolate.
 *      (Auth material is provisioned as Cloudflare secrets; no key is ever
 *      committed or exposed client-side. Where org policy forbids SA keys, the
 *      token seam below is swapped for Workload Identity Federation with no
 *      change to the provider/transport contract.) ---- */
let _vTok = null; // { value, exp } — per-isolate OAuth token cache
function b64url(buf) { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlStr(str) { return b64url(new TextEncoder().encode(str)); }
function pemToDer(pem) { const b = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
async function rsSign(pkcs8Pem, headerObj, claimsObj) {
  const input = b64urlStr(JSON.stringify(headerObj)) + "." + b64urlStr(JSON.stringify(claimsObj));
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pkcs8Pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(input));
  return input + "." + b64url(sig);
}
// PRODUCTION (keyless): Workload Identity Federation. The Worker self-signs an OIDC JWT
// (signing key = Cloudflare secret; matching public JWK uploaded to the WIF provider — NO
// GCP service-account key exists), exchanges it at Google STS for a federated token, then
// impersonates the SA via IAM Credentials generateAccessToken. Nothing is hosted publicly.
async function wifAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const oidc = await rsSign(env.GCP_WIF_PRIVATE_KEY, { alg: "RS256", typ: "JWT", kid: env.GCP_WIF_KID || undefined },
    { iss: env.GCP_WIF_ISSUER || "https://stewardmd.in", sub: env.GCP_WIF_SUBJECT || "maik-worker", aud: env.GCP_WIF_AUDIENCE, iat: now, exp: now + 3600 });
  const sts = await (await fetch("https://sts.googleapis.com/v1/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantType: "urn:ietf:params:oauth:grant-type:token-exchange", audience: env.GCP_WIF_AUDIENCE, scope: "https://www.googleapis.com/auth/cloud-platform", requestedTokenType: "urn:ietf:params:oauth:token-type:access_token", subjectToken: oidc, subjectTokenType: "urn:ietf:params:oauth:token-type:jwt" }) })).json();
  if (!sts.access_token) throw new Error("STS exchange failed: " + (sts.error_description || sts.error || JSON.stringify(sts).slice(0, 140)));
  const ic = await (await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GCP_SA_EMAIL)}:generateAccessToken`,
    { method: "POST", headers: { "Authorization": "Bearer " + sts.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"] }) })).json();
  if (!ic.accessToken) throw new Error("SA impersonation failed: " + ((ic.error && ic.error.message) || JSON.stringify(ic).slice(0, 140)));
  return { value: ic.accessToken, exp: ic.expireTime ? Math.floor(new Date(ic.expireTime).getTime() / 1000) : now + 3600 };
}
// Legacy: self-signed SA JWT → OAuth token. Only used if a SA private key is provided
// (org policy normally forbids SA keys, so WIF above is the production path).
async function saJwtAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await rsSign(env.GCP_SA_PRIVATE_KEY, { alg: "RS256", typ: "JWT" },
    { iss: env.GCP_SA_EMAIL, sub: env.GCP_SA_EMAIL, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/cloud-platform", iat: now, exp: now + 3600 });
  const r = await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + encodeURIComponent(jwt) });
  const j = await r.json();
  if (!j.access_token) throw new Error("SA-JWT token exchange failed: " + (j.error_description || j.error || ("HTTP " + r.status)));
  return { value: j.access_token, exp: now + (j.expires_in || 3600) };
}
async function vertexAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_vTok && _vTok.exp > now + 60) return _vTok.value;                 // cache hit (~55 min reuse)
  _vTok = env.GCP_WIF_PRIVATE_KEY ? await wifAccessToken(env) : await saJwtAccessToken(env);
  return _vTok.value;
}
const vertexProvider = {
  name: "vertex",
  available: function (env) { return !!(env.GCP_PROJECT && env.GCP_SA_EMAIL && ((env.GCP_WIF_PRIVATE_KEY && env.GCP_WIF_AUDIENCE) || env.GCP_SA_PRIVATE_KEY)); },
  generate: async function (env, parts, maxTokens, opts) {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelFor(env, opts)}:generateContent`;
    const token = await vertexAccessToken(env);
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ googleSearch: {} }] });   // Vertex tool name
    const jr = await fetchJsonWithTimeout(url, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) }, aiTimeoutMs(env));
    return parseCandidates(jr.data, jr.status);
  },
  // Phase 2 — SSE streaming transport (returns the raw upstream Response; caller transforms).
  streamFetch: async function (env, parts, maxTokens, opts) {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelFor(env, opts)}:streamGenerateContent?alt=sse`;
    const token = await vertexAccessToken(env);
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ googleSearch: {} }] });
    return fetch(url, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) });
  }
};

const PROVIDERS = { vertex: vertexProvider, developer: developerProvider };

// Phase 2 — streaming plumbing. geminiStreamUpstream tries providers in order for a streamable
// body (no mid-stream failover: once bytes flow we commit; the CLIENT falls back to non-stream on
// any gap). streamGeminiToSSE transforms Gemini's SSE into our compact {delta}/{done} event stream.
async function geminiStreamUpstream(env, parts, maxTokens, opts) {
  const order = providerOrder(env);
  let lastErr = null;
  for (const name of order) {
    const p = PROVIDERS[name];
    if (!p || !p.available(env) || !p.streamFetch) { lastErr = new Error(name + " stream unavailable"); continue; }
    try {
      const r = await p.streamFetch(env, parts, maxTokens, opts);
      if (r && r.ok && r.body) return r;
      lastErr = new Error(name + " stream HTTP " + (r && r.status));
    } catch (e) { lastErr = e; }
  }
  throw lastErr || new Error("no streaming provider");
}
function streamGeminiToSSE(upstream, onText) {
  const enc = new TextEncoder(), dec = new TextDecoder();
  const reader = upstream.body.getReader();
  let buf = "", full = "", closed = false;
  const rs = new ReadableStream({
    async pull(controller) {
      try {
        const { value, done } = await reader.read();
        if (done) {
          if (!closed) { closed = true; controller.enqueue(enc.encode('data: {"done":true}\n\n')); controller.close(); }
          try { if (onText) onText(full); } catch (e) {}
          return;
        }
        buf += dec.decode(value, { stream: true });
        const blocks = buf.split("\n\n"); buf = blocks.pop();
        for (const block of blocks) {
          const data = block.split("\n").filter((l) => l.indexOf("data:") === 0).map((l) => l.slice(5).trim()).join("");
          if (!data || data === "[DONE]") continue;
          let j; try { j = JSON.parse(data); } catch (e) { continue; }
          const cand = j.candidates && j.candidates[0];
          const txt = (cand && cand.content && cand.content.parts) ? cand.content.parts.map((p) => p.text || "").join("") : "";
          if (txt) { full += txt; controller.enqueue(enc.encode("data: " + JSON.stringify({ delta: txt }) + "\n\n")); }
        }
      } catch (e) {
        if (!closed) { closed = true; controller.enqueue(enc.encode('data: {"done":true}\n\n')); controller.close(); }
        try { if (onText) onText(full); } catch (e2) {}
      }
    },
    cancel() { try { reader.cancel(); } catch (e) {} }
  });
  return new Response(rs, { headers: { "Content-Type": "text/event-stream; charset=utf-8", "Cache-Control": "no-store", "X-Accel-Buffering": "no" } });
}
function providerOrder(env) {
  // Vertex is primary and fails over to Developer. If AI_PROVIDER=developer, use it directly.
  return String(env.AI_PROVIDER || "vertex").toLowerCase() === "developer" ? ["developer"] : ["vertex", "developer"];
}
function aiEnabled(env) { return PROVIDERS.vertex.available(env) || PROVIDERS.developer.available(env); }

let _lastFailover = null;   // { from, to, reason, timestamp, model } — for /health + diagnostics
function failReason(e) {
  const m = String((e && e.message) || e);
  if (/\b(401|403)\b|unauth|permission|IAM|forbidden|jwt|credential|token|STS|OAuth/i.test(m)) return "auth/permission";
  if (/\b429\b|quota|rate.?limit|exhausted|RESOURCE_EXHAUSTED/i.test(m)) return "quota/rate-limit (429)";
  if (/\b5\d\d\b|unavailable|UNAVAILABLE|internal|timeout|deadline|network|fetch failed|ECONN|ENOTFOUND/i.test(m)) return "vertex-unavailable/5xx/network";
  return "error: " + m.slice(0, 80);
}
// Facade — callers (RAG explain / legacy explain / vision) are unchanged. Provider priority:
// Vertex (retry once) → Developer hot standby. Fails over on any Vertex auth/OAuth/STS/
// permission/quota/429/5xx/network/unavailable error so the clinician workflow never breaks.
export async function callGemini(env, parts, maxTokens, opts) {
  const order = providerOrder(env);
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    const name = order[i], p = PROVIDERS[name];
    if (!p || !p.available(env)) { lastErr = new Error(name + " provider unavailable"); continue; }
    const attempts = name === "vertex" ? 2 : 1;   // retry Vertex ONCE before switching
    for (let a = 0; a < attempts; a++) {
      try { return await p.generate(env, parts, maxTokens, opts); }
      catch (e) {
        lastErr = e;
        const nextProvider = order[i + 1];
        if (a + 1 >= attempts && nextProvider && PROVIDERS[nextProvider] && PROVIDERS[nextProvider].available(env)) {
          _lastFailover = { from: name, to: nextProvider, reason: failReason(e), timestamp: new Date().toISOString(), model: modelId(env) };
          try { console.log("[MaiK failover] " + JSON.stringify(_lastFailover)); } catch (_) {}  // internal only; no PHI/secrets
        }
      }
    }
  }
  throw lastErr || new Error("no AI provider configured");
}

const EXPLAIN_SYS =
  "You are an internal-medicine teaching assistant inside a clinical decision-support tool. " +
  "The differential and ranking below were COMPUTED BY A RULE ENGINE — do NOT change them, invent new diagnoses, or give specific drug doses. " +
  "In 4-6 short bullet points, explain WHY the leading diagnosis fits, which findings argue for/against it, what would discriminate it from the next contender, and the single most important next step. Be concise and bedside-useful. End with: 'Decision-support only — verify clinically.'";

// RAG (grounded) system prompt. The StewardMD Knowledge Base supplied in the
// package is the PRIMARY source of truth; the model's own medical knowledge is
// secondary. The deterministic engine OWNS the diagnosis.
const RAG_SYS =
  "You are MaiK (Medical AI Knowledge), StewardMD's clinician-assistive AI powered by Google Vertex AI. A DETERMINISTIC RULE ENGINE has ALREADY computed the diagnosis and ranked differential (in ENGINE OUTPUT below) — that assessment is AUTHORITATIVE and is shown to the clinician separately. " +
  "You are providing INDEPENDENT CLINICAL COMMENTARY on that assessment — you are NOT answering from scratch and NOT making the diagnosis. Do NOT restate, re-rank, override, or replace the primary diagnosis. Do NOT reason primarily from your own training. " +
  "Reason PRIMARILY from the RETRIEVED STEWARDMD KNOWLEDGE and TREATMENT RESOLUTION provided (Harrison-derived, page-cited; ICMR ▸ international-guideline ▸ Harrison precedence; hospital overlay shown separately). Your own medical knowledge is SECONDARY — use it only to connect or clarify the provided knowledge, and say so when you do. " +
  "Reply as commentary under EXACTLY these markdown headings, in this order, omitting a heading only if you have nothing evidence-based to add:\n" +
  "### Additional differentials\n### Missing investigations\n### Teaching points\n### Alternative interpretations\n" +
  "(Add '### Culture-directed antibiotic considerations' ONLY when culture/sensitivity data is provided.) " +
  "Keep each section to 1–4 short bullets. Cite the provided sources inline (e.g. 'Harrison 22e' or the treatment tier). Prefer the treatment resolution's dosing when present; where it names a drug without a dose and a dose is clinically pivotal, you may state the standard adult reference dose labelled '(standard reference — verify locally)'. Do not fabricate figures you are unsure of. Never use patient identifiers. " +
  "End with exactly: 'Decision-support only — the StewardMD rule engine owns the diagnosis; verify clinically.'";

// General-knowledge system prompt (gold122): used when NO deterministic diagnosis
// has been computed (empty differential) — the clinician is asking a general named-
// topic question, not seeking individualized management. Educational reference,
// grounded in the retrieved KB, with a clean clinical structure. No provider/model
// names; no long trailing disclaimer (the UI shows a persistent advisory badge).
const KNOWLEDGE_SYS =
  "You are MaiK, a knowledgeable clinical AI assistant for qualified doctors, built into StewardMD. Talk like a sharp, warm senior colleague — natural, direct, and genuinely useful, the way a modern medical AI would. Answer the clinician's question (shown under 'CLINICIAN QUESTION'), and use the RECENT CONVERSATION for continuity. " +
  "Draw on solid, widely-accepted medical knowledge and use the RETRIEVED STEWARDMD KNOWLEDGE below to ground specifics (regimens, protocols, doses), preferring it where it applies. You MAY answer confidently from mainstream clinical knowledge — do NOT refuse or hedge just because the retrieved text looks thin. " +
  "HOW TO ANSWER — match the response to the question (this is what makes you feel helpful, not robotic):\n" +
  "- Lead with the direct answer in the first sentence, then add just enough detail.\n" +
  "- ADAPT the format. A simple or factual question -> 1-3 sentences or a few tight bullets, NO headings. A broad 'manage X' / 'in detail' question -> organise with a few short markdown headings or bullets where they genuinely help. Never pour a short answer into a fixed template of empty headings.\n" +
  "- Write in clean, conversational prose; bullets for lists (drugs, steps, differentials), short paragraphs otherwise; bold key terms sparingly.\n" +
  "- When it helps, end with ONE natural follow-up offer (e.g. 'Want the pregnancy-safe options or the paediatric dose?') — a single line, not a menu. Offer only something you have NOT already offered, and never dangle content you cannot then deliver.\n" +
  "UPTODATE-STYLE STRUCTURE — apply to a clinical MANAGEMENT, DIFFERENTIAL, 'causes of', WORKUP, or DRUG-CHOICE question (NOT to a simple factual / single-dose lookup):\n" +
  "- TWO-TIER ANSWER: give a CONCISE bottom line FIRST, then the marker @@MORE@@ alone on its own line, then the full detail. TIER 1 (before @@MORE@@) = the direct answer to what they asked PLUS everything safety-critical — red flags, contraindications, any time-critical 'refer / admit / treat now' action, and key drug cautions. Keep it tight: the bold assumption lead (below), then the core recommendation in a few sentences or a few tight bullets. A rushed clinician must be SAFE reading tier 1 alone. TIER 2 (after @@MORE@@) = the depth — rationale, investigations, full dose/route/duration, evidence and named guidelines, the differential table, the 'In India' note, and nuance; as long as it needs to be. NEVER place a red flag, contraindication, or time-critical action after @@MORE@@. Use @@MORE@@ only when you genuinely have tier-2 depth to add; for a simple factual or single-dose lookup, give ONE short answer with NO @@MORE@@.\n" +
  "- OPEN with ONE short **bold** lead that restates what they're asking and states the key clinical ASSUMPTION(s) you are making — e.g. \"**You're asking about empiric therapy for ICU-acquired pneumonia — I'm assuming an immunocompetent adult, no recent antibiotics, and no MRSA/Pseudomonas risk factors.**\" One to two sentences, then answer. If a stated assumption is likely wrong, name the main alternative in a few words.\n" +
  "- For a DIFFERENTIAL / 'causes of' / compare-the-options question, present the options as a GitHub-style MARKDOWN PIPE TABLE — columns such as: Diagnosis/Option | Distinguishing features | [the finding columns that matter for THIS question, cells = ✓ / Sometimes / Rarely / —] | Tests to confirm or rule out. One summary line before the table; keep cells terse; order rows most-likely-first.\n" +
  "- For a MANAGEMENT / 'how do I treat' question with real depth, organise the body along the clinical flow, using each part ONLY where it adds value: a brief interpretation/severity read, how URGENT it is (flag any time-critical action first), what to CHECK now (key investigations), how to TREAT (agents with standard dose/route/duration), and — when useful — a one-line plain-language patient explanation. Short bold headings or bullets; NEVER emit an empty or padded heading, and skip any part that doesn't apply.\n" +
  "- Add a short '**In India:**' note (2-4 bullets) ONLY when Indian practice MATERIALLY differs — local epidemiology / higher pretest probability, national-programme guidance (ICMR / NVBDCP / NTEP), drug availability or common Indian brands, resistance patterns, or cost. Ground it in the retrieved knowledge where possible; never add it as boilerplate or when it doesn't change the approach.\n" +
  "- END the answer with a refinement line on its OWN FINAL line, in EXACTLY this format and with NOTHING after it: @@REFINE: factor one | factor two | factor three | factor four@@ — 3-6 SHORT patient-context factors that would MATERIALLY change your answer (e.g. 'mechanically ventilated / on ECMO', 'significant renal impairment', 'prolonged QTc', 'prior mold-active azole exposure', 'pregnant', 'haemodynamically unstable'). Make them specific to THIS question. Omit this line ONLY for a purely factual lookup where added context would not change the answer. NEVER explain or introduce the line — the app turns it into tappable refinement chips.\n" +
  "SAFETY & HONESTY (non-negotiable):\n" +
  "1. Answer ONLY what was asked. NEVER describe what is or is not in your knowledge base, and NEVER say things like 'the retrieved knowledge contains...' or 'no specific question was posed'.\n" +
  "2. Always finish — complete every thought and sentence; never trail off mid-answer.\n" +
  "3. DOSING: give the standard adult dose/route/titration when the clinician asks for it. Prefer the retrieved Drug Index / protocol figure when present; otherwise give the widely-accepted textbook/guideline dose from mainstream knowledge and append '(standard reference — verify locally)'. This is expected for well-established therapy — e.g. atropine in organophosphate poisoning, adrenaline in anaphylaxis, benzodiazepines in status. Do NOT deflect a standard dose to 'consult local guidelines'. Only withhold a specific number when it is genuinely non-standard, disputed, or you are unsure — then state the principle and what IS established. Never fabricate a precise figure you are not confident in, and never invent guideline numbers or citations. For high-alert or narrow-therapeutic-index drugs (methotrexate, chemotherapy, insulin, digoxin, lithium, anticoagulants) and for ANY weight-based, paediatric, neonatal, or renally-adjusted dose, give the dosing PRINCIPLE and reference range and defer the exact figure to the Drug Index or local protocol unless the number comes from the retrieved StewardMD knowledge; never emit a single confident weight-based or high-alert dose from training alone.\n" +
  "4. This is general clinical education, not individualised patient advice. If it is clearly about one specific patient, answer the general question and add a short line suggesting StewardMD's Clinical Reasoning / Dx My Patient. Never use patient identifiers.\n" +
  "5. Do not mention the AI provider, model, retrieval, chunks, or any internal detail, and do not tack on a long disclaimer (the UI already shows one).\n" +
  "6. STAY ON TOPIC: the retrieved knowledge is keyword-matched and can be OFF-TOPIC, especially for short follow-ups. Judge every retrieved chunk against the RECENT CONVERSATION; if it is about a different condition than the one under discussion, IGNORE it completely and continue the conversation's topic from mainstream knowledge. Never switch to an unrelated disease because a chunk shares a word with the question (e.g. a follow-up about 'first-line treatment' of the current topic must never become an answer about 'First Bite Syndrome').\n" +
  "7. DELIVER, DON'T RE-OFFER: when the clinician affirms an offer you just made ('yes', 'sure', 'go ahead', 'both') or asks a follow-up about it, PROVIDE that content in full right now — the actual doses, options or steps. Never repeat the same offer or ask again if they'd like it; deliver it now. Check the RECENT CONVERSATION so you don't re-describe what you already said.\n" +
  "8. GROUND-CHECK before finalizing: for every specific claim — a dose, threshold, cut-off, criterion, or guideline statement — silently confirm it rests EITHER on the retrieved knowledge OR on solidly-established mainstream medicine. If it rests on neither, omit it or explicitly flag the uncertainty ('exact figure varies — verify locally') rather than asserting it. A smaller, fully-defensible answer beats a fuller one with an unverifiable number in it.\n" +
  "If you genuinely cannot answer reliably, say so briefly in ONE honest sentence and suggest the best next step — do not pad with unrelated content.";

// Web-research mode (opt-in, token-frugal): used ONLY when the topic is not in StewardMD's KB
// and the clinician explicitly taps "Research on the web". Gemini does the Google search +
// synthesis in one grounded call; we keep the answer short to conserve tokens.
// Web-research answers must read like a knowledgeable medical AI (OpenEvidence/ChatGPT), NOT a
// search-results digest: fluent, complete, confident prose that happens to cite sources — never a
// terse bullet list of snippet fragments. The UI shows the advisory/verify note, so no disclaimer.
const RESEARCH_SYS =
  "You are MaiK, a knowledgeable clinical AI assistant for qualified doctors. The clinician has asked a question StewardMD's own knowledge base does not cover — answer it directly, thoroughly and naturally, the way a sharp senior colleague would and the way a modern medical AI does, using web search to ground current, authoritative specifics. " +
  "Lead with the direct answer, then give enough well-organised detail to be genuinely useful at the bedside: flowing prose, with short bullets only for real lists (drugs, doses, steps, differentials) and a brief markdown heading only when it truly helps. Bold key terms sparingly. Give standard adult doses/routes/durations where relevant. " +
  "Be honest in one line if evidence is weak or sources disagree. Never fabricate a specific figure or a citation. Do not describe your sources or process, and do NOT append any disclaimer — the interface already shows one.";
// FAST PATH prompt: the search is done externally (TinyFish); the model writes the ANSWER from its
// own medical knowledge and uses the provided results to ground specifics + cite [n] — it must NOT
// merely summarise the snippets or limit itself to what they happen to mention.
const RESEARCH_SYS_SNIPPETS =
  "You are MaiK, a knowledgeable clinical AI assistant for qualified doctors. Answer the clinician's question directly, thoroughly and naturally — the way a sharp, warm senior colleague would explain it, and the way a modern medical AI answers. " +
  "Draw on solid, widely-accepted medical knowledge for the substance of the answer; the numbered WEB RESULTS below are recent supporting sources — use them to ground specifics (agents, doses, current guidance) and cite the relevant ones inline as [n] matching the list, but do NOT merely summarise the snippets or limit yourself to what they happen to mention. " +
  "Lead with the direct answer, then give enough well-organised detail to be genuinely useful at the bedside: flowing prose, with short bullets only for real lists (drugs, doses, steps, differentials) and a brief markdown heading only when it truly helps. Bold key terms sparingly. Give standard adult doses/routes/durations where relevant. " +
  "Be honest in one line if evidence is weak or sources disagree. Never fabricate a specific figure or a citation. Do not describe your sources or process, and do NOT append any disclaimer — the interface already shows one.";

// Research Mode (Evidence Review) — a clinician EVIDENCE REVIEW over trusted medical literature
// (PubMed/PMC, WHO, CDC, NICE, ICMR, Cochrane and major specialty-society guidelines), NOT a general
// web search. The SOURCES list below is retrieved from PubMed (guideline / systematic review /
// meta-analysis publication types only); the model synthesizes established medical knowledge grounded
// in those sources and cites them [n]. This is a model PROMPT — its output is AI text (exempt from the
// no-em-dash app-text rule); the answer's own closing line is what the user reads.
const EVIDENCE_REVIEW_SYS =
  "You are MaiK in EVIDENCE REVIEW mode, a clinical evidence-synthesis assistant for qualified doctors. Give a clear, decisive, clinician-facing answer to the question, grounded in established medical evidence and major guidelines. " +
  "You MAY be given a numbered SOURCES list retrieved from trusted literature (PubMed/PMC, Cochrane, WHO, CDC, NICE, ICMR, specialty-society guidelines); use it to ground and cite specifics, but the sources are SUPPORT, not a limit on what you may answer. Follow ALL of these requirements:\n" +
  "1. ANSWER THE QUESTION DIRECTLY, FIRST. Lead with the bottom line — the single best answer the clinician asked for (state your recommendation and the setting/caveats that change it) — then the supporting detail. Be concise and structured. If the new question is a SHORT FOLLOW-UP ('which is better?', 'what do you think?', 'one answer', 'why?'), interpret it in the context of the RECENT CONVERSATION and answer about THAT topic — never treat it as a standalone or generic question.\n" +
  "2. Ground specifics in the SOURCES where they apply and cite them inline as [n] (use ONLY the numbers given; never invent a citation, figure, or guideline). Name a key guideline or trial with its YEAR the first time you rely on it (e.g. 'Baveno VII (2022)', 'the 2021 Surviving Sepsis Campaign').\n" +
  "3. State EVIDENCE QUALITY where it matters (randomised trial, meta-analysis, systematic review, observational, consensus; GRADE/strength if given) and distinguish well-established evidence from emerging or preliminary findings.\n" +
  "4. When approaches genuinely differ, say where the weight of evidence lies and where the disagreement is.\n" +
  "5. CRITICAL — NEVER refuse or dead-end. If the SOURCES are empty, sparse, or clearly about a DIFFERENT topic than the question, IGNORE the off-topic ones and STILL answer the question fully from well-established medical knowledge and major guidelines; add ONE short line that this rests on established guidance rather than the retrieved sources. NEVER reply that 'the provided sources do not contain information' (or any equivalent) — the clinician always receives a real, direct answer.\n" +
  "6. Never let an unrelated source pull your answer toward a different condition than the one the clinician asked about.\n" +
  "7. END with exactly this one line and nothing after it: 'This is an evidence summary, not a substitute for clinical judgment.'\n" +
  "Do not describe your retrieval process or mention PubMed. Do not add any other disclaimer (the interface already shows one).";

function clip(s, n) { return String(s == null ? "" : s).slice(0, n || 240); }

// Phase 2 (deep) — cross-encoder re-rank of the retrieved chunks with the Workers AI reranker
// (@cf/baai/bge-reranker-base). This is a genuine relevance model (not keyword overlap): it scores
// each chunk against the clinician's question so the most decision-relevant evidence leads the prompt
// and survives token clipping — the retrieval-quality core of DrOracle-grade answers. FAIL-SAFE: any
// error, missing binding, or unexpected response shape falls back to the deterministic lexical rank,
// so a model hiccup can never break or reorder-away a live answer.
function lexicalRank(question, arr) {
  const qSet = new Set(String(question || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);
  return (arr || []).map((c, i) => {
    const t = ((c.text || "") + " " + (c.diseaseId || "") + " " + (c.section || "")).toLowerCase();
    let s = 0; qSet.forEach((w) => { if (t.indexOf(w) >= 0) s++; });
    return { c, s, i };
  }).sort((a, b) => (b.s - a.s) || (a.i - b.i)).map((x) => x.c);
}
async function rerankRetrieved(env, question, chunks) {
  const arr = chunks || [];
  if (!env || !env.AI || arr.length < 2 || !question) return lexicalRank(question, arr);
  try {
    const contexts = arr.map((c) => ({ text: clip((c.text || "") + " " + (c.diseaseId || ""), 500) }));
    const r = await env.AI.run("@cf/baai/bge-reranker-base", { query: String(question).slice(0, 500), contexts });
    const resp = r && (Array.isArray(r) ? r : (r.response || r.result || r.data));
    if (Array.isArray(resp) && resp.length) {
      const ordered = resp
        .filter((x) => x && typeof x.id === "number" && x.id >= 0 && x.id < arr.length)
        .sort((a, b) => (Number(b.score) || 0) - (Number(a.score) || 0))
        .map((x) => arr[x.id]);
      if (ordered.length) { arr.forEach((c) => { if (ordered.indexOf(c) < 0) ordered.push(c); }); return ordered; }  // append any top_k-dropped chunks
    }
  } catch (e) { /* fall through to lexical */ }
  return lexicalRank(question, arr);
}

// Phase 3 (deep) — embeddings-based grounding verification. Splits the drafted answer into
// checkable claim sentences (those carrying a dose/number/threshold/guideline word), embeds them and
// the retrieved source chunks with Workers AI (bge), and flags any claim whose best cosine similarity
// to ANY source falls below a threshold — i.e. an assertion the provided evidence doesn't support.
// Double-gated (env.MAIK_VERIFY + client opt-in) and FAIL-SAFE ({checked:false} on any error), so it
// is inert in production until deliberately enabled and measured. Never alters the answer text.
const EMBED_MODEL_V = "@cf/baai/bge-base-en-v1.5";
function cosine(a, b) { let d = 0, na = 0, nb = 0; const n = Math.min(a.length, b.length); for (let i = 0; i < n; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return (na && nb) ? d / (Math.sqrt(na) * Math.sqrt(nb)) : 0; }
function stripForVerify(md) {
  return String(md || "")
    .replace(/@@REFINE:[\s\S]*$/i, "")            // drop the refine directive
    .replace(/```[\s\S]*?```/g, "")               // code fences
    .replace(/^\s*\|.*\|\s*$/gm, "")              // markdown table rows
    .replace(/^\s*#{1,6}\s+.*$/gm, "")            // headings
    .replace(/\[[0-9,\s]+\]/g, "")                // [n] citation markers
    .replace(/[*_>`]/g, "");
}
function claimSentences(md) {
  const clean = stripForVerify(md);
  const sents = clean.split(/(?<=[.!?])\s+|\n+/).map((s) => s.trim()).filter((s) => s.length >= 30);
  // only verify sentences that carry a specific, checkable claim (reduces false flags on generic prose)
  return sents.filter((s) => /\d|\bmg\b|\bmcg\b|\bml\b|%|first[- ]?line|contraindicat|\bdose|\bunits?\b|mmol|mg\/kg|\bmap\b|lactate/i.test(s)).slice(0, 12);
}
async function verifyGrounding(env, text, pkg) {
  if (!env || !env.AI || !text) return { checked: false };
  try {
    const sources = [];
    ((pkg && pkg.grounding) || []).forEach((g) => (g.knowledge || []).forEach((k) => { if (k && k.text) sources.push(clip(k.text, 400)); }));
    ((pkg && pkg.retrieved) || []).forEach((c) => { if (c && c.text) sources.push(clip(c.text, 400)); });
    if (pkg && pkg.treatment && pkg.treatment.default) { const d = pkg.treatment.default; if (d.line) sources.push(clip(d.line, 300)); (d.dosing || []).forEach((x) => sources.push(clip((x.drug || "") + " " + (x.dose || "") + " " + (x.route || "") + " " + (x.freq || ""), 140))); }
    const sents = claimSentences(text);
    const uniqSrc = Array.from(new Set(sources)).slice(0, 20);
    if (!sents.length || !uniqSrc.length) return { checked: true, flagged: [], total: sents.length };
    const emb = await env.AI.run(EMBED_MODEL_V, { text: sents.concat(uniqSrc) });
    const vecs = emb && emb.data;
    if (!Array.isArray(vecs) || vecs.length !== sents.length + uniqSrc.length) return { checked: false };
    const sVecs = vecs.slice(0, sents.length), srcVecs = vecs.slice(sents.length);
    const TH = Number(env.MAIK_VERIFY_THRESHOLD) || 0.42;
    const flagged = [];
    sents.forEach((s, i) => { let best = 0; for (const sv of srcVecs) { const c = cosine(sVecs[i], sv); if (c > best) best = c; } if (best < TH) flagged.push({ text: s.slice(0, 160), score: Math.round(best * 100) / 100 }); });
    return { checked: true, flagged, total: sents.length, threshold: TH };
  } catch (e) { return { checked: false }; }
}

function renderGroundedPrompt(pkg) {
  const L = [];
  const r = pkg.reasoning || {}, pc = pkg.patientCase || {};
  // The clinician's actual question MUST lead the prompt — otherwise the model answers from
  // whatever was retrieved and (with a vague follow-up) narrates unrelated retrieved diseases.
  if (pkg.question) L.push("=== CLINICIAN QUESTION (answer THIS specifically and completely) ===\n" + clip(pkg.question, 500) + "\n");
  if (pkg.history && pkg.history.length) {
    L.push("=== RECENT CONVERSATION (for context/continuity; do not repeat it back) ===");
    pkg.history.slice(-4).forEach(function (h) { if (h && h.q) L.push("Clinician: " + clip(h.q, 300)); if (h && h.a) L.push("MaiK: " + clip(h.a, 300)); });
    L.push("");
  }
  L.push("=== DETERMINISTIC ENGINE OUTPUT (AUTHORITATIVE — do not change the diagnosis) ===");
  if (r.gate) L.push("Gate: " + clip(JSON.stringify(r.gate), 300));
  (r.differential || []).forEach((d, i) => {
    L.push((i + 1) + ". " + d.name + " [" + d.class + ", confidence " + d.confidence + "/100]" +
      (d.supporting && d.supporting.length ? "\n   supporting: " + d.supporting.join(", ") : "") +
      (d.contradictory && d.contradictory.length ? "\n   against: " + d.contradictory.join(", ") : "") +
      (d.missing && d.missing.length ? "\n   not yet known: " + d.missing.join(", ") : ""));
  });
  L.push("\n=== PATIENT (de-identified) ===");
  const bits = [];
  if (pc.age != null) bits.push("age " + pc.age); if (pc.sex) bits.push("sex " + pc.sex);
  if (bits.length) L.push(bits.join(", "));
  if (pc.findings) L.push("Findings: " + pc.findings.join(", "));
  if (pc.abnormalLabs) L.push("Abnormal labs: " + clip(JSON.stringify(pc.abnormalLabs), 600));
  if (pc.labTrends) L.push("Lab trends: " + clip(JSON.stringify(pc.labTrends), 400));
  if (pc.cultures) L.push("Cultures: " + clip(JSON.stringify(pc.cultures), 900));
  if (pc.radiologyImpressions) L.push("Radiology impressions: " + clip(JSON.stringify(pc.radiologyImpressions), 500));
  // V2 token compression — DEDUPLICATE chunk text across grounding + retrieved so the SAME
  // evidence is never sent to Gemini twice (a chunk often appears in both). Pure token savings,
  // no content loss: the first occurrence (grounding, page-cited) is kept; later duplicates dropped.
  var _seenChunk = {};
  function _fresh(t) { var k = String(t == null ? "" : t).slice(0, 90).toLowerCase().replace(/\s+/g, " ").trim(); if (!k || _seenChunk[k]) return false; _seenChunk[k] = 1; return true; }
  L.push("\n=== RETRIEVED STEWARDMD KNOWLEDGE (PRIMARY SOURCE — reason from THIS) ===");
  (pkg.grounding || []).forEach((g) => {
    var emitted = [];
    (g.knowledge || []).forEach((c) => { if (_fresh(c.text)) emitted.push("   [" + c.section + "] " + clip(c.text, 300) + (c.source && c.source.ref ? " (" + c.source.ref + (c.source.page ? ", " + clip(c.source.page, 60) : "") + ")" : "")); });
    if (emitted.length) { L.push("• " + g.name + " (" + g.diseaseId + "):"); emitted.forEach((e) => L.push(e)); }
  });
  if ((pkg.retrieved || []).length) {
    // Chunks arrive already re-ranked by rerankRetrieved() (cross-encoder, lexical fallback) in the
    // explain handler, so emit in the given order — most decision-relevant evidence first.
    var _rlines = (pkg.retrieved || []).filter((c) => _fresh(c.text)).map((c) => "   [" + c.section + "] " + c.diseaseId + ": " + clip(c.text, 240) + (c.source && c.source.ref ? " (" + c.source.ref + ")" : ""));
    if (_rlines.length) { L.push("\nAdditional retrieved chunks (relevance-ranked):"); _rlines.forEach((e) => L.push(e)); }
  }
  if (pkg.treatment) {
    const t = pkg.treatment;
    L.push("\n=== TREATMENT RESOLUTION (precedence " + (t.precedence || []).join(" ▸ ") + ") ===");
    if (t.default) L.push("Default [" + (t.default.tier || "?") + "]: " + clip(t.default.line, 200) + (t.default.drugRefs && t.default.drugRefs.length ? " — drugs: " + t.default.drugRefs.join(", ") : "") + (t.default.source ? " (" + t.default.source + ")" : ""));
    if (t.default && t.default.steps && t.default.steps.length) t.default.steps.slice(0, 8).forEach((s) => L.push("   - " + clip(s, 200)));
    // Structured DOSING from the treatment resolution — the exact figures the clinician asks for.
    // Emitting drug names alone made MaiK re-offer the dose it never received; give it the numbers.
    if (t.default && t.default.dosing && t.default.dosing.length) {
      L.push("   Dosing (protocol figures — state these when asked; verify locally):");
      t.default.dosing.slice(0, 8).forEach((d) => L.push("     • " + d.drug + (d.label ? " (" + clip(d.label, 60) + ")" : "") + ": " +
        [d.dose, d.route, d.freq, d.duration && ("for " + d.duration)].filter(Boolean).map((x) => clip(x, 140)).join(" · ") +
        (d.coverage ? " — covers " + clip(d.coverage, 140) : "") + (d.why ? " — " + clip(d.why, 160) : "")));
    }
    (t.alternatives || []).slice(0, 4).forEach((a) => {
      L.push("Alt [" + (a.tier || "?") + "]: " + clip(a.line, 160) + (a.drugRefs && a.drugRefs.length ? " — " + a.drugRefs.join(", ") : ""));
      if (a.dosing && a.dosing.length) a.dosing.slice(0, 6).forEach((d) => L.push("     • " + d.drug + ": " +
        [d.dose, d.route, d.freq, d.duration && ("for " + d.duration)].filter(Boolean).map((x) => clip(x, 120)).join(" · ")));
    });
    if (t.overlayApplied && t.overlay) L.push("Hospital overlay (" + t.overlay.hospitalId + ", SEPARATE — does not replace the default): " + clip(JSON.stringify(t.overlay.recommendation), 700));
  }
  const rf = pkg.refs || {};
  const refLine = [];
  if (rf.drug && rf.drug.length) refLine.push("drugs(by ref): " + rf.drug.join(", "));
  if (rf.calculators && rf.calculators.length) refLine.push("calculators: " + rf.calculators.join(", "));
  if (rf.icuProtocols && rf.icuProtocols.length) refLine.push("ICU modules: " + rf.icuProtocols.join(", "));
  if (refLine.length) { L.push("\n=== REFERENCES (by reference only) ==="); L.push(refLine.join(" | ")); }
  // Antibiotic-stewardship STRUCTURE (curated). pkg.refs.stewardship carries the coverage matrix,
  // empiric/narrowing regimens, de-escalation guidance and toxicity/severity drivers — but was
  // dropped here (only drug/calculator/ICU refs were serialised), so "when can I de-escalate?" /
  // "what's the coverage matrix?" fell back to general knowledge. Sibling of the dose-grounding bug
  // (#482/#483). Emitted compactly (clip + caps) to stay inside MAX_IN_CHARS.
  const stw = (rf.stewardship || []).filter(Boolean);
  if (stw.length) {
    L.push("\n=== ANTIBIOTIC STEWARDSHIP (curated — use for de-escalation, narrowing & coverage questions) ===");
    stw.slice(0, 2).forEach((s) => {
      if (s.framework && s.framework.length) L.push("Principles: " + s.framework.slice(0, 4).map((x) => clip(x, 200)).join(" "));
      if (s.deescalation) L.push("De-escalation: " + clip(s.deescalation, 400));
      const cm = s.coverageMatrix;
      if (cm && cm.organisms && cm.organisms.length && cm.drugs && cm.drugs.length && cm.grid && cm.grid.length) {
        L.push("Coverage matrix (organism → " + cm.drugs.map((d) => clip(d, 40)).join(" / ") + "):");
        cm.organisms.slice(0, 8).forEach((org, i) => {
          const row = cm.grid[i] || [];
          L.push("   • " + clip(org, 60) + ": " + cm.drugs.map((d, j) => clip(d, 40) + " " + (row[j] == null ? "?" : clip(String(row[j]), 20))).join(", "));
        });
        if (cm.completeness) L.push("   completeness: " + clip(cm.completeness, 200));
        if (cm.gaps && cm.gaps.length) L.push("   gaps: " + cm.gaps.slice(0, 4).map((g) => clip(g, 160)).join("; "));
      }
      (s.regimens || []).slice(0, 3).forEach((rg) => {
        const drugs = (rg.drugs || []).slice(0, 4).map((d) => {
          const dose = [d.dose, d.route, d.frequency, d.duration && ("for " + d.duration)].filter(Boolean).map((x) => clip(x, 120)).join(" · ");
          return d.drug + (dose ? " (" + dose + ")" : "") + (d.coverage ? " — covers " + clip(d.coverage, 120) : "");
        });
        if (drugs.length) L.push((rg.label || "Regimen") + ": " + drugs.join("; "));
      });
      if (s.toxicityFactors && s.toxicityFactors.length) L.push("Severity/toxicity drivers: " + s.toxicityFactors.slice(0, 12).map((x) => clip(x, 40)).join(", "));
    });
  }
  if (pkg.question) L.push("\n=== CLINICIAN QUESTION ===\n" + clip(pkg.question, 500));
  // Phase 2 — numbered SOURCES for per-claim citations + table formatting hint. The client builds
  // this list (identical numbering to the footer it renders) so [n] markers line up exactly.
  if (pkg.sources && pkg.sources.length) {
    L.push("\n=== SOURCES (cite the specific supporting claim inline with [n]; use ONLY these numbers, never invent one) ===");
    pkg.sources.slice(0, 12).forEach((s) => L.push((s.n || "") + ". " + clip(s.title, 120)));
    L.push("\nFORMATTING: append the matching [n] right after a statement that rests on a source above (e.g. 'first-line is X [2]'). When a recommendation rests on a NAMED guideline or trial in the list (e.g. 'Surviving Sepsis Campaign 2021', 'ESC 2024', 'ICMR AMRSN 2024', an 'AAO' PPP), name it in prose with its year the first time you rely on it ('per the 2021 Surviving Sepsis Campaign [n]'), the way UpToDate attributes a source — do NOT name generic bucket titles ('StewardMD Knowledge Base', 'Standard internal-medicine reference') in prose, only mark them with [n]. When you compare 3+ options across the same attributes (differentials, empiric regimens, drug choices), present them as a compact GitHub-flavoured markdown table (header row + |---| separator). Do not cite what you cannot attribute to a listed source.");
  }
  return L.join("\n");
}

const VISION_SYS = {
  monitor: "Read this ICU monitor photo. Return ONLY JSON: {\"hr\":num,\"sbp\":num,\"dbp\":num,\"map\":num,\"rr\":num,\"spo2\":num,\"temp\":num,\"cvp\":num,\"etco2\":num}. Omit fields you cannot read with confidence. No prose.",
  labs: "Read this laboratory report photo. Return ONLY JSON with any of: {\"na\",\"k\",\"cl\",\"hco3\",\"ca\",\"mg\",\"po4\",\"glu\",\"creat\",\"urea\",\"alb\",\"wbc\",\"hb\",\"plt\",\"inr\",\"ferritin\",\"crp\",\"bili\",\"ast\",\"alt\"} as numbers. Omit unreadable fields. No prose.",
  ventilator: "Read this ventilator screen photo. Return ONLY JSON: {\"mode\":str,\"fio2\":num,\"peep\":num,\"tv\":num,\"rr\":num,\"peak\":num,\"plateau\":num}. Omit unreadable fields. No prose.",
  flowsheet: "Read this ICU flow-sheet photo. Return ONLY JSON: {\"intake24h\":num,\"output24h\":num,\"urine24h\":num,\"drains\":num}. Omit unreadable fields. No prose.",
  abg: "Read this arterial blood gas (ABG) report photo. Return ONLY JSON with any of: {\"ph\":num,\"paco2\":num,\"pao2\":num,\"hco3\":num,\"be\":num,\"lactate\":num,\"fio2\":num}. Omit fields you cannot read with confidence. No prose.",
  // Combined extractor (gold249): ONE image OR one multi-page OCR text may contain several report
  // types at once (e.g. a photo showing the monitor AND an ABG slip, or a PDF whose page 1 is
  // chemistry and page 2 is an ABG). Return SECTIONED JSON so overlapping keys (HCO3, lactate,
  // FiO2, RR) land in the correct section and nothing is lost.
  all: "Read this clinical report image which may contain a laboratory report, an ABG report, a ventilator screen, an ICU monitor, or several of these together or across multiple pages. Return ONLY JSON containing whichever of these sections you can read, omitting any section or field you cannot read with confidence: {\"labs\":{\"na\":num,\"k\":num,\"cl\":num,\"hco3\":num,\"ca\":num,\"mg\":num,\"po4\":num,\"glu\":num,\"creat\":num,\"urea\":num,\"alb\":num,\"wbc\":num,\"hb\":num,\"plt\":num,\"inr\":num,\"crp\":num,\"bili\":num,\"ast\":num,\"alt\":num,\"lactate\":num},\"abg\":{\"ph\":num,\"paco2\":num,\"pao2\":num,\"hco3\":num,\"be\":num,\"lactate\":num,\"fio2\":num},\"vitals\":{\"hr\":num,\"sbp\":num,\"dbp\":num,\"map\":num,\"rr\":num,\"spo2\":num,\"temp\":num,\"cvp\":num,\"etco2\":num},\"ventilator\":{\"mode\":str,\"fio2\":num,\"peep\":num,\"tv\":num,\"rr\":num,\"peak\":num,\"plateau\":num}}. Assign each value to the section it belongs to: HCO3/lactate from a chemistry panel go in labs, from a blood gas go in abg. All values are numbers except ventilator.mode which is a short string. No prose.",
  // medication_list: live /api/ai/vision call is PROD-ONLY (tests mock the vision call).
  medication_list: "Read this medication image (prescription / OPD ticket / case sheet / discharge summary / medication chart / handwritten Rx). Extract ONLY prescribed medicine rows. Return ONLY JSON: {\"medications\":[{\"detected_text\":str,\"drug\":str|null,\"strength\":str,\"route\":str,\"frequency\":str,\"form\":str,\"confidence\":\"high\"|\"medium\"|\"low\"}]}. Rules: detected_text is the raw text you read for that row, preserved VERBATIM. Set `drug` to the medicine's STANDARDISED GENERIC (INN) name in lowercase — do the mapping yourself: expand brand names to their generic (e.g. 'Betaloc'->'metoprolol', 'Augmentin'->'amoxicillin + clavulanate', 'Pan'->'pantoprazole'), translate Latin or non-English drug names to the English INN (e.g. 'Dorzolamidum'->'dorzolamide', 'Acidum acetylsalicylicum'->'aspirin'), and correct obvious scanning/handwriting misspellings to the intended INN (e.g. 'Oxprelol'->'oxprenolol', 'Metrepolol'->'metoprolol'). Only set `drug` when you are confident of the REAL medicine intended; if genuinely unsure, set it to null (do NOT guess). For a fixed-dose combination, give the generic components joined by ' + '. Ignore patient identifiers, demographics, vitals, diagnoses, and billing. NEVER invent a medicine that is not written. Mark unclear or illegible handwriting as \"low\" confidence but still preserve its detected_text. Return only the medication list, no prose."
};

// Imaging Assist (clinician-invoked). Input is a DE-IDENTIFIED packet built client-side
// (report text already PHI-redacted). Output is an advisory, review-required, structured
// summary — NEVER a diagnosis. The deterministic engine remains the diagnostic authority.
const IMAGING_SYS =
  "You are a clinical decision-support assistant summarizing ONE radiology report for a doctor. " +
  "You are NOT the diagnostic authority — a deterministic engine owns the diagnosis; your output is an advisory DRAFT the clinician must verify. " +
  "Reason ONLY from the report text and the de-identified context provided. NEVER invent findings, values, measurements, or history that are not in the report. " +
  "Use hedged wording only: 'Imaging is suggestive of…', 'Consider correlation with…', 'Differential considerations include…', 'Urgent review may be needed if…'. " +
  "You MUST NEVER write 'confirmed diagnosis', 'the patient definitely has', 'no emergency', 'rule out completely', or 'safe to discharge'. " +
  "If the report has no impression or is too sparse to interpret reliably, set summary to exactly 'Insufficient report detail for reliable interpretation — review original radiology report.' and return empty arrays for the rest.";
const IMAGING_TASK =
  "Return ONLY JSON, no prose outside it, with EXACTLY these keys: " +
  "{\"summary\":string, \"positives\":[string], \"negatives\":[string], \"significance\":[string], \"differentials\":[string], \"correlateWith\":[string], \"redFlags\":[string], \"nextChecks\":[string]}. " +
  "\"summary\" is ONE sentence. Each array holds short concise phrases (use [] if genuinely none). " +
  "\"differentials\" are considerations only (hedged), never a single confirmed diagnosis. \"redFlags\" list urgent findings that warrant escalation IF present in the report.";
// Clinical Correlation (Phase 3). De-identified evidence packet (imaging concepts + lab
// abnormalities + clinician findings) → advisory correlation. NEVER a diagnosis.
const CORRELATE_SYS =
  "You are a clinical decision-support assistant correlating a patient's imaging concepts, laboratory abnormalities and recorded findings for a doctor. " +
  "You are NOT the diagnostic authority — a deterministic engine owns the diagnosis; your output is advisory and must be verified. " +
  "Reason ONLY from the de-identified evidence provided; never invent findings, values, or history. " +
  "Use hedged wording only (suggestive of / consider correlation with / differential considerations include). " +
  "NEVER write 'confirmed diagnosis', 'definitely has', 'no emergency', or 'safe to discharge'. If the evidence is too sparse to correlate, say so plainly in clinicalCorrelation and return empty arrays.";
const CORRELATE_TASK =
  "Return ONLY JSON with EXACTLY these keys: {\"clinicalCorrelation\":string, \"topConsiderations\":[string], \"whyFit\":[string], \"alternatives\":[string], \"whatDoesntFit\":[string], \"missing\":[string], \"redFlags\":[string], \"nextChecks\":[string], \"protocols\":[string]}. " +
  "clinicalCorrelation is 1-2 sentences. Each array holds short concise phrases (use [] if none). No prose outside the JSON.";
function parseJsonLoose(t) {
  if (!t) return null;
  var m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

// TEXT mode for AI Vision (privacy path D→B): the app runs OCR ON-DEVICE and sends only
// the extracted text — the image never reaches the server. Reuse each kind's JSON
// schema/rules but feed OCR text instead of an image.
const VISION_LABEL = { monitor: "ICU monitor", labs: "laboratory report", ventilator: "ventilator screen", flowsheet: "ICU flow-sheet", abg: "arterial blood gas (ABG) report", all: "clinical report (labs / ABG / ventilator / monitor, possibly multi-page)", medication_list: "medication list / prescription" };
function visionTextPrompt(kind, ocr) {
  var schema = String(VISION_SYS[kind] || VISION_SYS.monitor).replace(/^Read this [^.]*\.\s*/i, "");
  return "The following is text extracted ON-DEVICE by OCR from a " + (VISION_LABEL[kind] || "clinical source") +
    " (no image is sent to the server). Extract the structured values from THIS TEXT ONLY; never invent values not present. " +
    schema + "\n\n=== OCR TEXT ===\n" + ocr;
}

// Voice extract (MaiK Scribe): a spoken clinician dictation → structured ICU fields.
// Reuses each kind's exact JSON schema; extract ONLY values explicitly stated.
function transcriptExtractPrompt(kind, transcript) {
  var schema = String(VISION_SYS[kind] || VISION_SYS.monitor).replace(/^Read this [^.]*\.\s*/i, "");
  return "The following is a spoken clinical dictation (speech-to-text transcript) describing a " + (VISION_LABEL[kind] || "clinical") +
    " context. Extract only the structured values the clinician EXPLICITLY stated in THIS TRANSCRIPT; never infer or invent a value that was not spoken; omit anything not clearly stated. " +
    schema + "\n\n=== TRANSCRIPT ===\n" + transcript;
}

// Voice extract (reasoning): a free-text case description → EXACT finding keys from the
// supplied catalog ONLY (the client sends its finding ontology). Never invents keys.
function reasoningExtractPrompt(transcript, catalog) {
  var cat = (catalog || []).map(function (c) { return c.key + " = " + (c.label || c.key); }).join("\n");
  return "You are extracting structured clinical findings from a doctor's spoken description of ONE patient. " +
    "Below is a CONTROLLED FINDING CATALOG (key = human label). Map the transcript to findings using ONLY keys that appear in this catalog — NEVER invent, guess, or modify a key. " +
    "Return ONLY JSON: {\"findings\":[\"<exact catalog key>\", ...], \"patient\":{\"age\":<number|null>,\"sex\":\"male\"|\"female\"|null}, \"unmatched\":[\"<short phrase you heard but could not map>\", ...]}. " +
    "Include a finding ONLY if the transcript clearly asserts it is PRESENT — never include a finding the clinician explicitly denies or negates. Put clinically-relevant things you heard but cannot map to a catalog key into `unmatched` as short phrases. No prose outside the JSON.\n\n" +
    "=== FINDING CATALOG (key = label) ===\n" + cat + "\n\n=== TRANSCRIPT ===\n" + transcript;
}

// Reusable NCBI PubMed E-utilities lookup, filtered to guideline / systematic-review / meta-analysis
// publication types. Returns an array of { title, journal, year, pubtype, url, pmid } (most-relevant
// first), [] when no matching PMIDs exist, or THROWS on a lookup failure (fetch/parse/empty-summary)
// so the caller can distinguish "none found" from "the reference source is down". `ptypeFilter` lets
// a caller tighten/loosen the publication-type filter; default matches the prior /evidence behaviour.
async function pubmedGuidelines(env, topic, ptypeFilter) {
  const contact = env.NCBI_EMAIL || "contact@stewardmd.in";
  const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
  const cred = "&tool=stewardmd&email=" + encodeURIComponent(contact);
  const filt = ptypeFilter || "(Practice Guideline[ptyp] OR Guideline[ptyp] OR systematic review[ptyp] OR Review[ptyp])";
  const term = encodeURIComponent(topic + " AND " + filt + ' AND English[lang] AND ("2013"[dp] : "3000"[dp])');
  const es = await fetchJsonWithTimeout(base + "esearch.fcgi?db=pubmed&retmode=json&retmax=6&sort=relevance" + cred + "&term=" + term, { cf: { cacheTtl: 86400 } }, 12000);
  if (es.status >= 400) throw new Error("esearch " + es.status);
  const ej = es.data;
  if (ej && ej.esearchresult && ej.esearchresult.ERROR) throw new Error("esearch-error");
  const ids = ((ej && ej.esearchresult && ej.esearchresult.idlist) || []).slice(0, 6);
  if (!ids.length) return [];
  const su = await fetchJsonWithTimeout(base + "esummary.fcgi?db=pubmed&retmode=json" + cred + "&id=" + ids.join(","), { cf: { cacheTtl: 86400 } }, 12000);
  if (su.status >= 400) throw new Error("esummary " + su.status);
  const sj = su.data;
  const r = (sj && sj.result) || {};
  const results = ids.map(function (id) {
    const x = r[id]; if (!x || !x.title) return null;
    const pts = x.pubtype || [];
    return {
      title: String(x.title).replace(/\s+/g, " ").replace(/\.$/, "").trim(),
      journal: x.fulljournalname || x.source || "",
      year: String(x.pubdate || "").slice(0, 4),
      pubtype: pts.filter(function (p) { return /guideline|systematic review|meta-analysis/i.test(p); })[0] || pts[0] || "",
      url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/",
      pmid: id,
    };
  }).filter(Boolean);
  // esearch found matching PMIDs but esummary yielded none -> a lookup FAILURE, not "none found".
  if (!results.length) throw new Error("esummary-empty");
  return results;
}

export async function onRequest(context) {
  const { request, env, params } = context;
  // CORS preflight (native WebView streaming) — no auth; must precede authorise.
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!authorise(request, env)) return json({ error: "unauthorised" }, 403);
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const enabled = aiEnabled(env);

  // AI Control Center: apply the admin model + emergency mode for THIS request. Emergency "cheap"
  // forces the cheapest model (overriding the admin choice); "pause" is enforced at dispatch below.
  let _emergency = { mode: "off" };
  try {
    const _s0 = usageKv(env);
    if (_s0) {
      _emergency = await getEmergency(_s0);
      const _ov0 = await getModelOverride(_s0);
      env.__modelOverride = (_emergency && _emergency.mode === "cheap") ? CHEAP_MODEL : (_ov0 || undefined);
    }
  } catch (e) {}

  if (seg === "status") return json({ enabled: enabled, provider: providerOrder(env)[0], vertex: PROVIDERS.vertex.available(env), developer: PROVIDERS.developer.available(env), model: modelId(env) });

  // Admin diagnostics (aggregate usage; no PHI). Gated by UPDATES_ADMIN_TOKEN.
  if (seg === "admin") {
    const want = env.UPDATES_ADMIN_TOKEN || "";
    const url = new URL(request.url);
    const got = (request.headers.get("X-Admin-Token") || url.searchParams.get("token") || "");
    const tokenOK = !!want && got === want;
    if (!tokenOK && !(await ownerOK(request, env))) return json({ error: "forbidden" }, 403);   // owner Google login OR admin token
    const rep = await adminReport(env);
    if (url.searchParams.get("format") === "csv") {
      const rows = [["account", "tokens", "general", "case", "ocr"]].concat((rep.accounts || []).map((a) => [a.acct, a.tokens, a.general, a.case, a.ocr]));
      return new Response(rows.map((r) => r.join(",")).join("\n"), { headers: { "Content-Type": "text/csv", "Cache-Control": "no-store" } });
    }
    return json(rep);
  }

  // AI Control Center admin console APIs (owner-gated): model switch, quota editor, global rollup,
  // emergency kill switch, runtime budget, audit log. Every mutation is written to the audit log.
  if (seg === "admin/model" || seg === "admin/ai-usage" || seg === "admin/limits" || seg === "admin/emergency" || seg === "admin/budget" || seg === "admin/audit" || seg === "admin/abuse") {
    const url = new URL(request.url);
    if (!(await aiAdminAuthed(request, env, url))) return json({ error: "forbidden" }, 403);
    const store = usageKv(env);
    let actorId = "admin"; try { actorId = (await identify(request, env)).id; } catch (e) {}

    if (seg === "admin/ai-usage") return json(await globalUsageReport(env, store, Date.now()));
    if (seg === "admin/audit") return json({ audit: await getAudit(store) });

    if (seg === "admin/abuse") {
      if (request.method === "POST") {
        let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
        if (!(await setAbuseThreshold(store, b.threshold))) return json({ ok: false, error: "bad-threshold" }, 400);
        await auditRecord(store, "abuse", "threshold=" + (b.threshold == null || b.threshold === "" ? "default" : b.threshold), actorId, Date.now());
      }
      return json({ ok: true, threshold: await getAbuseThreshold(store, env) });
    }

    if (seg === "admin/emergency") {
      if (request.method === "POST") {
        let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
        if (!(await setEmergency(store, b.mode, actorId, Date.now()))) return json({ ok: false, error: "bad-mode", modes: EMERGENCY_MODES }, 400);
        await auditRecord(store, "emergency", "mode=" + b.mode, actorId, Date.now());
      }
      return json({ ok: true, emergency: await getEmergency(store), modes: EMERGENCY_MODES });
    }

    if (seg === "admin/budget") {
      if (request.method === "POST") {
        let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
        if (!(await setBudget(store, b.inr))) return json({ ok: false, error: "bad-budget" }, 400);
        await auditRecord(store, "budget", "dailyInr=" + (b.inr == null || b.inr === "" ? "default" : b.inr), actorId, Date.now());
      }
      return json({ ok: true, budget: await getBudget(store) });
    }

    if (seg === "admin/limits") {
      if (request.method === "POST") {
        let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
        if (!(await setLimitOverride(store, b.module, b.limit))) return json({ ok: false, error: "bad-limit" }, 400);
        await auditRecord(store, "limit", b.module + "=" + (b.limit == null || b.limit === "" ? "default" : b.limit), actorId, Date.now());
      }
      const ov = await limitOverrides(store);
      const modules = aiModuleList().map((m) => ({ id: m.id, label: m.label, group: m.group, defaultLimit: moduleDailyLimit(env, m.id), effective: resolveLimit(env, m.id, ov), overridden: Object.prototype.hasOwnProperty.call(ov, m.id) }));
      return json({ ok: true, modules: modules, overrides: ov });
    }

    // admin/model
    if (request.method === "POST") {
      let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
      const ok = await setModelOverride(store, b.model || null);   // null/"" clears the override
      const nv = await getModelOverride(store); env.__modelOverride = nv;   // reflect the just-set value
      await auditRecord(store, "model", "-> " + (nv || "default"), actorId, Date.now());
      return json({ ok: ok, model: nv, effective: modelId(env), allowed: ALLOWED_MODELS });
    }
    return json({ model: await getModelOverride(store), effective: modelId(env), allowed: ALLOWED_MODELS, rates: MODEL_RATES });
  }

  // AI Control Center: owner-facing per-user report + per-user cap editor.
  if (seg === "admin/users") {
    const url = new URL(request.url);
    if (!(await aiAdminAuthed(request, env, url))) return json({ error: "forbidden" }, 403);
    const day = (url.searchParams.get("day") || "").match(/^\d{4}-\d{2}-\d{2}$/) ? url.searchParams.get("day") : new Date().toISOString().slice(0, 10);
    return json(await usersReport(usageKv(env), day));
  }
  if (seg === "admin/user-limit" && request.method === "POST") {
    const url = new URL(request.url);
    if (!(await aiAdminAuthed(request, env, url))) return json({ error: "forbidden" }, 403);
    let b = {}; try { b = (await request.json()) || {}; } catch (e) {}
    const email = String(b.email || "").toLowerCase();
    const module = String(b.module || "");
    const limit = (b.limit == null || b.limit === "") ? null : Number(b.limit);
    if (!email || !module) return json({ error: "bad-request" }, 400);
    const store = usageKv(env);
    const map = await setUserLimit(store, email, module, limit);
    let actorId = "admin"; try { actorId = (await identify(request, env)).id; } catch (e) {}
    try { await auditRecord(store, "user-limit", email + ":" + module + "=" + (limit == null ? "default" : limit), actorId, Date.now()); } catch (e) {}
    return json({ ok: true, email: email, limits: map || {} });
  }

  // A doctor's OWN AI usage for today (never another doctor's). Powers the in-app AI Usage page.
  if (seg === "usage") {
    const store = usageKv(env);
    const who = await identify(request, env);
    return json(await doctorUsageSummary(env, store, usageKeyFor(who), Date.now()));
  }

  if (seg === "health") {
    const order = providerOrder(env);
    const vAvail = PROVIDERS.vertex.available(env), dAvail = PROVIDERS.developer.available(env);
    const fb = order[1] || null;
    return json({
      enabled: enabled,
      provider: order[0],
      fallback_available: !!(fb && PROVIDERS[fb] && PROVIDERS[fb].available(env)),
      fallback_provider: fb,
      model: modelId(env),
      token_cache: true,
      last_failover: _lastFailover,
      vertex_status: vAvail ? "healthy" : "unavailable",
      developer_status: dAvail ? "ready" : "not_configured",
      authentication: vAvail ? (env.GCP_WIF_PRIVATE_KEY ? "Workload Identity Federation" : "Service Account JWT") : "none"
    });
  }
  if (!enabled) return json({ error: "ai-disabled", enabled: false }, 200);  // client falls back to rule-based

  let body = {};
  try { if (request.method === "POST") body = await request.json(); } catch (e) {}

  // ── AI Control Center (Phase 2b) ─────────────────────────────────────────────────────────────
  // (a) apply the admin "switch models" override for THIS request; (b) enforce the per-module DAILY
  // cap + count the call (layered on top of the global _usage.js budget/rate gate). Fail-open on any
  // store/identity error so metering never breaks a clinical AI call.
  const _acStore = usageKv(env);
  if (_acStore) {
    let _mod = MODULE_FOR[seg];
    if (_mod === "maik" && seg === "explain") {
      const _pkg = body.package || body;
      if (_pkg && _pkg.reasoning && _pkg.reasoning.differential && _pkg.reasoning.differential.length) _mod = "maik_case";
    }
    // Research Mode (Evidence Review) counts against its OWN 2/day "research" bucket, but that cap is
    // enforced INSIDE the /research handler AFTER the KV cache check — a cached answer must never burn
    // a daily slot — so it opts OUT of this generic pre-count. Normal web-research is remapped back to
    // "maik" so it counts as a MaiK question exactly as before (zero regression). Both still honour
    // the emergency kill switch below.
    const _isEvidReview = (seg === "research" && body && body.mode === "evidence-review");
    if (seg === "research" && !_isEvidReview) _mod = "maik";
    // Emergency "pause" kill switch — block every AI-consuming call before any LLM/web work.
    if ((_mod || _isEvidReview) && _emergency && _emergency.mode === "pause") {
      return json({ error: "quota", reason: "emergency", message: "AI is temporarily paused by the administrator. Clinical reasoning, calculators, and reference tools remain available." }, 503);
    }
    if (_mod || _isEvidReview) {
      try {
        const _dc = await deviceCheck(env, _acStore, request, Date.now());
        if (!_dc.ok) return json({ error: "quota", reason: "device-cap", message: "Daily AI limit for this device reached. Try again after midnight." }, 429);
      } catch (e) { /* fail-open */ }
    }
    if (_mod && !_isEvidReview) {
      try {
        const _who = await identify(request, env);
        const _mq = await gateAndCount(env, _acStore, _mod, usageKeyFor(_who), _who.guest ? "guest" : "unknown", Date.now(), _who.email);
        // Mirror the existing quota response shape so the client's quota handling surfaces it unchanged.
        if (!_mq.ok) return json({ error: "quota", reason: "module-daily", module: _mod, used: _mq.used, limit: _mq.limit, message: moduleLimitMsg(_mod, _mq.limit) }, 429);
      } catch (e) { /* fail-open — never block a clinical call on a metering error */ }
    }
  }

  // Cost controls (server-side, env-configurable). Output is hard-capped; oversized
  // inputs are rejected before any provider call. Per-user quota metering + circuit
  // breaker are layered in a follow-up (functions/_usage.js + KV) — these caps are the
  // no-auth floor that bounds per-request cost immediately.
  // Output cap. LATENCY: the streamed answer isn't done until generation finishes, so a shorter
  // answer completes sooner — but 768 was clipping thorough answers and made MaiK read like a terse
  // search digest rather than a knowledgeable medical AI. Default now 1100 (~a full, well-organised
  // bedside answer); streaming keeps perceived speed fine, and the model still adapts short answers
  // short. "detailed" depth doubles it. Override with MAIK_MAX_OUTPUT_TOKENS. Was 768/1400.
  const OUT_BASE = Math.max(256, Math.min(2048, Number(env.MAIK_MAX_OUTPUT_TOKENS) || 1100));
  const MAX_OUT = (body && body.depth === "detailed") ? Math.min(2048, Math.round(OUT_BASE * 2)) : OUT_BASE;
  // Native (capacitor://) CANNOT stream — CapacitorHttp buffers SSE — so it waits for the ENTIRE
  // answer before anything renders; a long answer there = a long blank wait. The non-stream concise
  // answer therefore uses a TIGHTER cap so generation finishes fast. Streaming web keeps OUT_BASE (it
  // flows, so length is ~free), and "detailed" honours the explicit depth request on either path.
  const NONSTREAM_BASE = Math.max(256, Math.min(1100, Number(env.MAIK_NONSTREAM_OUTPUT_TOKENS) || 600));
  const MAX_IN_CHARS = Math.max(2000, (Number(env.MAIK_MAX_INPUT_TOKENS) || 4000) * 4);

  try {
    if (seg === "explain") {
      // Preferred: grounded RAG package (KB primary). The client assembles it from
      // the deterministic engine output + retrieved StewardMD knowledge; we forward
      // it to Gemini with the KB-primary system prompt. The whole KB never transits.
      const pkg = body.package || (body.grounding || body.reasoning ? body : null);
      if (pkg && (pkg.grounding || pkg.reasoning)) {
        // No computed diagnosis → general-knowledge (educational) mode; otherwise
        // MaiK is commentary on the deterministic assessment. The engine still OWNS Dx.
        const hasDx = !!(pkg.reasoning && pkg.reasoning.differential && pkg.reasoning.differential.length);
        const sys = hasDx ? RAG_SYS : KNOWLEDGE_SYS;
        const gate = await checkQuota(env, request, hasDx ? "case" : "general");
        if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
        // Phase 2 (deep) — cross-encoder re-rank the retrieved evidence before building the prompt.
        try { if (pkg.retrieved && pkg.retrieved.length > 1) pkg.retrieved = await rerankRetrieved(env, pkg.question, pkg.retrieved); } catch (e) {}
        // ── StewardMD Connect Track D (flag smd_connect_maik, default OFF) ─────────────────────────
        // If the clinician has attached a Connect patient to their MaiK session, optionally fold the
        // CANONICAL SCCM context into pkg. SECURITY: applyConnectContext adds ONLY the R7-gated LLM-
        // egress lane (real PHI never reaches the model on flag-on alone); when the BAA/no-retention
        // gate is closed it adds NOTHING to pkg. Fail-safe: any Connect error degrades to "no context"
        // and never breaks/delays the answer. Inert + byte-identical unless BOTH Connect flags are on.
        if (maikWiringOn(env)) { try { await applyConnectContext(env, request, pkg); } catch (e) {} }
        let grounded = renderGroundedPrompt(pkg).slice(0, MAX_IN_CHARS);
        // MaiK Brain (Part 2): if the client sent a RANKED evidence bundle, synthesize from it
        // (StewardMD-first, deduped) and adapt tone to the inferred audience. Backward-compatible:
        // absent → sysA/grounded are unchanged.
        let sysA = sys;
        try {
          if (pkg.audience) sysA = sys + "\n\nAUDIENCE: write for a " + String(pkg.audience).slice(0, 20) + " — adapt depth and tone accordingly; never ask which.";
          if (pkg.evidenceBundle && Array.isArray(pkg.evidenceBundle.claims) && pkg.evidenceBundle.claims.length) {
            const ebLines = pkg.evidenceBundle.claims.slice(0, 20).map((c, i) => (i + 1) + ". [" + (c.tier ? "tier " + c.tier : "kb") + "] " + String(c.text || "").slice(0, 320)).join("\n");
            grounded = ("RANKED EVIDENCE (StewardMD-validated first, then national → international guidelines). Synthesize ONE coherent answer from this ranked evidence — do not copy any single item verbatim; merge overlapping points; cite sources; if items conflict, state the disagreement and the higher-authority position:\n" + ebLines + "\n\n" + grounded).slice(0, MAX_IN_CHARS);
          }
          // Lazy two-call generation (client flag smd_maik_lazy). tier 1 = bottom line ONLY (cheap,
          // fast); tier 2 = the depth, fetched only if the clinician taps "Know more". Inert unless the
          // client sends body.tier, so the default single-call behaviour is byte-identical.
          if (body && body.tier === 1) sysA = sysA + "\n\nOUTPUT MODE — BOTTOM LINE ONLY: give ONLY tier 1 (the direct answer PLUS all safety-critical information — red flags, contraindications, time-critical 'refer/admit/treat now' actions, key drug cautions). Do NOT write @@MORE@@ and do NOT write any tier-2 detail; a separate follow-up will request the depth.";
          else if (body && body.tier === 2) sysA = sysA + "\n\nOUTPUT MODE — DETAIL ONLY: the clinician already has your concise bottom line" + (body.priorLead ? (" (\"" + String(body.priorLead).slice(0, 400).replace(/"/g, "'") + "\")") : "") + ". Now give ONLY the tier-2 depth for this question — rationale, investigations, full dose/route/duration, evidence and named guidelines, the differential table, the 'In India' note, and nuance. Do NOT repeat the bottom line and do NOT write @@MORE@@.";
        } catch (e) {}
        // Phase 2 — opt-in streaming (client sends ?stream=1 + Accept: text/event-stream). If the
        // provider can't stream we fall straight through to the unchanged JSON path below, so the
        // answer never fails to arrive.
        const wantStream = (new URL(request.url).searchParams.get("stream") === "1") && (((request.headers.get("Accept")) || "").indexOf("text/event-stream") >= 0);
        // True live token streaming from the provider is UNRELIABLE in production (the SSE upstream
        // opens then delivers zero bytes, so the client stalls on an empty stream and only recovers via
        // a late fallback — the "MaiK took too long" hang). Default OFF: serve stream requests from the
        // RELIABLE whole-answer call below and hand the answer back over the SSE channel the client is
        // already listening on (streamTextAsSSE). Flip MAIK_LIVE_STREAM=1 to try true streaming again.
        const liveStream = ["1", "true", "on", "yes"].indexOf(String(env.MAIK_LIVE_STREAM || "").toLowerCase()) >= 0;
        if (wantStream && liveStream) {
          let up = null;
          try { up = await geminiStreamUpstream(env, [{ text: sysA + "\n\n" + grounded }], MAX_OUT, { temperature: hasDx ? 0.25 : 0.45 }); } catch (e) { up = null; }
          if (up) return withCors(request, streamGeminiToSSE(up, function (full) { try { recordUsage(gate, { inTok: estTokens(sys.length + grounded.length), outTok: estTokens((full || "").length), status: "success" }); } catch (e) {} }));
        }
        let text;
        // Non-stream path (native, or a stream that failed to open): use the SAME full system prompt +
        // output budget as the streaming path, so the UpToDate-style structure (assumption lead,
        // comparison tables, In-India note, refine chips) appears EVERYWHERE — including native, where
        // CapacitorHttp can't stream. Simple/factual questions still self-adapt short (KNOWLEDGE_SYS says
        // so), so a dose lookup stays brief + fast; only a genuinely long clinical answer uses the fuller
        // budget — native then waits for the whole answer, the accepted trade for full structure.
        // Non-stream is now the default delivery (native, and stream requests routed here), so a
        // concise answer uses the TIGHTER cap → generation finishes ~2x faster (the ~10-15s native
        // "Searching…" wait). "detailed" still gets the full budget on explicit request.
        const nsCap = (body && (body.depth === "detailed" || body.tier === 2)) ? MAX_OUT : NONSTREAM_BASE;
        const nsSys = sysA;
        try { text = await callGemini(env, [{ text: nsSys + "\n\n" + grounded }], nsCap, { temperature: hasDx ? 0.25 : 0.45 }); }
        catch (e) { await recordUsage(gate, { inTok: estTokens(nsSys.length + grounded.length), outTok: 0, status: "failed" }); throw e; }
        await recordUsage(gate, { inTok: estTokens(nsSys.length + grounded.length), outTok: estTokens((text || "").length), status: "success" });
        // Client asked for a stream: hand the reliable whole-answer back over the SSE channel it's
        // already listening on (one delta + done). Renders immediately — no empty stream, no hang.
        if (wantStream) return withCors(request, streamTextAsSSE(text));
        const cites = [];
        (pkg.grounding || []).forEach((g) => (g.provenance || []).forEach((p) => { if (p && cites.indexOf(p) < 0) cites.push(p); }));
        return json({ text: text, mode: "grounded", citations: cites });
      }
      // Legacy fallback: plain engine summary string (backward compatible).
      const summary = String(body.summary || "").slice(0, MAX_IN_CHARS);
      if (!summary) return json({ error: "no summary" }, 400);
      const gate = await checkQuota(env, request, "case");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const prompt = EXPLAIN_SYS + "\n\n--- ENGINE OUTPUT ---\n" + summary + (body.question ? "\n\nClinician question: " + String(body.question).slice(0, 500) : "");
      const text = await callGemini(env, [{ text: prompt }], MAX_OUT);
      await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
      return json({ text: text, mode: "summary" });
    }
    if (seg === "verify") {
      // Phase 3 (deep) — embeddings grounding check. Double-gated: server env.MAIK_VERIFY must be on
      // (client also opt-in). Inert + zero-cost when disabled. Never blocks or alters an answer; the
      // client calls it after rendering and may surface a subtle advisory on flagged claims.
      const on = ["1", "true", "on", "yes"].indexOf(String(env.MAIK_VERIFY || "").toLowerCase()) >= 0;
      if (!on) return json({ checked: false, disabled: true });
      const vpkg = body.package || body || {};
      const v = await verifyGrounding(env, String(body.text || "").slice(0, 8000), vpkg);
      return json(v);
    }
    if (seg === "refine" || seg === "route") {
      // MaiK V3 — UNIVERSAL MEDICAL SEMANTIC ROUTER. A cheap Vertex-Flash call that parses the medical
      // MEANING of ANY query (abbreviation, acronym, eponym, brand, code, shorthand, typo, BrE/AmE)
      // into structured JSON, WITHOUT answering it. This is the generalisation layer: no disease-specific
      // rules — the model's medical knowledge resolves the infinite long tail to canonical concepts +
      // intent. The client then drives deterministic KB retrieval from the canonical concept; Gemini
      // only explains when the KB can't. Tiny output (~120 tokens), temp 0.
      const q = String(body.q || body.question || "").slice(0, 400).trim();
      if (!q) return json({ error: "no-query" }, 400);
      if (firewallBlock(q)) return json({ outOfScope: true, primaryConcept: "", intent: "other", confidence: 1, source: "firewall" }); // deterministic: no router LLM
      const gate = await checkQuota(env, request, "router");   // lightweight: no rate-limit slot, no request-count; token cost still metered
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const sys =
        "You are a MEDICAL QUERY PARSER for a knowledge-base retrieval system. Read a clinician's query in ANY form — full terms, abbreviations, acronyms, eponyms, brand names, drug compositions, lab/serology/imaging codes, clinical shorthand, mnemonics, typos, British or American spelling — and output ONLY its medical MEANING as compact JSON. NEVER answer the medical question; only parse it.\n" +
        "Interpret it the way a physician would, then return EXACTLY this JSON shape:\n" +
        '{"primaryConcept":"<single canonical FULL standard name of the main medical entity ONLY: expand every abbreviation/acronym, correct spelling, resolve brand->generic and code->full test/finding name, normalise to one standard term. Do NOT append the action, question-type, or qualifier words (treatment, prophylaxis, step-down, workup, interpretation, severity, crisis, exacerbation, prevention, dose, etc.) — those belong in intent/modifiers. e.g. \'gerd ppi step down\'->\'Gastroesophageal reflux disease\', \'dvt prophylaxis\'->\'Deep vein thrombosis\', \'pheochromocytoma crisis\'->\'Pheochromocytoma\'>",' +
        '"type":"disease|drug|drug_class|investigation|lab_test|imaging|procedure|organism|guideline|symptom|sign|concept",' +
        '"entities":[{"text":"<verbatim span from the query>","canonical":"<full standard name>","type":"<same enum>"}],' +
        '"intent":"<ONE of: definition, treatment, dose, differential, investigation, features, redflags, pathophysiology, prognosis, complications, prevention, etiology, risk_factors, epidemiology, classification, severity, guideline, followup, monitoring, interaction, contraindication, emergency, icu, screening, reasoning, other>",' +
        '"specialty":"<the medical specialty, or null>",' +
        '"modifiers":["<contextual qualifiers actually present, e.g. pregnancy, pediatric, geriatric, renal, hepatic, acute, severe, refractory>"],' +
        '"confidence":<0..1 that the parse is correct>,' +
        '"ambiguous":<true ONLY if the term has more than one common medical meaning AND the query gives no disambiguating context>,' +
        '"options":["<canonical meaning A>","<canonical meaning B>"],' +
        '"outOfScope":<true ONLY if this is NOT a medical/clinical/health question — e.g. software/coding, API integration, programming, general knowledge, math, personal/legal/financial, entertainment; false for ANY medical, clinical, drug, lab, imaging, procedure, patient or health question>}\n' +
        "RULES: (1) Expand EVERY abbreviation/acronym to its most likely full canonical medical name given clinical context; resolve brands to generic drugs and lab/serology/imaging codes to their full name. (2) Infer intent from shorthand generically: rx/tx/'management' => treatment; 'prophylaxis'/'ppx'/'prevent'/'prevention' => prevention; a named DRUG with a dosing cue (dose, dosing, drip, infusion, push, bolus, mg, mcg, units, rate, /kg) => dose; dx or 'diagnosis' => investigation; a lab/serology/marker/imaging token or 'cutoff'/'titre'/'level'/'interpretation' => investigation; a named set of DIAGNOSTIC CRITERIA used to ESTABLISH a diagnosis (e.g. Duke, Brugada, Sgarbossa, Light's) => investigation; a SEVERITY / PROGNOSTIC / RISK score or a staging/grading system (e.g. Ranson, APACHE, CURB-65, Child-Pugh, NIHSS) => severity; a named published GUIDELINE/consensus => guideline; a procedure/operation token => procedure; a comparison ('X vs Y'), a patient scenario, or a 'latest/recent evidence' request => reasoning. (3) AMBIGUITY: whenever a SHORT acronym (<=4 letters) has more than one well-established medical meaning AND the surrounding words do NOT decisively fix exactly one, set ambiguous=true and list the top 2-3 canonical meanings in options (still set primaryConcept to the most likely). Only skip this when one meaning is clearly dominant in context. (4) Do NOT invent modifiers that aren't in the query. (5) Output JSON ONLY, no prose, no markdown. This must generalise to every specialty and every future term — reason from meaning, not from any fixed list. (6) SCOPE: StewardMD is a clinician-only clinical tool. If the query is NOT a medical/clinical/health question (coding, software/API integration, general knowledge, math, trivia, personal/legal/financial advice), set outOfScope=true and primaryConcept=\"\"; for ANY medical/clinical/health question set outOfScope=false.\n\n" +
        "Query: " + q;
      let text;
      // Pin the router to a capable-but-fast model. flash-lite was measured to degrade parse quality
      // (intent -9pts, entity -10pts) WITHOUT cutting latency (the ~5-6s is Vertex serving/network/failover
      // overhead, not model compute), so the router uses full flash. Overridable via env.
      const routerModel = env.MAIK_ROUTER_MODEL || "gemini-2.5-flash";
      try { text = await callGemini(env, [{ text: sys }], 200, { temperature: 0, model: routerModel }); }
      catch (e) { await recordUsage(gate, { inTok: estTokens(sys.length), outTok: 0, status: "failed" }); return json({ error: "route-failed" }, 502); }
      await recordUsage(gate, { inTok: estTokens(sys.length), outTok: estTokens((text || "").length), status: "success" });
      const p = parseJsonLoose(text) || {};
      const concept = String(p.primaryConcept || p.topic || "").slice(0, 140);
      const opts = Array.isArray(p.options) ? p.options.map(function (x) { return String(x).slice(0, 80); }).filter(Boolean).slice(0, 4) : [];
      return json({
        primaryConcept: concept, topic: concept,   // topic = back-compat alias
        type: String(p.type || "").slice(0, 24),
        intent: normIntent(p.intent),
        specialty: p.specialty ? String(p.specialty).slice(0, 40) : null,
        modifiers: Array.isArray(p.modifiers) ? p.modifiers.map(function (x) { return String(x).slice(0, 40); }).slice(0, 6) : [],
        entities: Array.isArray(p.entities) ? p.entities.slice(0, 8).map(function (e) { return { text: String(e.text || "").slice(0, 60), canonical: String(e.canonical || "").slice(0, 100), type: String(e.type || "").slice(0, 24) }; }) : [],
        confidence: (typeof p.confidence === "number") ? Math.max(0, Math.min(1, p.confidence)) : 0.8,
        ambiguous: !!p.ambiguous && opts.length >= 2,
        options: opts,
        outOfScope: !!p.outOfScope,   // non-medical query → client refuses instantly (no KB/answer/research)
        mode: "route"
      });
    }
    if (seg === "imaging") {
      // Clinician-invoked imaging summary. Packet is DE-IDENTIFIED client-side (report text
      // PHI-redacted; NO name/MRN/bed/other-patient data). Structured, advisory, review-required.
      const pkt = body.packet || {};
      const reportText = clip(String(pkt.reportText || ""), Math.min(MAX_IN_CHARS, 6000));
      if (!reportText) return json({ error: "no-report" }, 400);
      const ctx = [];
      if (pkt.modality) ctx.push("Modality: " + clip(pkt.modality, 80));
      if (pkt.studyName) ctx.push("Study: " + clip(pkt.studyName, 160));
      if (pkt.indication) ctx.push("Indication: " + clip(pkt.indication, 300));
      if (pkt.ageBand) ctx.push("Age band: " + clip(pkt.ageBand, 20));
      if (pkt.sex) ctx.push("Sex: " + clip(pkt.sex, 12));
      if (pkt.specialty) ctx.push("Specialty: " + clip(pkt.specialty, 40));
      if (pkt.careSetting) ctx.push("Care setting: " + clip(pkt.careSetting, 24));
      if (pkt.workingDx) ctx.push("Working diagnosis (clinician, not authoritative): " + clip(pkt.workingDx, 160));
      if (Array.isArray(pkt.symptoms) && pkt.symptoms.length) ctx.push("Relevant clinical findings: " + clip(pkt.symptoms.join("; "), 400));
      if (Array.isArray(pkt.labs) && pkt.labs.length) ctx.push("Relevant labs: " + clip(pkt.labs.join(", "), 400));
      const gate = await checkQuota(env, request, "case");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const prompt = IMAGING_SYS + "\n\n=== CONTEXT (de-identified) ===\n" + ctx.join("\n") +
        "\n\n=== RADIOLOGY REPORT TEXT ===\n" + reportText + "\n\n=== TASK ===\n" + IMAGING_TASK;
      let text;
      try { text = await callGemini(env, [{ text: prompt }], MAX_OUT, { temperature: 0.3 }); }
      catch (e) { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); throw e; }
      await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
      const parsed = parseJsonLoose(text);
      return json(parsed ? { summary: parsed, mode: "imaging" } : { error: "parse", raw: String(text || "").slice(0, 1200), mode: "imaging" });
    }
    if (seg === "correlate") {
      // Clinician-invoked imaging+lab correlation. De-identified packet only (no identifiers).
      const pkt = body.packet || {};
      const img = (pkt.imaging && pkt.imaging.concepts) || [], labs = (pkt.labs && pkt.labs.abnormalities) || [];
      if (!img.length && !labs.length) return json({ error: "no-evidence" }, 400);
      const pc = pkt.patientContext || {}, L = ["=== PATIENT (de-identified) ==="];
      if (pc.ageBand) L.push("Age band: " + clip(pc.ageBand, 20));
      if (pc.sex) L.push("Sex: " + clip(pc.sex, 12));
      if (pc.careSetting) L.push("Care setting: " + clip(pc.careSetting, 24));
      L.push("\n=== IMAGING CONCEPTS ===\n" + (img.map(function (x) { return "• " + clip(String(x), 120); }).join("\n") || "none"));
      if (pkt.imaging && (pkt.imaging.criticalFlags || []).length) L.push("Critical imaging flags: " + clip(pkt.imaging.criticalFlags.join(", "), 300));
      L.push("\n=== LABORATORY ABNORMALITIES ===\n" + (labs.map(function (x) { return "• " + clip(String(x), 120); }).join("\n") || "none"));
      if (pkt.clinical && (pkt.clinical.approvedFindings || []).length) L.push("\n=== CLINICIAN-RECORDED FINDINGS ===\n" + clip(pkt.clinical.approvedFindings.join("; "), 500));
      const gate = await checkQuota(env, request, "case");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const prompt = CORRELATE_SYS + "\n\n" + L.join("\n").slice(0, MAX_IN_CHARS) + "\n\n=== TASK ===\n" + CORRELATE_TASK;
      let text;
      try { text = await callGemini(env, [{ text: prompt }], MAX_OUT, { temperature: 0.3 }); }
      catch (e) { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); throw e; }
      await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
      const parsed = parseJsonLoose(text);
      return json(parsed ? { correlation: parsed, mode: "correlate" } : { error: "parse", raw: String(text || "").slice(0, 1200), mode: "correlate" });
    }
    if (seg === "evidence") {
      // Trusted external reference lookup (opt-in fallback). Input is a DE-IDENTIFIED topic string
      // only (no patient data). Queries NCBI PubMed E-utilities — a single trusted NIH host —
      // filtered to guideline/review publication types. Returns REAL citations; NEVER open-web.
      // De-id backstop: strip standalone digit runs (MRN/bed/age) even if the client is bypassed —
      // a guideline/review search needs no numbers.
      const topic = clip(String(body.topic || "").replace(/[^\w\s,\-]/g, " ").replace(/\b\d+\b/g, " ").replace(/\s+/g, " ").trim(), 200);
      if (!topic) return json({ error: "no-topic" }, 400);
      const gate = await checkQuota(env, request, "general");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      let results = [];
      try { results = await pubmedGuidelines(env, researchTermFor(topic) || topic); }   // sanitized keywords so free-text and/or don't become PubMed operators
      catch (e) { try { await recordUsage(gate, { inTok: estTokens(topic.length), outTok: 0, status: "failed" }); } catch (x) {} return json({ error: "lookup-failed", source: "pubmed" }, 502); }
      await recordUsage(gate, { inTok: estTokens(topic.length), outTok: estTokens(JSON.stringify(results).length), status: "success" });
      return json({ results: results, source: "PubMed (NCBI)", query: topic, mode: "evidence" });
    }
    if (seg === "vision") {
      const kind = VISION_SYS[body.kind] ? body.kind : "monitor";
      // TEXT mode (privacy path D→B): on-device OCR text, no image ever sent. Preferred.
      const ocr = (typeof body.text === "string" ? body.text : "").slice(0, MAX_IN_CHARS).trim();
      if (ocr) {
        const gate = await checkQuota(env, request, "ocr");
        if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
        const prompt = visionTextPrompt(kind, ocr);
        let text;
        try { text = await callGemini(env, [{ text: prompt }], MAX_OUT, { model: visionModel(env) }); }
        catch (e) { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); throw e; }
        await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
        return json({ kind: kind, fields: parseJsonLoose(text) || {}, mode: "text" });
      }
      // IMAGE mode (legacy / web): unchanged.
      let b64 = String(body.image || "");
      const mime = (b64.match(/^data:([^;]+);base64,/) || [])[1] || "image/jpeg";
      b64 = b64.replace(/^data:[^;]+;base64,/, "");
      if (!b64) return json({ error: "no image or text" }, 400);
      const gate = await checkQuota(env, request, "ocr");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      let text;
      try { text = await callGemini(env, [{ text: VISION_SYS[kind] }, { inline_data: { mime_type: mime, data: b64 } }], MAX_OUT, { model: visionModel(env) }); }
      catch (e) { await recordUsage(gate, { inTok: 1000, outTok: 0, status: "failed" }); throw e; }
      // image input ≈ a fixed token block (~1.3k) + the prompt; approximate for cost metering.
      await recordUsage(gate, { inTok: 1000 + estTokens(VISION_SYS[kind].length), outTok: estTokens((text || "").length), status: "success" });
      return json({ kind: kind, fields: parseJsonLoose(text) || {}, mode: "image" });
    }
    if (seg === "research") {
      // Opt-in web research for topics NOT in StewardMD's KB, only reached on an explicit tap /
      // auto-run after the KB miss. FAST PATH: TinyFish (the search API we already use in the
      // Medical-Updates pipeline) does the search in ONE round-trip, then a cheap flash call just
      // SUMMARISES the returned snippets — no internal Gemini google_search grounding (the slow
      // multi-hop). Lower tokens (we own the context) + real source links. FALLBACK: if TinyFish
      // returns nothing (no key / empty / error — it never throws), fall back to Gemini's own
      // grounded search so nothing regresses. Worst case === the previous behaviour.
      const q = String(body.question || body.q || "").slice(0, 500);
      if (!q) return json({ error: "no question" }, 400);
      if (firewallBlock(q)) return json({ text: null, blocked: true, outOfScope: true, sources: [], message: "MaiK answers only medical and clinical questions." }); // no web search, no Gemini

      // ── Research Mode: EVIDENCE REVIEW over trusted medical literature (NOT a general web search).
      // The source allow-list filters RETRIEVAL only (PubMed guideline/SR/meta-analysis) — it never
      // refuses the query (firewallBlock above is the ONLY scope gate, unchanged). Exactly 2/day per
      // user via the existing usage/KV machinery; a KV cache hit does NOT burn a daily slot.
      if (body.mode === "evidence-review") {
        const store = usageKv(env);
        const ERE_MAX = Math.max(256, Math.min(1800, Number(env.MAIK_EVIDENCE_MAX_OUTPUT) || 1300));
        // Recent conversation turns (client sends up to 4) so a short follow-up keeps its context.
        const history = Array.isArray(body.history) ? body.history.slice(-4) : [];
        // Retrieval topic WITH follow-up context: the question's own keywords, or — when the follow-up
        // is vague ("which is better?", "one answer") — the most recent prior turn's topic.
        const topicStr = researchTopic(q, history);
        // (1) Response cache: normalize -> sha256hex -> maik:research:v1:<hash>. HIT = free, slot-free.
        // Keyed on the question AND the resolved topic so an identical vague follow-up in a DIFFERENT
        // conversation (different prior topic) does not collide on a stale cached answer.
        const cacheKey = researchCacheKey(await sha256hex(normalizeResearchQuery(q) + "|" + normalizeResearchQuery(topicStr)));
        if (store) {
          let hit = null; try { hit = await store.get(cacheKey, "json"); } catch (e) {}
          if (hit && hit.text) {
            let used = 0, limit = 2;
            try { const mq = await checkModuleQuota(env, store, "research", usageKeyFor(await identify(request, env)), Date.now()); used = mq.used || 0; limit = mq.limit != null ? mq.limit : 2; } catch (e) {}
            return json({ text: hit.text, mode: "evidence-review", sources: hit.sources || [], cached: true, usage: { module: "research", used: used, limit: limit } });
          }
        }
        // (2) Global cost breaker / rate / token headroom (existing machinery wraps the call).
        const gate = await checkQuota(env, request, "general");
        if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
        // (3) Per-user 2/day Evidence-Review cap (counted per ATTEMPT, AFTER the cache check).
        let usedNow = 0, capNow = 2;
        if (store) {
          const who = await identify(request, env);
          const mq = await gateAndCount(env, store, "research", usageKeyFor(who), who.guest ? "guest" : "unknown", Date.now(), who.email);
          if (!mq.ok) {
            // Over-cap denial must NOT burn a general MaiK slot (no AI work done, and recordUsage's
            // general counter would decrement the shared 60/day allowance). gateAndCount already
            // recorded the research-bucket attempt.
            return json({ text: null, mode: "evidence-review", over: true, sources: [], message: "You've used your 2 evidence reviews today. Resets at midnight.", usage: { module: "research", used: mq.used != null ? mq.used : 2, limit: mq.limit != null ? mq.limit : 2 } });
          }
          usedNow = (mq.used || 0) + 1; capNow = mq.limit != null ? mq.limit : 2;
        }
        // (4) Retrieve trusted citations (PubMed guideline / systematic review / meta-analysis), then
        // synthesize with numbered [n] grounding. Zero sources -> synthesize from established medicine.
        let cites = [];
        try { cites = await pubmedGuidelines(env, topicStr, RESEARCH_PUBTYPE_FILTER); } catch (e) { cites = []; }
        // Relevance guard: never present off-topic papers as "the evidence". PubMed's automatic term
        // mapping can still surface loosely-matched reviews; drop any whose title shares no specific
        // keyword with the (context-resolved) topic, so the model synthesizes from established medicine.
        const _kw = researchKeywords(topicStr);
        cites = cites.filter(function (c) { return sourceOnTopic(c.title, _kw); });
        const sources = cites.map(function (c, i) { return { n: i + 1, title: c.title + (c.year ? " (" + c.year + ")" : ""), url: c.url, site: c.journal || "PubMed", year: c.year, pmid: c.pmid, pubtype: c.pubtype }; });
        let srcBlock = "";
        if (sources.length) srcBlock = "\n\n=== SOURCES (cite inline as [n]; use ONLY these numbers) ===\n" + sources.map(function (s) { return s.n + ". " + s.title + (s.pubtype ? " [" + s.pubtype + "]" : "") + (s.site ? " - " + s.site : ""); }).join("\n");
        let histBlock = "";
        if (history.length) histBlock = "\n\n=== RECENT CONVERSATION (context; the new question may be a short follow-up that refers to it) ===\n" + history.map(function (t) { var s = ""; if (t && t.q) s += "Clinician: " + clip(t.q, 300); if (t && t.a) s += (s ? "\n" : "") + "MaiK: " + clip(t.a, 300); return s; }).filter(Boolean).join("\n");
        const prompt = EVIDENCE_REVIEW_SYS + histBlock + "\n\n=== CLINICIAN QUESTION ===\n" + q + srcBlock;
        const inTok = estTokens(prompt.length);
        let text;
        try { text = await callGemini(env, [{ text: prompt }], ERE_MAX, { temperature: 0.2 }); }
        catch (e) { try { console.warn("[ai] evidence-review-failed", String(e && e.message || e).slice(0, 200)); } catch (_e) {} try { await recordUsage(gate, { inTok: inTok, outTok: 0, status: "failed" }); } catch (x) {} return json({ error: "research-failed", mode: "evidence-review" }, 502); }
        try { await recordUsage(gate, { inTok: inTok, outTok: estTokens((text || "").length), status: "success" }); } catch (e) {}
        // (5) Cache the synthesized answer (~7-day TTL) so a repeat is free AND slot-free.
        if (store && text) { try { await store.put(cacheKey, JSON.stringify({ text: text, sources: sources, ts: Date.now() }), { expirationTtl: 7 * 24 * 60 * 60 }); } catch (e) {} }
        return json({ text: text, mode: "evidence-review", sources: sources, cached: false, usage: { module: "research", used: usedNow, limit: capNow } });
      }

      const gate = await checkQuota(env, request, "general");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const RES_MAX = Math.max(256, Math.min(1600, Number(env.MAIK_RESEARCH_MAX_OUTPUT) || 1200));

      let results = [];
      try { results = await tinyfishSearch(env, q); } catch (e) { results = []; }

      let text = null, mode = "web", sources = [], inTok = estTokens(RESEARCH_SYS.length + q.length);
      if (results.length) {
        const ctx = results.map(function (r, i) {
          return "[" + (i + 1) + "] " + r.title + (r.site ? " (" + r.site + ")" : "") + "\n" + (r.snippet || "") + "\n" + r.url;
        }).join("\n\n");
        const prompt = RESEARCH_SYS_SNIPPETS + "\n\nQuestion: " + q + "\n\nWeb results:\n" + ctx;
        inTok = estTokens(prompt.length);
        try {
          text = await callGemini(env, [{ text: prompt }], RES_MAX, { temperature: 0.2 });
          sources = results.map(function (r) { return { title: r.title, url: r.url, site: r.site }; });
          mode = "web-tinyfish";
        } catch (e) { text = null; }   // summarise failed → fall through to Gemini grounding
      }
      if (!text) {
        inTok = estTokens(RESEARCH_SYS.length + q.length);
        try { text = await callGemini(env, [{ text: RESEARCH_SYS + "\n\nQuestion: " + q }], RES_MAX, { webSearch: true, temperature: 0.3 }); mode = "web-grounded"; }
        catch (e) { try { console.warn("[ai] research-failed", String(e && e.message || e).slice(0, 200)); } catch (_e) {} await recordUsage(gate, { inTok: inTok, outTok: 0, status: "failed" }); return json({ error: "research-failed" }, 502); }
      }
      await recordUsage(gate, { inTok: inTok, outTok: estTokens((text || "").length), status: "success" });
      return json({ text: text, mode: mode, sources: sources });
    }
    if (seg === "extract") {
      // Voice intake (MaiK Scribe): a transcript → structured ICU fields, OR (kind:"reasoning")
      // → finding keys mapped to the client-supplied catalog. Same PHI posture as /vision text.
      const transcript = String(body.transcript || "").slice(0, MAX_IN_CHARS).trim();
      if (!transcript) return json({ error: "no transcript" }, 400);
      const gate = await checkQuota(env, request, "ocr");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      if (body.kind === "reasoning") {
        const catalog = Array.isArray(body.catalog) ? body.catalog.slice(0, 500) : [];
        const prompt = reasoningExtractPrompt(transcript, catalog).slice(0, MAX_IN_CHARS + 12000);
        let text;
        try { text = await callGemini(env, [{ text: prompt }], MAX_OUT); }
        catch (e) { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); throw e; }
        await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
        const parsed = parseJsonLoose(text) || {};
        // SAFETY: only keys that actually exist in the catalog survive (no invented findings).
        const valid = {}; catalog.forEach((c) => { if (c && c.key) valid[c.key] = 1; });
        const seen = {}, findings = [];
        (Array.isArray(parsed.findings) ? parsed.findings : []).forEach((k) => { if (valid[k] && !seen[k]) { seen[k] = 1; findings.push(k); } });
        const unmatched = (Array.isArray(parsed.unmatched) ? parsed.unmatched : []).map((s) => String(s).slice(0, 80)).filter(Boolean).slice(0, 20);
        let patient;
        if (parsed.patient && typeof parsed.patient === "object") {
          const age = Number(parsed.patient.age); const sex = String(parsed.patient.sex || "").toLowerCase();
          patient = {}; if (!isNaN(age) && age > 0 && age < 130) patient.age = age; if (sex === "male" || sex === "female") patient.sex = sex;
          if (!Object.keys(patient).length) patient = undefined;
        }
        return json({ findings: findings, patient: patient, unmatched: unmatched, mode: "reasoning" });
      }
      const k = VISION_SYS[body.kind] ? body.kind : "monitor";
      const prompt = transcriptExtractPrompt(k, transcript);
      let text;
      try { text = await callGemini(env, [{ text: prompt }], MAX_OUT); }
      catch (e) { await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: 0, status: "failed" }); throw e; }
      await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
      return json({ kind: k, fields: parseJsonLoose(text) || {}, mode: "extract" });
    }
    if (seg === "transcribe") {
      // AI STT fallback (used only where neither native device STT nor Web Speech is available).
      // Audio → transcript via the same Gemini transport (audio inline_data). PHI: audio leaves the
      // device only on this path — the same posture as /vision image mode.
      let b64 = String(body.audio || "");
      const mime = (b64.match(/^data:([^;]+);base64,/) || [])[1] || "audio/webm";
      b64 = b64.replace(/^data:[^;]+;base64,/, "");
      if (!b64) return json({ error: "no audio" }, 400);
      const gate = await checkQuota(env, request, "ocr");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason, needsPro: !!gate.needsPro, message: gate.message }, gate.needsPro ? 402 : 429);
      const sys = "Transcribe this clinical dictation audio to plain text, VERBATIM. Return ONLY the transcript text — no preamble, labels, quotes, or commentary. If the audio is empty or inaudible, return an empty string.";
      let text;
      try { text = await callGemini(env, [{ text: sys }, { inline_data: { mime_type: mime, data: b64 } }], MAX_OUT); }
      catch (e) { await recordUsage(gate, { inTok: 1200, outTok: 0, status: "failed" }); throw e; }
      await recordUsage(gate, { inTok: 1200, outTok: estTokens((text || "").length), status: "success" });
      return json({ transcript: String(text || "").trim(), mode: "ai" });
    }
    return json({ error: "unknown endpoint", seg: seg }, 404);
  } catch (e) {
    try { console.warn("[ai] server error", String((e && e.message) || e).slice(0, 200)); } catch (_e) {}
    return json({ error: "server_error" }, 500);
  }
}
