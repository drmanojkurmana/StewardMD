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
const DEV_HOST = "https://generativelanguage.googleapis.com/v1beta/models";
const MODEL_DEFAULT = "gemini-2.5-flash";

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
import { checkQuota, recordUsage, adminReport, estTokens } from "../../_usage.js";
import { ownerOK } from "../../_adminauth.js";
function modelId(env) { return env.GEMINI_MODEL || MODEL_DEFAULT; }
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
    const r = await fetch(`${DEV_HOST}/${modelId(env)}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) });
    return parseCandidates(await r.json(), r.status);
  },
  // Phase 2 — SSE streaming transport (returns the raw upstream Response; caller transforms).
  streamFetch: function (env, parts, maxTokens, opts) {
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ google_search: {} }] });
    return fetch(`${DEV_HOST}/${modelId(env)}:streamGenerateContent?alt=sse&key=${env.GEMINI_API_KEY}`,
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
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelId(env)}:generateContent`;
    const token = await vertexAccessToken(env);
    let o = opts || {};
    if (o.webSearch) o = Object.assign({}, o, { tools: [{ googleSearch: {} }] });   // Vertex tool name
    const r = await fetch(url, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, o)) });
    return parseCandidates(await r.json(), r.status);
  },
  // Phase 2 — SSE streaming transport (returns the raw upstream Response; caller transforms).
  streamFetch: async function (env, parts, maxTokens, opts) {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelId(env)}:streamGenerateContent?alt=sse`;
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
  "- When it helps, end with ONE natural follow-up offer (e.g. 'Want the pregnancy-safe options or the paediatric dose?') — a single line, not a menu.\n" +
  "SAFETY & HONESTY (non-negotiable):\n" +
  "1. Answer ONLY what was asked. NEVER describe what is or is not in your knowledge base, and NEVER say things like 'the retrieved knowledge contains...' or 'no specific question was posed'.\n" +
  "2. Always finish — complete every thought and sentence; never trail off mid-answer.\n" +
  "3. DOSING: give the standard adult dose/route/titration when the clinician asks for it. Prefer the retrieved Drug Index / protocol figure when present; otherwise give the widely-accepted textbook/guideline dose from mainstream knowledge and append '(standard reference — verify locally)'. This is expected for well-established therapy — e.g. atropine in organophosphate poisoning, adrenaline in anaphylaxis, benzodiazepines in status. Do NOT deflect a standard dose to 'consult local guidelines'. Only withhold a specific number when it is genuinely non-standard, disputed, or you are unsure — then state the principle and what IS established. Never fabricate a precise figure you are not confident in, and never invent guideline numbers or citations.\n" +
  "4. This is general clinical education, not individualised patient advice. If it is clearly about one specific patient, answer the general question and add a short line suggesting StewardMD's Clinical Reasoning / Dx My Patient. Never use patient identifiers.\n" +
  "5. Do not mention the AI provider, model, retrieval, chunks, or any internal detail, and do not tack on a long disclaimer (the UI already shows one).\n" +
  "If you genuinely cannot answer reliably, say so briefly in ONE honest sentence and suggest the best next step — do not pad with unrelated content.";

// Web-research mode (opt-in, token-frugal): used ONLY when the topic is not in StewardMD's KB
// and the clinician explicitly taps "Research on the web". Gemini does the Google search +
// synthesis in one grounded call; we keep the answer short to conserve tokens.
const RESEARCH_SYS =
  "You are MaiK researching a clinical question that StewardMD's own knowledge base does not cover. Use web search to find current, authoritative medical/toxicology sources. Answer CONCISELY — 4-6 short bullet points covering the key management/answer only, no preamble, no headings. Be specific and bedside-useful (agents, doses, antidotes, monitoring). If evidence is weak or sources disagree, say so in one line. End with exactly: 'Web-sourced — not StewardMD-verified; confirm against local protocol.'";

function clip(s, n) { return String(s == null ? "" : s).slice(0, n || 240); }
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
  if (pc.cultures) L.push("Cultures: " + clip(JSON.stringify(pc.cultures), 500));
  if (pc.radiologyImpressions) L.push("Radiology impressions: " + clip(JSON.stringify(pc.radiologyImpressions), 500));
  L.push("\n=== RETRIEVED STEWARDMD KNOWLEDGE (PRIMARY SOURCE — reason from THIS) ===");
  (pkg.grounding || []).forEach((g) => {
    L.push("• " + g.name + " (" + g.diseaseId + "):");
    (g.knowledge || []).forEach((c) => L.push("   [" + c.section + "] " + clip(c.text, 300) + (c.source && c.source.ref ? " (" + c.source.ref + (c.source.page ? ", " + clip(c.source.page, 60) : "") + ")" : "")));
  });
  if ((pkg.retrieved || []).length) {
    L.push("\nAdditional retrieved chunks (query-matched):");
    pkg.retrieved.forEach((c) => L.push("   [" + c.section + "] " + c.diseaseId + ": " + clip(c.text, 240) + (c.source && c.source.ref ? " (" + c.source.ref + ")" : "")));
  }
  if (pkg.treatment) {
    const t = pkg.treatment;
    L.push("\n=== TREATMENT RESOLUTION (precedence " + (t.precedence || []).join(" ▸ ") + ") ===");
    if (t.default) L.push("Default [" + (t.default.tier || "?") + "]: " + clip(t.default.line, 200) + (t.default.drugRefs && t.default.drugRefs.length ? " — drugs: " + t.default.drugRefs.join(", ") : "") + (t.default.source ? " (" + t.default.source + ")" : ""));
    (t.alternatives || []).slice(0, 4).forEach((a) => L.push("Alt [" + (a.tier || "?") + "]: " + clip(a.line, 160) + (a.drugRefs && a.drugRefs.length ? " — " + a.drugRefs.join(", ") : "")));
    if (t.overlayApplied && t.overlay) L.push("Hospital overlay (" + t.overlay.hospitalId + ", SEPARATE — does not replace the default): " + clip(JSON.stringify(t.overlay.recommendation), 400));
  }
  const rf = pkg.refs || {};
  const refLine = [];
  if (rf.drug && rf.drug.length) refLine.push("drugs(by ref): " + rf.drug.join(", "));
  if (rf.calculators && rf.calculators.length) refLine.push("calculators: " + rf.calculators.join(", "));
  if (rf.icuProtocols && rf.icuProtocols.length) refLine.push("ICU modules: " + rf.icuProtocols.join(", "));
  if (refLine.length) { L.push("\n=== REFERENCES (by reference only) ==="); L.push(refLine.join(" | ")); }
  if (pkg.question) L.push("\n=== CLINICIAN QUESTION ===\n" + clip(pkg.question, 500));
  // Phase 2 — numbered SOURCES for per-claim citations + table formatting hint. The client builds
  // this list (identical numbering to the footer it renders) so [n] markers line up exactly.
  if (pkg.sources && pkg.sources.length) {
    L.push("\n=== SOURCES (cite the specific supporting claim inline with [n]; use ONLY these numbers, never invent one) ===");
    pkg.sources.slice(0, 12).forEach((s) => L.push((s.n || "") + ". " + clip(s.title, 120)));
    L.push("\nFORMATTING: append the matching [n] right after a statement that rests on a source above (e.g. 'first-line is X [2]'). When you compare 3+ options across the same attributes (differentials, empiric regimens, drug choices), present them as a compact GitHub-flavoured markdown table (header row + |---| separator). Do not cite what you cannot attribute to a listed source.");
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

export async function onRequest(context) {
  const { request, env, params } = context;
  // CORS preflight (native WebView streaming) — no auth; must precede authorise.
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  if (!authorise(request, env)) return json({ error: "unauthorised" }, 403);
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const enabled = aiEnabled(env);

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

  // Cost controls (server-side, env-configurable). Output is hard-capped; oversized
  // inputs are rejected before any provider call. Per-user quota metering + circuit
  // breaker are layered in a follow-up (functions/_usage.js + KV) — these caps are the
  // no-auth floor that bounds per-request cost immediately.
  // Output cap. LATENCY: the streamed answer isn't done until generation finishes, so a shorter
  // concise answer completes ~2x sooner (the #1 driver of MaiK's perceived speed). Default concise
  // = 768 (~a tight 250–400-word bedside answer); the client's "Show more" + follow-up chips + the
  // "detailed" depth cover length on demand. Override with MAIK_MAX_OUTPUT_TOKENS. Was 1400.
  const OUT_BASE = Math.max(256, Math.min(2048, Number(env.MAIK_MAX_OUTPUT_TOKENS) || 768));
  const MAX_OUT = (body && body.depth === "detailed") ? Math.min(2048, Math.round(OUT_BASE * 2)) : OUT_BASE;
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
        if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
        const grounded = renderGroundedPrompt(pkg).slice(0, MAX_IN_CHARS);
        // Phase 2 — opt-in streaming (client sends ?stream=1 + Accept: text/event-stream). If the
        // provider can't stream we fall straight through to the unchanged JSON path below, so the
        // answer never fails to arrive.
        const wantStream = (new URL(request.url).searchParams.get("stream") === "1") && (((request.headers.get("Accept")) || "").indexOf("text/event-stream") >= 0);
        if (wantStream) {
          let up = null;
          try { up = await geminiStreamUpstream(env, [{ text: sys + "\n\n" + grounded }], MAX_OUT, { temperature: hasDx ? 0.25 : 0.45 }); } catch (e) { up = null; }
          if (up) return withCors(request, streamGeminiToSSE(up, function (full) { try { recordUsage(gate, { inTok: estTokens(sys.length + grounded.length), outTok: estTokens((full || "").length), status: "success" }); } catch (e) {} }));
        }
        let text;
        try { text = await callGemini(env, [{ text: sys + "\n\n" + grounded }], MAX_OUT, { temperature: hasDx ? 0.25 : 0.45 }); }
        catch (e) { await recordUsage(gate, { inTok: estTokens(sys.length + grounded.length), outTok: 0, status: "failed" }); throw e; }
        await recordUsage(gate, { inTok: estTokens(sys.length + grounded.length), outTok: estTokens((text || "").length), status: "success" });
        const cites = [];
        (pkg.grounding || []).forEach((g) => (g.provenance || []).forEach((p) => { if (p && cites.indexOf(p) < 0) cites.push(p); }));
        return json({ text: text, mode: "grounded", citations: cites });
      }
      // Legacy fallback: plain engine summary string (backward compatible).
      const summary = String(body.summary || "").slice(0, MAX_IN_CHARS);
      if (!summary) return json({ error: "no summary" }, 400);
      const gate = await checkQuota(env, request, "case");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      const prompt = EXPLAIN_SYS + "\n\n--- ENGINE OUTPUT ---\n" + summary + (body.question ? "\n\nClinician question: " + String(body.question).slice(0, 500) : "");
      const text = await callGemini(env, [{ text: prompt }], MAX_OUT);
      await recordUsage(gate, { inTok: estTokens(prompt.length), outTok: estTokens((text || "").length), status: "success" });
      return json({ text: text, mode: "summary" });
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
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
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
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
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
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      const contact = env.NCBI_EMAIL || "contact@stewardmd.in";
      const base = "https://eutils.ncbi.nlm.nih.gov/entrez/eutils/";
      const cred = "&tool=stewardmd&email=" + encodeURIComponent(contact);
      const term = encodeURIComponent(topic + ' AND (Practice Guideline[ptyp] OR Guideline[ptyp] OR systematic review[ptyp] OR Review[ptyp]) AND English[lang] AND ("2013"[dp] : "3000"[dp])');
      let results = [];
      try {
        const es = await fetch(base + "esearch.fcgi?db=pubmed&retmode=json&retmax=6&sort=relevance" + cred + "&term=" + term, { cf: { cacheTtl: 86400 } });
        if (!es.ok) throw new Error("esearch " + es.status);
        const ej = await es.json();
        if (ej && ej.esearchresult && ej.esearchresult.ERROR) throw new Error("esearch-error");
        const ids = ((ej && ej.esearchresult && ej.esearchresult.idlist) || []).slice(0, 6);
        if (ids.length) {
          const su = await fetch(base + "esummary.fcgi?db=pubmed&retmode=json" + cred + "&id=" + ids.join(","), { cf: { cacheTtl: 86400 } });
          if (!su.ok) throw new Error("esummary " + su.status);
          const sj = await su.json();
          const r = (sj && sj.result) || {};
          results = ids.map(function (id) {
            const x = r[id]; if (!x || !x.title) return null;
            const pts = x.pubtype || [];
            return { title: String(x.title).replace(/\s+/g, " ").replace(/\.$/, "").trim(), journal: x.fulljournalname || x.source || "", year: String(x.pubdate || "").slice(0, 4), pubtype: pts.filter(function (p) { return /guideline|systematic review/i.test(p); })[0] || pts[0] || "", url: "https://pubmed.ncbi.nlm.nih.gov/" + id + "/", pmid: id };
          }).filter(Boolean);
          // esearch found matching PMIDs but esummary yielded none → a lookup FAILURE, not "none found".
          if (!results.length) throw new Error("esummary-empty");
        }
      } catch (e) { try { await recordUsage(gate, { inTok: estTokens(topic.length), outTok: 0, status: "failed" }); } catch (x) {} return json({ error: "lookup-failed", source: "pubmed" }, 502); }
      await recordUsage(gate, { inTok: estTokens(topic.length), outTok: estTokens(JSON.stringify(results).length), status: "success" });
      return json({ results: results, source: "PubMed (NCBI)", query: topic, mode: "evidence" });
    }
    if (seg === "vision") {
      const kind = VISION_SYS[body.kind] ? body.kind : "monitor";
      // TEXT mode (privacy path D→B): on-device OCR text, no image ever sent. Preferred.
      const ocr = (typeof body.text === "string" ? body.text : "").slice(0, MAX_IN_CHARS).trim();
      if (ocr) {
        const gate = await checkQuota(env, request, "ocr");
        if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
        const prompt = visionTextPrompt(kind, ocr);
        let text;
        try { text = await callGemini(env, [{ text: prompt }], MAX_OUT); }
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
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      let text;
      try { text = await callGemini(env, [{ text: VISION_SYS[kind] }, { inline_data: { mime_type: mime, data: b64 } }], MAX_OUT); }
      catch (e) { await recordUsage(gate, { inTok: 1000, outTok: 0, status: "failed" }); throw e; }
      // image input ≈ a fixed token block (~1.3k) + the prompt; approximate for cost metering.
      await recordUsage(gate, { inTok: 1000 + estTokens(VISION_SYS[kind].length), outTok: estTokens((text || "").length), status: "success" });
      return json({ kind: kind, fields: parseJsonLoose(text) || {}, mode: "image" });
    }
    if (seg === "research") {
      // Opt-in web research for topics NOT in StewardMD's KB. Token-frugal: single Google-
      // grounded Gemini call, short output cap, only reached on an explicit user tap.
      const q = String(body.question || body.q || "").slice(0, 500);
      if (!q) return json({ error: "no question" }, 400);
      const gate = await checkQuota(env, request, "general");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      const RES_MAX = Math.max(256, Math.min(900, Number(env.MAIK_RESEARCH_MAX_OUTPUT) || 600));
      let text;
      try { text = await callGemini(env, [{ text: RESEARCH_SYS + "\n\nQuestion: " + q }], RES_MAX, { webSearch: true, temperature: 0.3 }); }
      catch (e) { await recordUsage(gate, { inTok: estTokens(RESEARCH_SYS.length + q.length), outTok: 0, status: "failed" }); return json({ error: "research-failed", detail: String(e && e.message || e) }, 502); }
      await recordUsage(gate, { inTok: estTokens(RESEARCH_SYS.length + q.length), outTok: estTokens((text || "").length), status: "success" });
      return json({ text: text, mode: "web" });
    }
    if (seg === "extract") {
      // Voice intake (MaiK Scribe): a transcript → structured ICU fields, OR (kind:"reasoning")
      // → finding keys mapped to the client-supplied catalog. Same PHI posture as /vision text.
      const transcript = String(body.transcript || "").slice(0, MAX_IN_CHARS).trim();
      if (!transcript) return json({ error: "no transcript" }, 400);
      const gate = await checkQuota(env, request, "ocr");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
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
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      const sys = "Transcribe this clinical dictation audio to plain text, VERBATIM. Return ONLY the transcript text — no preamble, labels, quotes, or commentary. If the audio is empty or inaudible, return an empty string.";
      let text;
      try { text = await callGemini(env, [{ text: sys }, { inline_data: { mime_type: mime, data: b64 } }], MAX_OUT); }
      catch (e) { await recordUsage(gate, { inTok: 1200, outTok: 0, status: "failed" }); throw e; }
      await recordUsage(gate, { inTok: 1200, outTok: estTokens((text || "").length), status: "success" });
      return json({ transcript: String(text || "").trim(), mode: "ai" });
    }
    return json({ error: "unknown endpoint", seg: seg }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
