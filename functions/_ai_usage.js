/* StewardMD — AI Control Center: universal usage engine FOUNDATION (Phase 1).
 *
 * PURE, no I/O — fully unit-tested. Later phases compose these over KV/Firestore for recording,
 * quotas, dashboards, and the admin model selector. This module is additive: nothing imports it
 * yet, so it changes no existing behaviour.
 *
 * Design goals from the AI Control Center spec:
 *   • Plugin-style module registry — add a new AI module with ONE entry, no other code changes.
 *   • One immutable usage-record shape for EVERY module (metadata only — NEVER prompts/PHI).
 *   • Per-module daily quotas, all env-overridable without a deploy.
 *   • Cost model per provider/model (2.5 + 3.x), env-overridable (Gemini 3.x rates are estimates
 *     until Google publishes them — the email said "details to follow").
 *   • Admin-settable model override → env → default (the "switch models" control).
 */

// ---- module registry (add a line to support a new AI module — Part 16 "future ready") ----------
// daily: default per-doctor daily cap (0 = unlimited). provider/model = the usual backend for costing.
export const AI_MODULES = {
  maik:        { id: "maik",        label: "MaiK AI",            group: "MaiK",          daily: 50,  provider: "vertex" },
  maik_case:   { id: "maik_case",   label: "MaiK Clinical Case", group: "MaiK",          daily: 25,  provider: "vertex" },
  ecg:         { id: "ecg",         label: "KardiQ X (ECG)",     group: "KardiQ X",      daily: 10,  provider: "vertex" },
  thorex:      { id: "thorex",      label: "ThoreX (Chest X-ray)", group: "ThoreX",      daily: 10,  provider: "vertex" },
  ocr:         { id: "ocr",         label: "Vision / OCR",       group: "OCR",           daily: 50,  provider: "vertex" }, // ICU + Scan Meds combined
  fundx:       { id: "fundx",       label: "FundX AI",           group: "FundX",         daily: 20,  provider: "vertex" },
  followcare:  { id: "followcare",  label: "FollowCare AI",      group: "FollowCare",    daily: 100, provider: "vertex" },
  kb:          { id: "kb",          label: "Knowledge Base",     group: "Knowledge Base", daily: 0,  provider: "local"  }, // semantic search — unlimited
  stt:         { id: "stt",         label: "Speech-to-Text",     group: "Voice",         daily: 50,  provider: "vertex" },
  tts:         { id: "tts",         label: "Text-to-Speech",     group: "Voice",         daily: 50,  provider: "vertex" },
};
export function isAiModule(m) { return Object.prototype.hasOwnProperty.call(AI_MODULES, m); }
export function aiModuleList() { return Object.keys(AI_MODULES).map((k) => ({ id: k, label: AI_MODULES[k].label, group: AI_MODULES[k].group, daily: AI_MODULES[k].daily })); }

// Per-module daily limit, env-overridable via AI_LIMIT_<MODULE> (e.g. AI_LIMIT_ECG=20). 0 = unlimited.
export function moduleDailyLimit(env, moduleId) {
  const mod = AI_MODULES[moduleId]; if (!mod) return 0;
  const raw = env && env["AI_LIMIT_" + String(moduleId).toUpperCase()];
  const v = Number(raw);
  return Number.isFinite(v) && v >= 0 ? v : mod.daily;
}

// ---- cost model (INR per 1k tokens; + flat per-image / per-audio-second). Estimates; env-overridable.
export const MODEL_RATES = {
  "gemini-2.5-flash":       { in: 0.007, out: 0.025 },
  "gemini-2.5-flash-lite":  { in: 0.003, out: 0.012 },
  "gemini-2.5-pro":         { in: 0.110, out: 0.880 },
  // Gemini 3.x — ESTIMATED (Google's exact rates "to follow"); tune via AI_RATE_* env before relying on cost.
  "gemini-3.5-flash":       { in: 0.008, out: 0.028 },
  "gemini-3.5-flash-lite":  { in: 0.003, out: 0.012 },
  "gemini-3.1-flash-lite":  { in: 0.003, out: 0.012 },
};
const DEFAULT_RATE = { in: 0.007, out: 0.025 };
export function modelRate(env, model) {
  const up = "AI_RATE_" + String(model || "").toUpperCase().replace(/[^A-Z0-9]/g, "_");
  const rin = env && Number(env[up + "_IN"]), rout = env && Number(env[up + "_OUT"]);
  const base = MODEL_RATES[model] || DEFAULT_RATE;
  return { in: Number.isFinite(rin) && rin >= 0 ? rin : base.in, out: Number.isFinite(rout) && rout >= 0 ? rout : base.out };
}
// extras: { images, audioSeconds } — flat add-ons (image/audio cost, env-overridable).
export function estCostInr(env, model, inTok, outTok, extras) {
  const r = modelRate(env, model);
  let cost = (Math.max(0, inTok | 0) / 1000) * r.in + (Math.max(0, outTok | 0) / 1000) * r.out;
  const perImg = (env && Number(env.AI_COST_PER_IMAGE_INR)) || 0.35;
  const perAudioSec = (env && Number(env.AI_COST_PER_AUDIO_SEC_INR)) || 0.02;
  if (extras && extras.images) cost += (extras.images | 0) * perImg;
  if (extras && extras.audioSeconds) cost += Math.max(0, extras.audioSeconds) * perAudioSec;
  return Math.round(cost * 10000) / 10000;
}

// ---- model resolver: the "switch models" control. override (admin, KV) → env → hard default. ----
export const MODEL_HARD_DEFAULT = "gemini-2.5-flash";
export const ALLOWED_MODELS = Object.keys(MODEL_RATES);
export function resolveModel(override, env) {
  const pick = (m) => (typeof m === "string" && ALLOWED_MODELS.indexOf(m) > -1 ? m : null);
  return pick(override) || pick(env && env.GEMINI_MODEL) || MODEL_HARD_DEFAULT;
}

// ---- immutable usage record (metadata ONLY — never prompt/PHI/output). One shape for every module. ----
function clip(s, n) { return s == null ? "" : String(s).slice(0, n); }
export function buildUsageRecord(f) {
  f = f || {};
  const inTok = Math.max(0, f.promptTokens | 0), outTok = Math.max(0, f.completionTokens | 0);
  return {
    requestId: clip(f.requestId, 64),
    ts: f.ts || 0,                                   // caller stamps (Date.now unavailable in some ctx)
    hospitalId: clip(f.hospitalId, 64),
    doctorId: clip(f.doctorId, 80),                  // already an opaque hashed id (fb:/cfa:/ip:)
    subscription: clip(f.subscription || "unknown", 20),
    module: isAiModule(f.module) ? f.module : "unknown",
    feature: clip(f.feature, 40),
    provider: clip(f.provider || (AI_MODULES[f.module] && AI_MODULES[f.module].provider) || "vertex", 20),
    model: clip(f.model, 60),
    promptTokens: inTok, completionTokens: outTok, totalTokens: inTok + outTok,
    estCostInr: typeof f.estCostInr === "number" ? f.estCostInr : 0,
    latencyMs: Math.max(0, f.latencyMs | 0),
    status: (f.status === "failed" || f.status === "blocked" || f.status === "timeout") ? f.status : "success",
    httpStatus: f.httpStatus | 0,
    imageCount: Math.max(0, f.imageCount | 0),
    pdfPages: Math.max(0, f.pdfPages | 0),
    audioSeconds: Math.max(0, f.audioSeconds || 0),
    country: clip(f.country, 4), state: clip(f.state, 40),
    // NEVER: prompt text, output text, patient name/MRN, image/audio bytes, report content.
  };
}
