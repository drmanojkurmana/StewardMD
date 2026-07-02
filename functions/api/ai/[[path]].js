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
  // which browsers send without an Origin header.
  const o = request.headers.get("Origin") || "";
  return o === "https://stewardmd.in" || o === "https://www.stewardmd.in" || o === "";
}
const json = (obj, status = 200) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", "Cache-Control": "no-store" } });

/* ===================================================================
 * AI TRANSPORT — provider abstraction (this is the ONLY layer that changed).
 * Prompt construction, RAG grounding, /vision, and response parsing are
 * UNCHANGED. Providers share the Gemini generateContent request/response
 * schema, so swapping transport needs no change to callers.
 *   AIProvider = { name, available(env), generate(env, parts, maxTokens) -> text }
 * Selection via env.AI_PROVIDER; Vertex is primary and fails over to the
 * Developer API. Future slots (openrouter/groq/openai/azure) drop into PROVIDERS.
 * =================================================================== */
function modelId(env) { return env.GEMINI_MODEL || MODEL_DEFAULT; }
function genBody(parts, maxTokens) { return { contents: [{ role: "user", parts: parts }], generationConfig: { temperature: 0.2, maxOutputTokens: maxTokens || 1024 } }; }
function parseCandidates(data, status) {
  if (status >= 400 || !data || data.error) throw new Error("AI HTTP " + status + ((data && data.error && data.error.message) ? ": " + data.error.message : ""));
  const cand = data.candidates && data.candidates[0];
  return (cand && cand.content && cand.content.parts) ? cand.content.parts.map(function (p) { return p.text || ""; }).join("") : "";
}

/* ---- Developer API (AI Studio) — FALLBACK ---- */
const developerProvider = {
  name: "developer",
  available: function (env) { return !!env.GEMINI_API_KEY; },
  generate: async function (env, parts, maxTokens) {
    const r = await fetch(`${DEV_HOST}/${modelId(env)}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens)) });
    return parseCandidates(await r.json(), r.status);
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
  generate: async function (env, parts, maxTokens) {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelId(env)}:generateContent`;
    const token = await vertexAccessToken(env);
    const r = await fetch(url, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens)) });
    return parseCandidates(await r.json(), r.status);
  }
};

const PROVIDERS = { vertex: vertexProvider, developer: developerProvider };
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
async function callGemini(env, parts, maxTokens) {
  const order = providerOrder(env);
  let lastErr = null;
  for (let i = 0; i < order.length; i++) {
    const name = order[i], p = PROVIDERS[name];
    if (!p || !p.available(env)) { lastErr = new Error(name + " provider unavailable"); continue; }
    const attempts = name === "vertex" ? 2 : 1;   // retry Vertex ONCE before switching
    for (let a = 0; a < attempts; a++) {
      try { return await p.generate(env, parts, maxTokens); }
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
  "Keep each section to 1–4 short bullets. Cite the provided sources inline (e.g. 'Harrison 22e' or the treatment tier). Reference drugs by name/class only — NO specific doses beyond what the provided treatment resolution states. Never use patient identifiers. " +
  "End with exactly: 'Decision-support only — the StewardMD rule engine owns the diagnosis; verify clinically.'";

// General-knowledge system prompt (gold122): used when NO deterministic diagnosis
// has been computed (empty differential) — the clinician is asking a general named-
// topic question, not seeking individualized management. Educational reference,
// grounded in the retrieved KB, with a clean clinical structure. No provider/model
// names; no long trailing disclaimer (the UI shows a persistent advisory badge).
const KNOWLEDGE_SYS =
  "You are MaiK (Medical AI Knowledge), StewardMD's clinician knowledge assistant. Answer the clinician's GENERAL CLINICAL KNOWLEDGE question as a concise EDUCATIONAL reference for a qualified doctor. " +
  "Reason PRIMARILY from the RETRIEVED STEWARDMD KNOWLEDGE below (Harrison-derived + StewardMD management protocols, source-cited); your own medical knowledge is SECONDARY and used only to connect the provided material. If the retrieved knowledge does not cover the question, say so briefly rather than inventing specifics. " +
  "This is NOT individualized patient advice — do not tailor to a specific patient. If the question is clearly about a specific patient, briefly advise using StewardMD's Clinical Reasoning / Dx My Patient so the engine computes the assessment first. " +
  "Reply as short Markdown under EXACTLY these headings, omitting any with nothing evidence-based to add:\n" +
  "### Clinical take\n### Key supporting points\n### What to check next\n### Management considerations\n### Red flags\n" +
  "Keep each section to 1–4 short bullets. Reference drugs by name/class and standard principles only — no specific doses beyond what the retrieved knowledge states; never use patient identifiers. Do NOT mention the AI provider, model, or any internal implementation detail. Do NOT append a long disclaimer — the interface already shows a persistent advisory note.";

function clip(s, n) { return String(s == null ? "" : s).slice(0, n || 240); }
function renderGroundedPrompt(pkg) {
  const L = [];
  const r = pkg.reasoning || {}, pc = pkg.patientCase || {};
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
  return L.join("\n");
}

const VISION_SYS = {
  monitor: "Read this ICU monitor photo. Return ONLY JSON: {\"hr\":num,\"sbp\":num,\"dbp\":num,\"map\":num,\"rr\":num,\"spo2\":num,\"temp\":num,\"cvp\":num,\"etco2\":num}. Omit fields you cannot read with confidence. No prose.",
  labs: "Read this laboratory report photo. Return ONLY JSON with any of: {\"na\",\"k\",\"cl\",\"hco3\",\"ca\",\"mg\",\"po4\",\"glu\",\"creat\",\"urea\",\"alb\",\"wbc\",\"hb\",\"plt\",\"inr\",\"ferritin\",\"crp\",\"bili\",\"ast\",\"alt\"} as numbers. Omit unreadable fields. No prose.",
  ventilator: "Read this ventilator screen photo. Return ONLY JSON: {\"mode\":str,\"fio2\":num,\"peep\":num,\"tv\":num,\"rr\":num,\"peak\":num,\"plateau\":num}. Omit unreadable fields. No prose.",
  flowsheet: "Read this ICU flow-sheet photo. Return ONLY JSON: {\"intake24h\":num,\"output24h\":num,\"urine24h\":num,\"drains\":num}. Omit unreadable fields. No prose.",
  abg: "Read this arterial blood gas (ABG) report photo. Return ONLY JSON with any of: {\"ph\":num,\"paco2\":num,\"pao2\":num,\"hco3\":num,\"be\":num,\"lactate\":num,\"fio2\":num}. Omit fields you cannot read with confidence. No prose."
};

function parseJsonLoose(t) {
  if (!t) return null;
  var m = t.match(/\{[\s\S]*\}/);
  if (!m) return null;
  try { return JSON.parse(m[0]); } catch (e) { return null; }
}

export async function onRequest(context) {
  const { request, env, params } = context;
  if (!authorise(request, env)) return json({ error: "unauthorised" }, 403);
  const seg = Array.isArray(params.path) ? params.path.join("/") : (params.path || "");
  const enabled = aiEnabled(env);

  if (seg === "status") return json({ enabled: enabled, provider: providerOrder(env)[0], vertex: PROVIDERS.vertex.available(env), developer: PROVIDERS.developer.available(env), model: modelId(env) });

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
        const grounded = renderGroundedPrompt(pkg).slice(0, 24000);
        const text = await callGemini(env, [{ text: sys + "\n\n" + grounded }], 1536);
        const cites = [];
        (pkg.grounding || []).forEach((g) => (g.provenance || []).forEach((p) => { if (p && cites.indexOf(p) < 0) cites.push(p); }));
        return json({ text: text, mode: "grounded", citations: cites });
      }
      // Legacy fallback: plain engine summary string (backward compatible).
      const summary = String(body.summary || "").slice(0, 6000);
      if (!summary) return json({ error: "no summary" }, 400);
      const text = await callGemini(env, [{ text: EXPLAIN_SYS + "\n\n--- ENGINE OUTPUT ---\n" + summary + (body.question ? "\n\nClinician question: " + String(body.question).slice(0, 500) : "") }]);
      return json({ text: text, mode: "summary" });
    }
    if (seg === "vision") {
      const kind = VISION_SYS[body.kind] ? body.kind : "monitor";
      let b64 = String(body.image || "");
      const mime = (b64.match(/^data:([^;]+);base64,/) || [])[1] || "image/jpeg";
      b64 = b64.replace(/^data:[^;]+;base64,/, "");
      if (!b64) return json({ error: "no image" }, 400);
      const text = await callGemini(env, [{ text: VISION_SYS[kind] }, { inline_data: { mime_type: mime, data: b64 } }]);
      const fields = parseJsonLoose(text) || {};
      return json({ kind: kind, fields: fields });
    }
    return json({ error: "unknown endpoint", seg: seg }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
