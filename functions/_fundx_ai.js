/* functions/_fundx_ai.js — FundX AI backend transport + provider abstraction.
 *
 * Server-side ONLY. Translates FundX Vision/Clinical requests to the active AI provider
 * and returns standardized JSON matching the app's Vision (RetinalFindings) and Clinical
 * (ClinicalAssessment) interfaces. The app talks only to /api/fundx/* — provider-specific
 * logic never leaves this module.
 *
 * Providers (extensible): Vertex AI (Gemini) — vision + text; Cerebras — text (clinical);
 * Developer (AI Studio) — dev fallback. Selection via env; Vertex is primary with failover.
 *
 * Vertex auth mirrors the MaiK function (functions/api/ai) — keyless Workload Identity
 * Federation (self-signed OIDC JWT → Google STS token-exchange → IAM Credentials access
 * token), using the SAME Cloudflare secrets already configured for MaiK. No API key is ever
 * exposed to the client. Kept self-contained (no cross-route import) for isolation + testing;
 * the pure helpers (validate/build/extract/normalize/select) are dependency-free + unit-tested.
 */

const MODEL_DEFAULT = "gemini-2.5-flash";
const SCHEMA_VISION = 1, SCHEMA_CLINICAL = 1;
export function modelId(env) { return (env && (env.FUNDX_MODEL || env.GEMINI_MODEL)) || MODEL_DEFAULT; }
function num(n, d) { n = +n; return Number.isFinite(n) ? n : (d || 0); }
function clamp(n, lo, hi) { n = +n; if (!Number.isFinite(n)) return lo; return n < lo ? lo : n > hi ? hi : n; }
function httpErr(status, code, detail) { const e = new Error(code + (detail ? ": " + detail : "")); e.status = status; e.code = code; e.detail = detail || null; return e; }

/* ---------- structured logging (no PHI / no secrets) ---------- */
export function logJSON(o) { try { console.log(JSON.stringify(Object.assign({ svc: "fundx" }, o))); } catch (e) {} }

/* ---------- timeout + retry ---------- */
function timeoutMs(env) { return num(env && env.FUNDX_TIMEOUT_MS, 20000); }
async function withTimeout(promiseFactory, ms) {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), ms);
  try { return await promiseFactory(ctrl.signal); }
  finally { clearTimeout(t); }
}
async function retry(fn, attempts) {
  let lastErr;
  for (let i = 0; i < attempts; i++) {
    try { return await fn(); }
    catch (e) { lastErr = e; if (i + 1 < attempts) await new Promise((r) => setTimeout(r, 250 * (i + 1))); }
  }
  throw lastErr;
}
export function failReason(e) {
  const m = String((e && e.message) || e);
  if (/\b(401|403)\b|unauth|permission|IAM|forbidden|jwt|credential|token|STS|OAuth/i.test(m)) return "auth/permission";
  if (/\b(429|402)\b|quota|rate.?limit|exhausted|RESOURCE_EXHAUSTED|payment/i.test(m)) return "quota/billing";
  if (/\b5\d\d\b|unavailable|internal|timeout|deadline|abort|network|fetch failed|ECONN|ENOTFOUND/i.test(m)) return "provider-unavailable";
  return "error";
}

// Production mode: Developer/AI-Studio is a DEV-ONLY provider and is NEVER used in production.
// Default is production; only development/preview (or explicit FUNDX_ALLOW_DEVELOPER=1) re-enable it.
export function isProduction(env) {
  if (env && env.FUNDX_ALLOW_DEVELOPER === "1") return false;
  const e = String((env && (env.FUNDX_ENV || env.ENVIRONMENT || env.NODE_ENV)) || "production").toLowerCase();
  return e !== "development" && e !== "dev" && e !== "preview" && e !== "test";
}

/* ---------- Vertex OAuth (keyless WIF; mirrors MaiK, same secrets) ---------- */
function b64url(buf) { let s = ""; const u = new Uint8Array(buf); for (let i = 0; i < u.length; i++) s += String.fromCharCode(u[i]); return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, ""); }
function b64urlStr(str) { return b64url(new TextEncoder().encode(str)); }
function pemToDer(pem) { const b = String(pem).replace(/-----[^-]+-----/g, "").replace(/\s+/g, ""); const bin = atob(b); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
async function rsSign(pkcs8Pem, headerObj, claimsObj) {
  const key = await crypto.subtle.importKey("pkcs8", pemToDer(pkcs8Pem), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
  const signingInput = b64urlStr(JSON.stringify(headerObj)) + "." + b64urlStr(JSON.stringify(claimsObj));
  const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
  return signingInput + "." + b64url(sig);
}
async function wifAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const oidc = await rsSign(env.GCP_WIF_PRIVATE_KEY, { alg: "RS256", typ: "JWT", kid: env.GCP_WIF_KID || undefined },
    { iss: env.GCP_WIF_ISSUER || "https://stewardmd.in", sub: env.GCP_WIF_SUBJECT || "maik-worker", aud: env.GCP_WIF_AUDIENCE, iat: now, exp: now + 3600 });
  const sts = await (await fetch("https://sts.googleapis.com/v1/token", { method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ grantType: "urn:ietf:params:oauth:grant-type:token-exchange", audience: env.GCP_WIF_AUDIENCE, scope: "https://www.googleapis.com/auth/cloud-platform", requestedTokenType: "urn:ietf:params:oauth:token-type:access_token", subjectToken: oidc, subjectTokenType: "urn:ietf:params:oauth:token-type:jwt" }) })).json();
  if (!sts.access_token) throw new Error("STS exchange failed: " + (sts.error_description || sts.error || "unknown"));
  const ic = await (await fetch(`https://iamcredentials.googleapis.com/v1/projects/-/serviceAccounts/${encodeURIComponent(env.GCP_SA_EMAIL)}:generateAccessToken`,
    { method: "POST", headers: { "Authorization": "Bearer " + sts.access_token, "Content-Type": "application/json" }, body: JSON.stringify({ scope: ["https://www.googleapis.com/auth/cloud-platform"] }) })).json();
  if (!ic.accessToken) throw new Error("IAM generateAccessToken failed: " + (ic.error && ic.error.message || "unknown"));
  return { value: ic.accessToken, exp: now + 3300 };
}
async function saJwtAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  const jwt = await rsSign(env.GCP_SA_PRIVATE_KEY, { alg: "RS256", typ: "JWT" },
    { iss: env.GCP_SA_EMAIL, sub: env.GCP_SA_EMAIL, aud: "https://oauth2.googleapis.com/token", scope: "https://www.googleapis.com/auth/cloud-platform", iat: now, exp: now + 3600 });
  const j = await (await fetch("https://oauth2.googleapis.com/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: "grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=" + jwt })).json();
  if (!j.access_token) throw new Error("SA-JWT exchange failed");
  return { value: j.access_token, exp: now + (j.expires_in || 3600) };
}
let _vTok = null;
async function vertexAccessToken(env) {
  const now = Math.floor(Date.now() / 1000);
  if (_vTok && _vTok.exp - 60 > now) return _vTok.value;
  _vTok = env.GCP_WIF_PRIVATE_KEY ? await wifAccessToken(env) : await saJwtAccessToken(env);
  return _vTok.value;
}

/* ---------- provider registry ---------- */
// dataURL → { mimeType, data(base64) }
function splitDataUrl(u) { u = String(u || ""); const m = u.match(/^data:([^;]+);base64,(.*)$/); return m ? { mimeType: m[1], data: m[2] } : { mimeType: "image/jpeg", data: u.replace(/^data:[^,]*,/, "") }; }
function geminiParts(req) {
  const parts = [{ text: req.system + "\n\n" + req.user }];
  if (req.imageDataUrl) { const im = splitDataUrl(req.imageDataUrl); parts.push({ inlineData: { mimeType: im.mimeType, data: im.data } }); }
  return parts;
}
// Safety settings — medical retinal images/text must NOT be over-blocked. Threshold is
// env-configurable (FUNDX_SAFETY, default BLOCK_ONLY_HIGH). Never "OFF" silently.
function safetySettings(env) {
  const thr = (env && env.FUNDX_SAFETY) || "BLOCK_ONLY_HIGH";
  return ["HARM_CATEGORY_HARASSMENT", "HARM_CATEGORY_HATE_SPEECH", "HARM_CATEGORY_SEXUALLY_EXPLICIT", "HARM_CATEGORY_DANGEROUS_CONTENT"]
    .map((c) => ({ category: c, threshold: thr }));
}
function geminiBody(parts, maxTokens, env) {
  return {
    contents: [{ role: "user", parts }],
    safetySettings: safetySettings(env),
    generationConfig: { temperature: 0.1, maxOutputTokens: maxTokens || 1024, responseMimeType: "application/json", thinkingConfig: { thinkingBudget: 0 } }
  };
}

// ---- token + cost estimation (per-provider accounting) -----------------
// Estimates only (no exact token API); USD per 1M tokens, env-overridable. Image is
// approximated at ~1000 tokens for Gemini multimodal.
const PRICES = { vertex: { in: 0.30, out: 2.50 }, developer: { in: 0.10, out: 0.40 }, cerebras: { in: 0.60, out: 0.60 } };
export function estTokens(s) { return Math.max(1, Math.ceil((s ? String(s).length : 0) / 4)); }
export function estCostUsd(provider, inTok, outTok, env) {
  let p = PRICES[provider] || PRICES.vertex;
  try { if (env && env.FUNDX_PRICES) { const o = JSON.parse(env.FUNDX_PRICES); if (o[provider]) p = o[provider]; } } catch (e) {}
  return +((inTok / 1e6) * p.in + (outTok / 1e6) * p.out).toFixed(6);
}
function computeMeta(env, provider, req, text, latencyMs) {
  const inTok = estTokens((req.system || "") + (req.user || "")) + (req.imageDataUrl ? 1000 : 0);
  const outTok = estTokens(text || "");
  return { provider: provider, latencyMs: latencyMs, inTok: inTok, outTok: outTok, costUsd: estCostUsd(provider, inTok, outTok, env) };
}
function geminiText(data) { const c = data && data.candidates && data.candidates[0]; return (c && c.content && c.content.parts) ? c.content.parts.map((p) => p.text || "").join("") : ""; }

const vertexProvider = {
  name: "vertex", modalities: ["vision", "text"],
  available: (env) => !!(env && env.GCP_PROJECT && env.GCP_SA_EMAIL && ((env.GCP_WIF_PRIVATE_KEY && env.GCP_WIF_AUDIENCE) || env.GCP_SA_PRIVATE_KEY)),
  generate: async (env, req, opts) => {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelId(env)}:generateContent`;
    const token = await vertexAccessToken(env);
    return withTimeout(async (signal) => {
      const r = await fetch(url, { method: "POST", signal, headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(geminiBody(geminiParts(req), opts && opts.maxTokens, env)) });
      if (!r.ok) throw new Error("vertex HTTP " + r.status);
      return geminiText(await r.json());
    }, timeoutMs(env));
  }
};
const developerProvider = {
  name: "developer", modalities: ["vision", "text"],
  // DEV-ONLY: unavailable in production regardless of key presence.
  available: (env) => !!(env && env.GEMINI_API_KEY) && !isProduction(env),
  generate: async (env, req, opts) => {
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelId(env)}:generateContent?key=${env.GEMINI_API_KEY}`;
    return withTimeout(async (signal) => {
      const r = await fetch(url, { method: "POST", signal, headers: { "Content-Type": "application/json" }, body: JSON.stringify(geminiBody(geminiParts(req), opts && opts.maxTokens, env)) });
      if (!r.ok) throw new Error("developer HTTP " + r.status);
      return geminiText(await r.json());
    }, timeoutMs(env));
  }
};
const cerebrasProvider = {
  name: "cerebras", modalities: ["text"],
  available: (env) => !!(env && env.CEREBRAS_API_KEY),
  generate: async (env, req, opts) => {
    if (req.imageDataUrl) throw new Error("cerebras has no vision modality");
    const url = (env.CEREBRAS_BASE || "https://api.cerebras.ai/v1") + "/chat/completions";
    return withTimeout(async (signal) => {
      const r = await fetch(url, { method: "POST", signal, headers: { "Authorization": "Bearer " + env.CEREBRAS_API_KEY, "Content-Type": "application/json" },
        body: JSON.stringify({ model: env.CEREBRAS_MODEL || "llama-3.3-70b", temperature: 0.1, max_tokens: (opts && opts.maxTokens) || 1024, response_format: { type: "json_object" }, messages: [{ role: "system", content: req.system }, { role: "user", content: req.user }] }) });
      if (!r.ok) throw new Error("cerebras HTTP " + r.status);
      const j = await r.json();
      return (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || "";
    }, timeoutMs(env));
  }
};
export const PROVIDERS = { vertex: vertexProvider, developer: developerProvider, cerebras: cerebrasProvider };

// Selection: Vertex primary → developer failover (vision); clinical honours FUNDX_CLINICAL_PROVIDER.
// Priority: Vertex (primary) → Developer (DEV-ONLY, filtered in production) → Cerebras
// (LAST production fallback; clinical only — Cerebras has no vision modality).
function dropDevInProd(order, env) { return isProduction(env) ? order.filter((p) => p !== "developer") : order; }
export function visionOrder(env) {
  const p = String((env && env.FUNDX_VISION_PROVIDER) || (env && env.FUNDX_AI_PROVIDER) || "vertex").toLowerCase();
  if (p === "developer" && !isProduction(env)) return ["developer"];
  return dropDevInProd(["vertex", "developer"], env);          // prod → ["vertex"]
}
export function clinicalOrder(env) {
  const p = String((env && env.FUNDX_CLINICAL_PROVIDER) || (env && env.FUNDX_AI_PROVIDER) || "vertex").toLowerCase();
  if (p === "cerebras") return dropDevInProd(["cerebras", "vertex", "developer"], env);   // explicit manual override
  if (p === "developer" && !isProduction(env)) return ["developer"];
  return dropDevInProd(["vertex", "developer", "cerebras"], env);   // prod → ["vertex","cerebras"] (Cerebras LAST)
}

/* ---------- pure helpers (validation / prompts / extraction / normalization) ---------- */
export function validateVisionBody(body) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: ["body"] };
  if (!body.image || typeof body.image !== "string") errors.push("image");
  else if (body.image.length > 12 * 1024 * 1024) errors.push("image_too_large");
  else if (!/^data:image\/(png|jpe?g|webp);base64,/.test(body.image) && !/^[A-Za-z0-9+/=]+$/.test(body.image.slice(0, 64))) errors.push("image_format");
  return { ok: errors.length === 0, errors };
}
export function validateClinicalBody(body) {
  const errors = [];
  if (!body || typeof body !== "object") return { ok: false, errors: ["body"] };
  if (!body.findings || typeof body.findings !== "object") errors.push("findings");
  return { ok: errors.length === 0, errors };
}

const VISION_SYS =
  "You are a retinal fundus IMAGE-ANALYSIS model inside a clinical tool. You DETECT and MEASURE only — you NEVER diagnose, never name a disease, and never recommend treatment. " +
  "Analyse the fundus image and return ONLY a single JSON object, no prose, with EXACTLY these keys: " +
  "quality (integer 0-100), retina_visible (boolean), optic_disc {visible:boolean, cup_disc_ratio:number 0-1, edema:boolean, pallor:boolean}, macula {visible:boolean, edema:boolean}, " +
  "vessels {arteriovenous_ratio:number, tortuosity:\"normal\"|\"mild\"|\"moderate\"|\"severe\"}, microaneurysms (integer), hemorrhages (integer), hard_exudates (integer), cotton_wool_spots (integer), drusen (integer), " +
  "neovascularization (boolean), field_of_view (\"posterior_pole\"|\"wide\"|\"partial\"), confidence (number 0-1). " +
  "If the image is not a gradeable fundus image, set retina_visible=false, quality low, and confidence low. Output MUST be valid JSON only.";
export function buildVisionRequest(body) {
  const ctx = body.ctx || {};
  const hints = [];
  if (ctx.eye) hints.push("Eye: " + ctx.eye);
  if (body.metrics && body.metrics.focus != null) hints.push("On-device quality hints: " + JSON.stringify(body.metrics));
  return { system: VISION_SYS, user: "Analyse this retinal image and return the findings JSON." + (hints.length ? "\n" + hints.join("\n") : ""), imageDataUrl: body.image.indexOf("data:") === 0 ? body.image : ("data:image/jpeg;base64," + body.image) };
}

const CLINICAL_SYS =
  "You are an ADVISORY clinical decision-support assistant. You are given structured retinal findings (JSON) plus patient context. Reason ONLY from the provided data — never invent findings, never state a definitive diagnosis. Output is advisory and must be reviewed by a clinician. " +
  "Return ONLY a single JSON object with EXACTLY these keys: severity (\"none\"|\"mild\"|\"moderate\"|\"severe\"), urgency (\"routine\"|\"soon\"|\"urgent\"|\"emergency\"), " +
  "label (short string), considerations (array of {key,label,likelihood,severity,evidence:array}), referral ({to,priority,reason}|null), followUp ({interval,reason}), investigations (array of strings), " +
  "safetyFlags (array of strings), missingData (array of strings), confidence (number 0-1), evidence (array of strings). " +
  "Escalate urgency for sight-threatening or emergency features (disc oedema, proliferative disease, macular oedema, artery/vein occlusion). Lower confidence when image quality or data is poor. Output MUST be valid JSON only.";
export function buildClinicalRequest(body) {
  const patient = body.patient || {};
  const findings = body.findings || {};
  return { system: CLINICAL_SYS, user: "RETINAL FINDINGS:\n" + JSON.stringify(findings) + "\n\nPATIENT CONTEXT:\n" + JSON.stringify(patient) + "\n\nReturn the ClinicalAssessment JSON." };
}

// Extract a JSON object from model text (strips code fences / leading prose).
export function extractJSON(text) {
  if (!text) return null;
  let s = String(text).trim().replace(/^```(?:json)?/i, "").replace(/```$/, "").trim();
  try { return JSON.parse(s); } catch (e) {}
  const i = s.indexOf("{"), j = s.lastIndexOf("}");
  if (i >= 0 && j > i) { try { return JSON.parse(s.slice(i, j + 1)); } catch (e) {} }
  return null;
}

export function normalizeFindings(obj, info) {
  obj = obj || {}; const od = obj.optic_disc || {}, mac = obj.macula || {}, ves = obj.vessels || {};
  return {
    schemaVersion: SCHEMA_VISION,
    quality: clamp(Math.round(num(obj.quality, 0)), 0, 100),
    retina_visible: !!obj.retina_visible,
    optic_disc: { visible: !!od.visible, cup_disc_ratio: clamp(num(od.cup_disc_ratio, 0), 0, 1), edema: !!od.edema, pallor: !!od.pallor },
    macula: { visible: !!mac.visible, edema: !!mac.edema },
    vessels: { arteriovenous_ratio: clamp(num(ves.arteriovenous_ratio, 0), 0, 3), tortuosity: ["normal", "mild", "moderate", "severe"].indexOf(ves.tortuosity) >= 0 ? ves.tortuosity : "normal" },
    microaneurysms: Math.max(0, Math.round(num(obj.microaneurysms, 0))),
    hemorrhages: Math.max(0, Math.round(num(obj.hemorrhages, 0))),
    hard_exudates: Math.max(0, Math.round(num(obj.hard_exudates, 0))),
    cotton_wool_spots: Math.max(0, Math.round(num(obj.cotton_wool_spots, 0))),
    drusen: Math.max(0, Math.round(num(obj.drusen, 0))),
    neovascularization: !!obj.neovascularization,
    field_of_view: ["posterior_pole", "wide", "partial"].indexOf(obj.field_of_view) >= 0 ? obj.field_of_view : "posterior_pole",
    confidence: clamp(num(obj.confidence, 0.7), 0, 1),
    provider: (info && info.provider) || "unknown",
    model_version: (info && info.model) || "unknown",
    is_mock: false,
    disclaimer: "AI detection result. Not a diagnosis. Requires clinician review."
  };
}
const SEV = ["none", "mild", "moderate", "severe"], URG = ["routine", "soon", "urgent", "emergency"];
export function normalizeAssessment(obj, info) {
  obj = obj || {};
  const arr = (x) => Array.isArray(x) ? x : [];
  return {
    schemaVersion: SCHEMA_CLINICAL, engine: "clinical", engineVersion: "backend-1", advisory: true,
    provider: (info && info.provider) || "unknown", modelVersion: (info && info.model) || "unknown",
    primaryConsideration: obj.primaryConsideration || (arr(obj.considerations)[0] && arr(obj.considerations)[0].key) || "none",
    label: typeof obj.label === "string" ? obj.label : "Advisory assessment",
    considerations: arr(obj.considerations),
    severity: SEV.indexOf(obj.severity) >= 0 ? obj.severity : "none",
    urgency: URG.indexOf(obj.urgency) >= 0 ? obj.urgency : "routine",
    referral: (obj.referral && typeof obj.referral === "object") ? obj.referral : null,
    followUp: (obj.followUp && typeof obj.followUp === "object") ? obj.followUp : { interval: "12 months", reason: "default" },
    investigations: arr(obj.investigations), safetyFlags: arr(obj.safetyFlags), missingData: arr(obj.missingData),
    confidence: clamp(num(obj.confidence, 0.5), 0, 1), evidence: arr(obj.evidence),
    disclaimer: "Advisory clinical decision support. Not a diagnosis. A qualified clinician must review all recommendations."
  };
}

/* ---------- orchestration ---------- */
async function runTask(env, order, req, kind, deps) {
  const providers = (deps && deps.providers) || PROVIDERS;
  const ord = (deps && deps.order) || order;
  const sink = (deps && deps.onMetrics) || null;
  function metric(m) { const o = Object.assign({ task: kind }, m); logJSON(o); if (sink) { try { sink(o); } catch (e) {} } }
  let lastErr = null;
  for (const name of ord) {
    const p = providers[name];
    if (!p || !p.available(env)) { lastErr = lastErr || httpErr(503, "no_provider", name + " unavailable"); continue; }
    if (kind === "vision" && p.modalities && p.modalities.indexOf("vision") < 0) continue;
    const attempts = (name === "vertex" || name === "cerebras") ? 2 : 1;   // retry-once before failover
    const t0 = Date.now();
    try {
      const text = await retry(() => p.generate(env, req, { maxTokens: kind === "vision" ? 1024 : 1200 }), attempts);
      const meta = computeMeta(env, name, req, text, Date.now() - t0);
      const obj = extractJSON(text);
      if (!obj) { lastErr = httpErr(502, "bad_provider_response", name + " returned non-JSON"); metric(Object.assign({ provider: name, status: "non_json" }, meta)); continue; }
      metric(Object.assign({ provider: name, status: "ok" }, meta));
      return { obj, provider: name, meta: meta };
    } catch (e) { lastErr = e; metric({ provider: name, status: "error", reason: failReason(e), latencyMs: Date.now() - t0 }); }
  }
  throw (lastErr && lastErr.status) ? lastErr : httpErr(503, "no_" + kind + "_provider", lastErr ? failReason(lastErr) : "no provider configured");
}

// ---- provider router: primary → secondary → base-order fallback ---------
// Manual override via FUNDX_PRIMARY / FUNDX_SECONDARY; else the task default order.
// runTask already skips unavailable providers (health-based) + wrong-modality providers.
export function routeOrder(env, task) {
  const base = task === "vision" ? visionOrder(env) : clinicalOrder(env);
  const primary = env && env.FUNDX_PRIMARY ? String(env.FUNDX_PRIMARY).toLowerCase() : null;
  if (!primary) return base;
  const secondary = env && env.FUNDX_SECONDARY ? String(env.FUNDX_SECONDARY).toLowerCase() : null;
  const order = [primary];
  if (secondary && secondary !== primary) order.push(secondary);
  base.forEach((p) => { if (order.indexOf(p) < 0) order.push(p); });
  return isProduction(env) ? order.filter((p) => p !== "developer") : order;   // never developer in prod
}

// Capability discovery — every provider's declared interface.
export function capabilities(env) {
  return Object.keys(PROVIDERS).map((k) => ({
    name: k, modalities: PROVIDERS[k].modalities,
    streaming: false,          // FundX endpoints return a single structured-JSON object (no stream)
    structuredJson: true, imageInput: PROVIDERS[k].modalities.indexOf("vision") >= 0,
    available: !!PROVIDERS[k].available(env)
  }));
}
export async function runVision(env, body, deps) {
  const v = validateVisionBody(body); if (!v.ok) throw httpErr(400, "invalid_request", v.errors.join(","));
  const { obj, provider } = await runTask(env, routeOrder(env, "vision"), buildVisionRequest(body), "vision", deps);
  return normalizeFindings(obj, { provider, model: modelId(env) });
}
export async function runClinical(env, body, deps) {
  const v = validateClinicalBody(body); if (!v.ok) throw httpErr(400, "invalid_request", v.errors.join(","));
  const { obj, provider } = await runTask(env, routeOrder(env, "clinical"), buildClinicalRequest(body), "clinical", deps);
  return normalizeAssessment(obj, { provider, model: modelId(env) });
}
export function health(env) {
  return {
    ok: true, service: "fundx", schema: { vision: SCHEMA_VISION, clinical: SCHEMA_CLINICAL }, model: modelId(env),
    production: isProduction(env),
    providers: capabilities(env),
    routing: { vision: routeOrder(env, "vision"), clinical: routeOrder(env, "clinical"), primary: (env && env.FUNDX_PRIMARY) || null, secondary: (env && env.FUNDX_SECONDARY) || null },
    config: { timeoutMs: timeoutMs(env), safety: (env && env.FUNDX_SAFETY) || "BLOCK_ONLY_HIGH" }
  };
}
export { httpErr };
