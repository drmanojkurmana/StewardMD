/* functions/api/thorex/[[path]].js — ThoreX AI "explain & correlate" server proxy.
 *
 * Server-side ONLY layer that turns de-identified TEXT (finding labels/bands/severity/relevance,
 * and any explicitly-passed de-identified clinical values) into a short clinical-education
 * explanation. NEVER receives or forwards an image, and NEVER a patient identifier — the client
 * (thorex-llm.js) is responsible for that guarantee; this route additionally never logs bodies.
 *
 * Routes:
 *   POST /api/thorex/llm  body: { kind: "learn"|"impression"|"correlate", finding?, findings?, context? }
 *                          -> { ok, provider: "groq"|"gemini"|"offline", text }
 *
 * Auth: a valid Firebase ID token is REQUIRED (Authorization: Bearer <idToken>) — 401 otherwise.
 * Same server-derived-identity posture as functions/api/experimental (callerUid), never a
 * client-supplied id. Rate-limited modestly per uid via the existing MAIK_KV/CASES_KV store
 * (fail-open if no KV bound, mirroring _usage.js / experimental's rateLimit).
 *
 * Provider routing: Groq (GROQ_API_KEY, OpenAI-compatible chat completions) is tried FIRST for
 * latency/cost; on failure or absence it falls back to the EXISTING project Google/Gemini
 * transport (callGemini from functions/api/ai/[[path]].js — Vertex primary -> AI-Studio
 * developer fallback, unchanged). If neither is available/succeeds, responds
 * { ok:true, provider:"offline", text:null } so the client's deterministic fallback renders —
 * ThoreX must always show something useful, online or not.
 *
 * This file is purely additive: it does not modify /api/ai/*, /api/fundx/*, or any other
 * existing AI endpoint.
 */
import { callGemini } from "../ai/[[path]].js";
import { verifyFirebaseToken } from "../../_fbauth.js";
import { usageKv, estTokens, meterTokens } from "../../_usage.js";
import { aiBudgetOn, monthlyCapFor } from "../../_aibudget.js";
import { proFromRequest } from "../../_entitlement.js";

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || "";
  const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) {
  return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) });
}

// Server-derived identity ONLY — mirrors functions/api/experimental/[[path]].js's callerUid.
// Never trusts a client-supplied user id.
async function callerUid(request, env) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try { return await verifyFirebaseToken(tok, env); } catch (e) { return null; }
}

// Modest per-uid rate limit: min 2s between calls, daily cap. Fail-open (no KV bound -> allow),
// same posture as _usage.js / experimental's rateLimit — this is defence-in-depth, not the primary
// abuse control (auth + a real Firebase account already bound most abuse).
async function rateLimit(env, uid) {
  const store = usageKv(env);
  if (!store) return { ok: true };
  const nowS = Math.floor(Date.now() / 1000);
  try {
    const minKey = "tx:llm:rate:" + uid;
    const last = await store.get(minKey);
    if (last && (nowS - Number(last)) < 2) return { ok: false, status: 429 };
    await store.put(minKey, String(nowS), { expirationTtl: 60 });
    const day = new Date(nowS * 1000).toISOString().slice(0, 10);
    const capKey = "tx:llm:count:" + uid + ":" + day;
    const cur = Number(await store.get(capKey)) || 0;
    const cap = Number(env.THOREX_LLM_DAILY_CAP) || 120;
    if (cur >= cap) return { ok: false, status: 429 };
    await store.put(capKey, String(cur + 1), { expirationTtl: 90000 });
  } catch (e) { /* fail-open */ }
  return { ok: true };
}

async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }

/* ---- de-identified prompt construction — TEXT ONLY (labels/bands/severity/relevance/values) ---- */
const SYS_PROMPT =
  "You are assisting a qualified clinician using an AI chest X-ray tool. This is educational, " +
  "decision-SUPPORT content only — you are never making a diagnosis and never replacing radiologist " +
  "or clinical review. Be concise (3-6 short sentences or bullets), evidence-oriented, and explicitly " +
  "note that any AI-derived finding must be correlated clinically (history, exam, other investigations) " +
  "before acting on it. Never invent a finding, value, or fact that was not given to you. Never use or " +
  "ask for patient identifiers — you are given only de-identified labels/values.";

function clip(s, n) { return String(s == null ? "" : s).slice(0, n || 200); }
function sanitizeFinding(f) {
  f = f || {};
  return { label: clip(f.label, 160), band: f.band == null ? null : clip(f.band, 20), severity: clip(f.severity, 20), relevance: clip(f.relevance, 200) };
}
function sanitizeFindings(list) {
  return (Array.isArray(list) ? list : []).slice(0, 20).map(sanitizeFinding);
}
// Free-form de-identified clinical context (lab/ABG bands etc). Values only — never identifiers.
function sanitizeContext(ctx) {
  if (!ctx || typeof ctx !== "object") return null;
  const out = {};
  Object.keys(ctx).slice(0, 30).forEach((k) => {
    const key = clip(k, 60);
    const v = ctx[k];
    out[key] = (typeof v === "object") ? clip(JSON.stringify(v), 200) : clip(v, 200);
  });
  return out;
}

function buildPrompt(kind, body) {
  const finding = sanitizeFinding(body.finding);
  const findings = sanitizeFindings(body.findings);
  const context = sanitizeContext(body.context);
  const lines = [];
  if (kind === "learn") {
    lines.push("TASK: explain this single AI-flagged chest X-ray finding for the clinician (what it means, why the AI may have flagged it, and what would help confirm/refute it).");
    lines.push("FINDING: " + (finding.label || "(unlabeled)") + (finding.band ? " [confidence band: " + finding.band + "]" : "") + (finding.severity ? " [severity: " + finding.severity + "]" : "") + (finding.relevance ? " — " + finding.relevance : ""));
  } else if (kind === "impression") {
    lines.push("TASK: write a brief overall impression narrative synthesizing ALL the findings below (most clinically significant first).");
  } else if (kind === "correlate") {
    lines.push("TASK: correlate the imaging findings below with the provided de-identified clinical context (labs/vitals/ABG bands) and suggest what supports or argues against the leading consideration, hedged appropriately.");
  } else {
    lines.push("TASK: provide brief clinical-education commentary on the findings below.");
  }
  if (findings.length) {
    lines.push("ALL FINDINGS (de-identified):");
    findings.forEach((f) => lines.push("- " + (f.label || "(unlabeled)") + (f.band ? " [" + f.band + "]" : "") + (f.relevance ? " — " + f.relevance : "")));
  }
  if (context) lines.push("CLINICAL CONTEXT (de-identified values only): " + JSON.stringify(context));
  return { system: SYS_PROMPT, user: lines.join("\n") };
}

/* ---- Groq (primary) ---- */
const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL_DEFAULT = "llama-3.3-70b-versatile";
async function callGroq(env, prompt) {
  if (!env.GROQ_API_KEY) throw new Error("groq not configured");
  const r = await fetch(GROQ_URL, {
    method: "POST",
    headers: { "Authorization": "Bearer " + env.GROQ_API_KEY, "Content-Type": "application/json" },
    body: JSON.stringify({
      model: env.GROQ_MODEL || GROQ_MODEL_DEFAULT,
      temperature: 0.3,
      max_tokens: 500,
      messages: [{ role: "system", content: prompt.system }, { role: "user", content: prompt.user }],
    }),
  });
  const data = await r.json().catch(() => null);
  if (!r.ok || !data) throw new Error("groq HTTP " + r.status + (data && data.error && data.error.message ? ": " + data.error.message : ""));
  const text = data.choices && data.choices[0] && data.choices[0].message && data.choices[0].message.content;
  if (!text) throw new Error("groq returned no text");
  return text;
}

/* ---- Google/Gemini (fallback) — REUSES the existing project transport unchanged. ---- */
async function callGoogleFallback(env, prompt) {
  const text = await callGemini(env, [{ text: prompt.system + "\n\n" + prompt.user }], 500, { temperature: 0.3 });
  if (!text) throw new Error("gemini returned no text");
  return text;
}

// Groq -> Google/Gemini -> offline. Never throws; the caller always gets a { provider, text } shape.
export async function routeLLM(env, kind, body) {
  const prompt = buildPrompt(kind, body || {});
  try {
    const text = await callGroq(env, prompt);
    return { provider: "groq", text };
  } catch (e) { /* fall through */ }
  try {
    const text = await callGoogleFallback(env, prompt);
    return { provider: "gemini", text };
  } catch (e) { /* fall through */ }
  return { provider: "offline", text: null };
}

const VALID_KINDS = ["learn", "impression", "correlate"];

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const seg = url.pathname.replace(/\/+$/, "").split("/").pop();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  try {
    if (seg !== "llm" || request.method !== "POST") return json({ error: "not_found" }, 404, request);

    const uid = await callerUid(request, env);
    if (!uid) return json({ ok: false, error: "signin_required" }, 401, request);

    const rl = await rateLimit(env, uid);
    if (!rl.ok) return json({ ok: false, error: "rate_limited" }, rl.status || 429, request);

    const body = await readBody(request);
    const kind = VALID_KINDS.indexOf(body.kind) >= 0 ? body.kind : "learn";

    // Shared monthly AI-budget gate (flag-gated via AI_BUDGET_ON). Draws from the SAME
    // maik:m:* counter as MaiK, so ThoreX usage counts against the one allowance. Fail-open:
    // any error here falls through and the call proceeds under the existing rate-limit only.
    let budgetMeterId = null;
    if (aiBudgetOn(env)) {
      try {
        const pr = await proFromRequest(env, request);
        const isPro = pr.pro, verified = !!(pr.claims && pr.claims.verified);
        const store = usageKv(env);
        const month = new Date().toISOString().slice(0, 7); // YYYY-MM (matches monthKey)
        const cap = await monthlyCapFor(env, uid, isPro, verified, month, { kv: store });
        if (cap != null && store) {
          const used = (((await store.get("maik:m:fb:" + uid + ":" + month, "json")) || {}).tokens) || 0;
          if (used >= cap) return json({ ok: false, error: "quota", reason: isPro ? "over-budget" : "needs-pro", needsPro: !isPro }, isPro ? 429 : 402, request);
          budgetMeterId = "fb:" + uid;
        }
      } catch (e) { /* fail-open: keep call-rate limit only */ }
    }

    const { provider, text } = await routeLLM(env, kind, body);
    if (budgetMeterId) {
      try { await meterTokens(env, budgetMeterId, estTokens(JSON.stringify(body || {}).length), estTokens((text || "").length)); } catch (e) {}
    }
    return json({ ok: true, provider, text }, 200, request);
  } catch (e) {
    // Never log the request body (may contain de-identified-but-still-clinical text) or the error
    // detail beyond a generic message — no PHI, no stack with prompt content.
    return json({ ok: true, provider: "offline", text: null }, 200, request);
  }
}
