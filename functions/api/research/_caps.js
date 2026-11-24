/* ResearchMD Phase 3 ceilings and spend caps (ES module, server side).
 * Contract: docs/research/contracts/phase-3/ceilings.md (frozen defaults).
 * Every ceiling here is enforced in code, not in a prompt. The worker
 * enforces the pdf_extract page/second rows; the API enforces the byte and
 * batch rows, the daily caps and the AI token rows before enqueueing or
 * calling the gateway. Hard-stop messages are the contract text, verbatim.
 * Deterministic work (stats, dedup, exports) is never blocked by an AI cap.
 */

export const PDF_MAX_BYTES = 26214400; /* 25 MB, ceilings.md */
export const PDF_MAX_PAGES = 60;
export const PDF_MAX_SECONDS = 240;
export const BATCH_MAX = 20;

/* AI rows, ceilings.md. Retries/refinement rounds are enforced adapter-side
 * (po_adapter/llm.py TIER_CEILINGS); the gateway enforces the token rows and
 * owns one provider call per request (the adapter loops). */
export const TIER_CEILINGS = {
  T1: { maxInputTokens: 8000, maxOutputTokens: 2000, maxRetries: 2, maxRefinementRounds: 1 },
  T2: { maxInputTokens: 16000, maxOutputTokens: 4000, maxRetries: 2, maxRefinementRounds: 2 },
  T3: { maxInputTokens: 24000, maxOutputTokens: 4000, maxRetries: 1, maxRefinementRounds: 1 },
};

/* Daily caps, UTC day, ceilings.md. AI spend is micro-USD. */
export const DAILY_CAPS = {
  projectJobs: 200,
  userJobs: 300,
  projectAiMicroUsd: 5000000,  /* US$5.00 */
  userAiMicroUsd: 10000000,    /* US$10.00 */
};

export const HARD_STOP_MESSAGES = {
  ceiling_pages: "This PDF has more than 60 pages. Split it and upload the parts.",
  ceiling_bytes: "This file is larger than 25 MB. Upload a smaller version.",
  ceiling_seconds: "Processing this PDF took too long and was stopped. Try a smaller or simpler file.",
  batch_too_large: "A batch can hold at most 20 PDFs. Split the batch and try again.",
  project_daily_cap: "This project has reached today's processing limit. Try again tomorrow.",
  user_daily_cap: "You have reached today's research limit. Try again tomorrow.",
  project_ai_cap: "This project has reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected.",
  user_ai_cap: "You have reached today's AI budget. AI suggestions resume tomorrow; your data and tools are unaffected.",
  ceiling_input_tokens: "This request is too large for one AI call. Split the text and try again.",
};

export function utcDayStart(nowMs) {
  const d = new Date(nowMs);
  return Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
}

/* pdf_extract daily job caps, checked before enqueue. Counts every job
 * created today (any status): a failed attempt still used a slot. */
export async function checkPdfJobCaps(db, projectId, uid, addJobs, nowMs) {
  const dayStart = utcDayStart(nowMs);
  const p = await db.prepare(
    "SELECT COUNT(*) AS n FROM research_job_runs WHERE project_id=? AND kind='pdf_extract' AND created_ts>=?")
    .bind(projectId, dayStart).first();
  if (((p && p.n) || 0) + addJobs > DAILY_CAPS.projectJobs)
    return { code: "project_daily_cap", message: HARD_STOP_MESSAGES.project_daily_cap };
  const u = await db.prepare(
    "SELECT COUNT(*) AS n FROM research_job_runs WHERE created_by=? AND kind='pdf_extract' AND created_ts>=?")
    .bind(uid, dayStart).first();
  if (((u && u.n) || 0) + addJobs > DAILY_CAPS.userJobs)
    return { code: "user_daily_cap", message: HARD_STOP_MESSAGES.user_daily_cap };
  return null;
}

/* AI daily spend caps, checked before the gateway call. addMicroUsd is the
 * quoted ceiling of the call about to run, so the cap cannot be overshot by
 * an in-flight call. Settled actuals live in research_ai_usage. */
export async function checkAiCaps(db, projectId, uid, addMicroUsd, nowMs) {
  const dayStart = utcDayStart(nowMs);
  const p = await db.prepare(
    "SELECT COALESCE(SUM(cost_micro_usd),0) AS n FROM research_ai_usage WHERE project_id=? AND ts>=?")
    .bind(projectId, dayStart).first();
  if (((p && p.n) || 0) + addMicroUsd > DAILY_CAPS.projectAiMicroUsd)
    return { code: "project_ai_cap", message: HARD_STOP_MESSAGES.project_ai_cap };
  const u = await db.prepare(
    "SELECT COALESCE(SUM(cost_micro_usd),0) AS n FROM research_ai_usage WHERE user_id=? AND ts>=?")
    .bind(uid, dayStart).first();
  if (((u && u.n) || 0) + addMicroUsd > DAILY_CAPS.userAiMicroUsd)
    return { code: "user_ai_cap", message: HARD_STOP_MESSAGES.user_ai_cap };
  return null;
}

/* Deterministic pre-call token estimate, identical to po_adapter/llm.py
 * estimate_tokens (~4 chars/token). The gateway's actual usage is
 * authoritative and is what gets recorded and settled. */
export function estimateTokens(text) {
  return Math.floor(String(text == null ? "" : text).length / 4) + 1;
}

/* job-message.schema.json validation, producer side. Messages that fail
 * this are never sent (the worker refuses them too; a malformed message is
 * a contract bug, not a retryable job). */
const R2_KEY_RE = /^projects\/[A-Za-z0-9_-]+\/pdf\/[0-9a-f]{64}\.pdf$/;
export function validateJobMessage(msg) {
  if (!msg || typeof msg !== "object" || Array.isArray(msg)) return false;
  if (msg.v !== 1) return false;
  if (msg.kind !== "pdf_extract") return false;
  for (const f of ["jobId", "projectId", "idempotencyKey"]) {
    const v = msg[f];
    if (typeof v !== "string" || !v || v.length > (f === "idempotencyKey" ? 120 : 80)) return false;
  }
  if (!Number.isInteger(msg.createdAt) || msg.createdAt < 0) return false;
  const c = msg.ceilings;
  if (!c || typeof c !== "object") return false;
  if (!Number.isInteger(c.maxPages) || c.maxPages < 1 || c.maxPages > PDF_MAX_PAGES) return false;
  if (!Number.isInteger(c.maxSeconds) || c.maxSeconds < 1 || c.maxSeconds > PDF_MAX_SECONDS) return false;
  const key = msg.input && msg.input.r2Key;
  if (typeof key !== "string" || !R2_KEY_RE.test(key)) return false;
  if (key.indexOf("projects/" + msg.projectId + "/") !== 0) return false;
  if (Object.keys(msg).some((k) => ["v", "jobId", "kind", "projectId", "idempotencyKey", "input", "ceilings", "createdAt"].indexOf(k) < 0)) return false;
  if (Object.keys(msg.input).some((k) => k !== "r2Key")) return false;
  if (Object.keys(c).some((k) => k !== "maxPages" && k !== "maxSeconds")) return false;
  return true;
}
