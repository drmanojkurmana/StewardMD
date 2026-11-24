/* ResearchMD Phase 3 worker callback (ES module, server side).
 * Contract: docs/research/contracts/phase-3/callback.md, EXACTLY. The worker
 * holds no user tokens; the HMAC signature is its only credential, so this
 * route has NO Firebase auth (everything else keeps verifyFirebaseClaims).
 *
 * Paths: POST /v1/jobs/{jobId}/callback and POST /jobs/{jobId}/callback
 * (the worker's send_callback posts the latter, jobs.py; callback.md's URL
 * is the same shape). Both hit this handler.
 *
 * Verification order (callback.md): secret configured -> timestamp skew
 * <= 300 s -> constant-time signature over timestamp + "." + RAW body ->
 * body validation -> job exists -> key match -> settled replay (200, no
 * change) -> guarded transition. Credits settle on the same transition
 * (plan section 7): done charges actual usage, failed/cancelled release the
 * full reservation. Stored statuses: done -> succeeded (callback.md table).
 */
import { jobOf } from "./_jobs.js";
import { pdfActualMicroUsd, settleCredits, releaseCredits } from "./_credits.js";
import { ingestManuscriptJob } from "./_manuscript.js";

const MAX_CALLBACK_BYTES = 65536;
const SKEW_SECONDS = 300;
const SETTLED = ["succeeded", "failed", "cancelled"];

export async function readRawBody(request, maxBytes) {
  const announced = Number(request.headers.get("content-length") || 0);
  if (announced > maxBytes) throw new Error("payload_too_large");
  if (!request.body) throw new Error("invalid_json");
  const reader = request.body.getReader();
  const chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > maxBytes) { await reader.cancel(); throw new Error("payload_too_large"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return new TextDecoder().decode(bytes);
}

export async function hmacHex(secret, message) {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(message));
  return [...new Uint8Array(sig)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* Shared signed-request check (callback + internal literature-search).
 * Returns null when valid, else {status, code}. Signature is verified over
 * the exact raw bytes, before any JSON.parse. */
export async function verifySignedHeaders(env, request, rawText, api, nowSec) {
  const secret = env.RESEARCH_CALLBACK_SECRET;
  if (!secret) return { status: 503, code: "callback_unavailable", message: "Research callbacks are not configured" };
  const ts = request.headers.get("x-research-timestamp") || "";
  if (!/^\d+$/.test(ts) || Math.abs(nowSec - Number(ts)) > SKEW_SECONDS)
    return { status: 401, code: "callback_skew", message: "Callback timestamp outside the allowed window" };
  const expected = await hmacHex(secret, ts + "." + rawText);
  if (!api.safeEqual(request.headers.get("x-research-signature") || "", expected))
    return { status: 401, code: "callback_signature", message: "Invalid callback signature" };
  return null;
}

function validateCallbackBody(body, pathJobId) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return "body must be an object";
  const allowed = ["jobId", "idempotencyKey", "status", "resultKey", "error", "usage"];
  for (const k of Object.keys(body)) if (allowed.indexOf(k) < 0) return "unexpected field " + k;
  if (body.jobId !== pathJobId) return "jobId must equal the path job id";
  if (typeof body.idempotencyKey !== "string" || !body.idempotencyKey) return "idempotencyKey is required";
  if (["done", "failed", "cancelled"].indexOf(body.status) < 0) return "status must be done, failed or cancelled";
  if (body.status === "done") {
    if (typeof body.resultKey !== "string" || !/^projects\/[A-Za-z0-9_-]+\/jobs\/[^\/]+\/result\.json$/.test(body.resultKey))
      return "resultKey is required and must be the result.json R2 key";
    if ("error" in body) return "error is absent unless failed";
  } else if (body.status === "failed") {
    if (typeof body.error !== "string" || !/^[a-z][a-z0-9_]{0,79}$/.test(body.error))
      return "error is required and must be a stable code";
    if ("resultKey" in body) return "resultKey is absent unless done";
  } else if ("resultKey" in body || "error" in body) {
    return "resultKey and error are absent unless done/failed";
  }
  const u = body.usage;
  if (!u || typeof u !== "object" || Array.isArray(u)) return "usage is required";
  if (Object.keys(u).some((k) => k !== "pages" && k !== "seconds")) return "usage carries pages and seconds only";
  if (!Number.isInteger(u.pages) || u.pages < 0) return "usage.pages must be a non-negative integer";
  if (typeof u.seconds !== "number" || !Number.isFinite(u.seconds) || u.seconds < 0) return "usage.seconds must be a non-negative number";
  return null;
}

export async function jobCallback(ctx, pathJobId) {
  const { request, env, db, requestId, api } = ctx;
  const { json, err, audit, uuid, safeEqual } = api;
  /* 1-3: secret, skew, signature over the RAW body (before any parse). */
  let rawText;
  try { rawText = await readRawBody(request, MAX_CALLBACK_BYTES); }
  catch { return err(400, "invalid_body", "Invalid callback payload", requestId); }
  const badSig = await verifySignedHeaders(env, request, rawText, { safeEqual }, Math.floor(Date.now() / 1000));
  if (badSig) return err(badSig.status, badSig.code, badSig.message, requestId);
  /* 4: parse and validate. */
  let body;
  try { body = JSON.parse(rawText); } catch { return err(400, "invalid_body", "Invalid callback payload", requestId); }
  const badBody = validateCallbackBody(body, pathJobId);
  if (badBody) return err(400, "invalid_body", badBody, requestId);
  /* 5: job exists. */
  const job = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(pathJobId).first();
  if (!job) return err(404, "job_not_found", "Job not found", requestId);
  /* 6: key and scope match. */
  if (body.idempotencyKey !== job.idempotency_key || body.jobId !== job.id)
    return err(409, "callback_mismatch", "Callback does not match the stored job", requestId);
  if (body.status === "done" && body.resultKey.indexOf("projects/" + job.project_id + "/jobs/" + job.id + "/") !== 0)
    return err(409, "callback_mismatch", "resultKey is outside the job's project", requestId);
  /* 7: replay of a settled job returns 200 with the stored job, no change. */
  if (SETTLED.indexOf(job.status) >= 0)
    return json({ job: jobOf(job), replay: true, requestId }, 200, { "x-request-id": requestId });
  /* 8: guarded transition, one statement. */
  const now = Date.now();
  const terminal = body.status === "done" ? "succeeded" : body.status;
  const output = body.status === "done"
    ? { resultKey: body.resultKey, usage: body.usage }
    : { usage: body.usage };
  const resultKey = body.status === "done" ? body.resultKey : "";
  const errorCode = body.status === "failed" ? body.error : "";
  const upd = await db.prepare(
    "UPDATE research_job_runs SET status=?,output_json=?,result_r2_key=?,usage_json=?,error_code=?,completed_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(terminal, JSON.stringify(output), resultKey, JSON.stringify(body.usage), errorCode, now, job.id).run();
  if (!upd.meta || !upd.meta.changes) {
    const raced = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(job.id).first();
    return json({ job: jobOf(raced), replay: true, requestId }, 200, { "x-request-id": requestId });
  }
  /* Credits settle on the transition: charge actual usage on done, release
   * the rest; failed/cancelled charge nothing (only completed steps). */
  const reserveRow = await db.prepare(
    "SELECT * FROM research_credit_ledger WHERE job_id=? AND reason='reserve' ORDER BY ts ASC LIMIT 1")
    .bind(job.id).first();
  if (reserveRow) {
    const reservation = { ownerType: reserveRow.owner_type, ownerId: reserveRow.owner_id,
      quote: -reserveRow.delta, jobId: job.id };
    if (body.status === "done") {
      const ceilings = JSON.parse(job.ceilings_json || "{}");
      const actual = pdfActualMicroUsd(reservation.quote, body.usage, ceilings);
      await settleCredits(db, env, uuid, reservation, actual);
    } else {
      await releaseCredits(db, uuid, reservation);
    }
  }
  /* The cancel flag lives only until the job settles (retention.md). */
  if (env.RESEARCH_R2) {
    await env.RESEARCH_R2.delete("projects/" + job.project_id + "/jobs/" + job.id + "/cancel").catch(() => {});
  }
  /* Page count becomes known at extraction time. */
  if (body.status === "done" && job.input_r2_key) {
    await db.prepare("UPDATE research_pdfs SET pages=? WHERE project_id=? AND r2_key=?")
      .bind(body.usage.pages, job.project_id, job.input_r2_key).run();
  }
  await audit(db, job.project_id, "worker", "job_settled", job.id,
    { status: terminal, usage: body.usage, errorCode });
  /* A finished manuscript_draft result becomes a manuscript version. A bad
   * draft must not fail the callback; GET /manuscript ingests again. */
  if (terminal === "succeeded" && job.kind === "manuscript_draft") {
    try {
      await ingestManuscriptJob({ db, env, api, requestId }, Object.assign({}, job, {
        status: "succeeded", result_r2_key: resultKey,
      }));
    } catch { /* retried on the next manuscript read */ }
  }
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(job.id).first();
  return json({ job: jobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}
