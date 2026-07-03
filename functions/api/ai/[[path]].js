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
import { checkQuota, recordUsage, adminReport, estTokens } from "../../_usage.js";
function modelId(env) { return env.GEMINI_MODEL || MODEL_DEFAULT; }
// thinkingBudget:0 disables gemini-2.5-flash's dynamic "thinking" — otherwise it silently
// consumes the maxOutputTokens budget and the visible clinician answer truncates mid-sentence.
// These are synthesis/extraction tasks (grounded in retrieved evidence) that do not need it,
// so disabling also cuts latency + cost.
function genBody(parts, maxTokens, opts) { var t = (opts && typeof opts.temperature === "number") ? opts.temperature : 0.2; return { contents: [{ role: "user", parts: parts }], generationConfig: { temperature: t, maxOutputTokens: maxTokens || 1024, thinkingConfig: { thinkingBudget: 0 } } }; }
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
    const r = await fetch(`${DEV_HOST}/${modelId(env)}:generateContent?key=${env.GEMINI_API_KEY}`,
      { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, opts)) });
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
  generate: async function (env, parts, maxTokens, opts) {
    const loc = env.GCP_LOCATION || "us-central1";
    const url = `https://${loc}-aiplatform.googleapis.com/v1/projects/${env.GCP_PROJECT}/locations/${loc}/publishers/google/models/${modelId(env)}:generateContent`;
    const token = await vertexAccessToken(env);
    const r = await fetch(url, { method: "POST", headers: { "Authorization": "Bearer " + token, "Content-Type": "application/json" }, body: JSON.stringify(genBody(parts, maxTokens, opts)) });
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
async function callGemini(env, parts, maxTokens, opts) {
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
  return L.join("\n");
}

const VISION_SYS = {
  monitor: "Read this ICU monitor photo. Return ONLY JSON: {\"hr\":num,\"sbp\":num,\"dbp\":num,\"map\":num,\"rr\":num,\"spo2\":num,\"temp\":num,\"cvp\":num,\"etco2\":num}. Omit fields you cannot read with confidence. No prose.",
  labs: "Read this laboratory report photo. Return ONLY JSON with any of: {\"na\",\"k\",\"cl\",\"hco3\",\"ca\",\"mg\",\"po4\",\"glu\",\"creat\",\"urea\",\"alb\",\"wbc\",\"hb\",\"plt\",\"inr\",\"ferritin\",\"crp\",\"bili\",\"ast\",\"alt\"} as numbers. Omit unreadable fields. No prose.",
  ventilator: "Read this ventilator screen photo. Return ONLY JSON: {\"mode\":str,\"fio2\":num,\"peep\":num,\"tv\":num,\"rr\":num,\"peak\":num,\"plateau\":num}. Omit unreadable fields. No prose.",
  flowsheet: "Read this ICU flow-sheet photo. Return ONLY JSON: {\"intake24h\":num,\"output24h\":num,\"urine24h\":num,\"drains\":num}. Omit unreadable fields. No prose.",
  abg: "Read this arterial blood gas (ABG) report photo. Return ONLY JSON with any of: {\"ph\":num,\"paco2\":num,\"pao2\":num,\"hco3\":num,\"be\":num,\"lactate\":num,\"fio2\":num}. Omit fields you cannot read with confidence. No prose.",
  // medication_list: live /api/ai/vision call is PROD-ONLY (tests mock the vision call).
  medication_list: "Read this medication image (prescription / OPD ticket / case sheet / discharge summary / medication chart / handwritten Rx). Extract ONLY prescribed medicine rows. Return ONLY JSON: {\"medications\":[{\"detected_text\":str,\"drug\":str|null,\"strength\":str,\"route\":str,\"frequency\":str,\"form\":str,\"confidence\":\"high\"|\"medium\"|\"low\"}]}. Rules: detected_text is the raw text you read for that row, preserved verbatim; set drug to the generic name ONLY if you are confident, else null. Ignore patient identifiers, demographics, vitals, diagnoses, and billing. NEVER invent drug names, doses, or frequencies — omit a field (empty string) if it is not written. Mark unclear or illegible handwriting as \"low\" confidence but still preserve its detected_text. Return only the medication list, no prose."
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

  // Admin diagnostics (aggregate usage; no PHI). Gated by UPDATES_ADMIN_TOKEN.
  if (seg === "admin") {
    const want = env.UPDATES_ADMIN_TOKEN || "";
    const url = new URL(request.url);
    const got = (request.headers.get("X-Admin-Token") || url.searchParams.get("token") || "");
    if (!want || got !== want) return json({ error: "forbidden" }, 403);
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
  // Output cap: default 1400 (a complete 250–500-word clinical answer; thinking is disabled so
  // the whole budget is the visible answer). "detailed" depth allows a fuller 700–1200-word answer.
  const OUT_BASE = Math.max(256, Math.min(2048, Number(env.MAIK_MAX_OUTPUT_TOKENS) || 1400));
  const MAX_OUT = (body && body.depth === "detailed") ? Math.min(2048, Math.round(OUT_BASE * 1.6)) : OUT_BASE;
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
    if (seg === "vision") {
      const kind = VISION_SYS[body.kind] ? body.kind : "monitor";
      let b64 = String(body.image || "");
      const mime = (b64.match(/^data:([^;]+);base64,/) || [])[1] || "image/jpeg";
      b64 = b64.replace(/^data:[^;]+;base64,/, "");
      if (!b64) return json({ error: "no image" }, 400);
      const gate = await checkQuota(env, request, "ocr");
      if (!gate.ok) return json({ error: "quota", reason: gate.reason }, 429);
      let text;
      try { text = await callGemini(env, [{ text: VISION_SYS[kind] }, { inline_data: { mime_type: mime, data: b64 } }], MAX_OUT); }
      catch (e) { await recordUsage(gate, { inTok: 1000, outTok: 0, status: "failed" }); throw e; }
      // image input ≈ a fixed token block (~1.3k) + the prompt; approximate for cost metering.
      await recordUsage(gate, { inTok: 1000 + estTokens(VISION_SYS[kind].length), outTok: estTokens((text || "").length), status: "success" });
      const fields = parseJsonLoose(text) || {};
      return json({ kind: kind, fields: fields });
    }
    return json({ error: "unknown endpoint", seg: seg }, 404);
  } catch (e) {
    return json({ error: String((e && e.message) || e) }, 500);
  }
}
