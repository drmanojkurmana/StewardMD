// functions/api/sknx/report-core.mjs - PURE, node-importable core for the SknX educational-report
// server. ZERO Cloudflare Workers deps so `node --test` can import it directly (an ESM-syntax .js
// server function cannot be node-tested; this .mjs can).
//
// SAFETY-CRITICAL. This module is the single place the three hard invariants are enforced:
//   1. NO raw image reaches the server/LLM. validateReportRequest() rejects any image-bearing key
//      (400) AND whitelists the body down to { analysis, features, evidence, context } so nothing
//      else can flow downstream to the transport.
//   2. NO hallucinated citations. guidelineSummary/references are produced ONLY by the client
//      reasoner (sknx-llm.js) from the caller-supplied evidence[]; the LLM output is NEVER parsed
//      for citations/URLs. The LLM only writes the free-text `discussion`.
//   3. NO prescription (Phase 2 is educational only). management/investigations/followup are the
//      deterministic, server-derived educational principles; the LLM discussion is dropped if it
//      looks like a specific Rx (dose or imperative "prescribe/take N").
//
// The deterministic scaffold is REUSED from the client reasoner (single source of truth) so the
// report shape and the citation-safety guarantee can never drift between client and server.
// No em-dash anywhere; use "-".
import SMD_SKNX_LLM from "../../../sknx-llm.js"; // repo-root client reasoner (CJS IIFE; default import = its API)

export const DISCLAIMER = SMD_SKNX_LLM.DISCLAIMER;

// Case-insensitive key names that would carry raw pixel data. If a body has ANY of these keys we
// reject the whole request rather than try to strip it (fail closed).
const IMAGE_KEYS = new Set([
  "image", "imagedata", "imagebase64", "photo", "dataurl", "base64", "pixels", "img", "file", "bitmap"
]);

// Strict whitelist: ONLY these keys are ever copied out of the client body toward the transport.
const ALLOWED_KEYS = ["analysis", "features", "evidence", "context"];

// Reject any image-bearing body (400); otherwise return a strict-whitelisted input so no unexpected
// field (including a sneaked-in image key we did not enumerate under a different value) flows on.
export function validateReportRequest(body) {
  const obj = (body && typeof body === "object") ? body : {};
  for (const k of Object.keys(obj)) {
    if (IMAGE_KEYS.has(String(k).toLowerCase())) {
      return { ok: false, status: 400, error: "image_not_allowed" };
    }
  }
  return {
    ok: true,
    input: {
      analysis: obj.analysis,
      features: obj.features,
      evidence: Array.isArray(obj.evidence) ? obj.evidence : [],
      context: obj.context
    }
  };
}

// Deterministic, citation-safe payload. Reuses buildReport (guidelineSummary/references derive ONLY
// from input.evidence). Always returns a Promise<reportPayload> (contract of buildReport).
export async function buildScaffold(input) {
  return SMD_SKNX_LLM.buildReport(input || {});
}

// Conservative belt-and-suspenders applied to the LLM discussion ONLY: true if the text looks like a
// specific prescription (a dose pattern, or an explicit "prescribe"/"take N" imperative).
export function looksLikeRx(text) {
  const s = String(text == null ? "" : text);
  return /\b\d+\s?(mg|mcg|g|ml|units?|iu)\b/i.test(s) ||
    /\bprescrib/i.test(s) ||
    /\btake\s+\d/i.test(s);
}

// TEXT-ONLY prompt for the free-text discussion. Never includes or requests an image, never asks for
// citations/drugs. Grounds the model in the differential, the deterministic visual-findings string,
// the referral status, and the vetted evidence snippets.
export function buildDiscussionPrompt(input, payload) {
  input = input || {};
  const analysis = input.analysis || {};
  const evidence = Array.isArray(input.evidence) ? input.evidence : [];
  const differential = Array.isArray(analysis.differential) ? analysis.differential : [];

  const system =
    "You assist a qualified clinician using an educational dermatology decision-support tool. " +
    "Write ONLY an educational discussion paragraph (4-6 sentences). This is NOT a diagnosis. " +
    "Ground every statement in the differential, visual features, and the provided reference snippets. " +
    "Do NOT name any specific drug, dose, or prescription. Do NOT invent citations, guidelines, or " +
    "facts not given. Do not use identifiers.";

  const lines = [];
  lines.push("DIFFERENTIAL (from on-device image analysis, most likely first):");
  if (differential.length) {
    differential.forEach((d) => {
      lines.push("- " + (d.label || "(unlabeled)") + (d.band ? " [" + d.band + " band]" : ""));
    });
  } else {
    lines.push("- (none ranked)");
  }
  lines.push("VISUAL FEATURES: " + ((payload && payload.visualFindings) || "none available"));
  lines.push("REFERRAL: " + (analysis.referral
    ? ("advised" + (analysis.referralReason ? " - " + analysis.referralReason : ""))
    : "not indicated by the analysis"));
  if (evidence.length) {
    lines.push("REFERENCE SNIPPETS (ground your discussion ONLY in these):");
    evidence.forEach((e) => {
      lines.push("- " + (e.source || "") + ": " + (e.title || "") + " - " + (e.snippet || ""));
    });
  }
  lines.push("Write the educational discussion now. TEXT ONLY. Never include or request an image.");

  return { system, user: lines.join("\n") };
}

// Build the full report: ALWAYS the deterministic, citation-safe scaffold; the injected LLM (if any)
// enriches ONLY the free-text discussion, and only if it is a non-empty string that does not look
// like an Rx. No creds / no callLLM / any error / Rx-shaped text -> the deterministic offline report.
export async function buildReportServer(env, input, deps) {
  const payload = await buildScaffold(input);
  const callLLM = deps && deps.callLLM;
  if (typeof callLLM !== "function") return { provider: "offline", payload };
  try {
    const text = await callLLM(buildDiscussionPrompt(input, payload));
    if (text && typeof text === "string" && text.trim() && !looksLikeRx(text)) {
      payload.discussion = text.trim();
      return { provider: "gemini", payload };
    }
  } catch (e) { /* fall through to offline */ }
  return { provider: "offline", payload };
}
