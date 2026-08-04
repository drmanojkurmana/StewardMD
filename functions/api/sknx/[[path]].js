/* functions/api/sknx/[[path]].js - SknX educational-report server (REAL Gemini/Vertex transport).
 *
 * Turns a DE-IDENTIFIED on-device dermatology analysis (differential labels/bands + morphometric
 * feature flags) plus the caller-supplied vetted evidence corpus into an evidence-grounded
 * EDUCATIONAL report. SAFETY-CRITICAL. Three hard invariants (enforced in report-core.mjs; each
 * covered by test/sknx-api.test.mjs):
 *   1. NO raw image ever reaches the server/LLM. validateReportRequest() rejects (400) any body
 *      carrying an image-bearing key and whitelists input to { analysis, features, evidence, context }.
 *   2. NO hallucinated citations. guidelineSummary/references are derived ONLY from the caller's
 *      evidence[] (the vetted sknx-evidence.js corpus); the LLM output is NEVER parsed for
 *      citations/URLs. The LLM writes ONLY the free-text `discussion`.
 *   3. NO prescription (Phase 2 is educational only). management/investigations/followup are the
 *      server-derived educational principles; the LLM discussion is dropped if it looks like an Rx.
 *
 * Auth: a valid Firebase ID token is REQUIRED (Authorization: Bearer <idToken>) - 401 otherwise.
 * Same server-derived-identity posture as thorex (callerUid via verifyFirebaseToken), never a
 * client-supplied id; this route additionally never logs bodies or error detail (no PHI).
 *
 * Provider: REUSES the existing project Google/Gemini transport (callGemini) unchanged - Vertex
 * primary -> AI-Studio developer fallback. With no creds / any failure it responds
 * { ok:true, provider:"offline", payload } (the deterministic report), or payload:null on hard
 * error, so the client's own deterministic mock renders. SknX must always show something useful.
 *
 * Routes:
 *   POST /api/sknx/report  body: { analysis, features, evidence, context }
 *                          -> { ok, provider: "gemini"|"offline", payload }
 *
 * This file is purely additive: it does not modify /api/ai/*, /api/thorex/*, or any other existing
 * AI endpoint.
 */
import { callGemini } from "../ai/[[path]].js";
import { verifyFirebaseToken } from "../../_fbauth.js";
import { usageKv, estTokens, meterTokens } from "../../_usage.js";
import { aiBudgetOn, monthlyCapFor } from "../../_aibudget.js";
import { proFromRequest } from "../../_entitlement.js";
import { requireFeature } from "../../_features.js";
import { validateReportRequest, buildReportServer } from "./report-core.mjs";

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

// Server-derived identity ONLY - mirrors thorex's callerUid. Never trusts a client-supplied user id.
async function callerUid(request, env) {
  const tok = (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
  if (!tok) return null;
  try { return await verifyFirebaseToken(tok, env); } catch (e) { return null; }
}

// Modest per-uid rate limit: min 2s between calls, daily cap. Fail-open (no KV bound -> allow),
// same posture as thorex. Keys namespaced sknx:report:* so they never collide with tx:llm:*.
async function rateLimit(env, uid) {
  const store = usageKv(env);
  if (!store) return { ok: true };
  const nowS = Math.floor(Date.now() / 1000);
  try {
    const minKey = "sknx:report:rate:" + uid;
    const last = await store.get(minKey);
    if (last && (nowS - Number(last)) < 2) return { ok: false, status: 429 };
    await store.put(minKey, String(nowS), { expirationTtl: 60 });
    const day = new Date(nowS * 1000).toISOString().slice(0, 10);
    const capKey = "sknx:report:count:" + uid + ":" + day;
    const cur = Number(await store.get(capKey)) || 0;
    const cap = Number(env.SKNX_LLM_DAILY_CAP) || 120;
    if (cur >= cap) return { ok: false, status: 429 };
    await store.put(capKey, String(cur + 1), { expirationTtl: 90000 });
  } catch (e) { /* fail-open */ }
  return { ok: true };
}

async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }

export async function onRequest(context) {
  const { request, env } = context;
  const url = new URL(request.url);
  const seg = url.pathname.replace(/\/+$/, "").split("/").pop();

  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });

  try {
    if (seg !== "report" || request.method !== "POST") return json({ error: "not_found" }, 404, request);

    const uid = await callerUid(request, env);
    if (!uid) return json({ ok: false, error: "signin_required" }, 401, request);

    // Feature switchboard gate (flag-gated via FEATURES_ON; inert/allow when off).
    const feat = await requireFeature(env, request, "sknx_llm", { uid });
    if (!feat.allowed) return json({ ok: false, error: "feature_off", feature: "sknx_llm" }, 403, request);

    const rl = await rateLimit(env, uid);
    if (!rl.ok) return json({ ok: false, error: "rate_limited" }, rl.status || 429, request);

    const body = await readBody(request);
    // INVARIANT 1: rejects any image-bearing key (400) AND whitelists input downstream.
    const v = validateReportRequest(body);
    if (!v.ok) return json({ ok: false, error: v.error }, v.status, request);

    // Shared monthly AI-budget gate (flag-gated via AI_BUDGET_ON). Draws from the SAME maik:m:*
    // counter as MaiK, so SknX usage counts against the one allowance. Fail-open: any error here
    // falls through and the call proceeds under the existing rate-limit only.
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

    // The injected transport sends TEXT ONLY (system + user prompt) - never an image. The prompt is
    // built inside report-core from the whitelisted, de-identified input.
    const callLLM = async (prompt) => callGemini(env, [{ text: prompt.system + "\n\n" + prompt.user }], 700, { temperature: 0.3 });
    const { provider, payload } = await buildReportServer(env, v.input, { callLLM });

    // Meter only a REAL LLM answer - never charge the user for the offline deterministic fallback.
    if (budgetMeterId && provider !== "offline") {
      try { await meterTokens(env, budgetMeterId, estTokens(JSON.stringify(v.input || {}).length), estTokens(String((payload && payload.discussion) || "").length)); } catch (e) {}
    }

    return json({ ok: true, provider, payload }, 200, request);
  } catch (e) {
    // Never log the request body (de-identified but still clinical) or error detail (no PHI). On any
    // hard failure, payload:null so the client falls back to its own on-device mock report.
    return json({ ok: true, provider: "offline", payload: null }, 200, request);
  }
}
