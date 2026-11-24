/* ResearchMD Phase 3 jobs v2 (ES module, server side).
 * Contracts: docs/research/contracts/phase-3/{retention,callback,ceilings}.md,
 * job-message.schema.json; 0003_research_v3.sql (research_job_runs,
 * research_pdfs). Table-name and status decisions are documented in the 0003
 * header: the pilot research_jobs stays untouched; stored statuses follow
 * callback.md (queued|running|succeeded|failed|cancelled).
 *
 * Routes (hooked in [[path]].js, Firebase auth + project role on every call):
 *   POST /v1/projects/{id}/pdfs        multipart upload, 25 MB, sha256 dedupe
 *   POST /v1/projects/{id}/jobs        {kind:"pdf_extract", pdfId, idempotencyKey}
 *   GET  /v1/jobs/{jobId}              status (pilot jobs fall through)
 *   POST /v1/jobs/{jobId}/cancel       R2 cancel flag + cancel_requested_ts
 *
 * Create order (plan section 7): quote ceilings -> check caps -> reserve
 * credits -> insert job -> send the queue message. Same (project,
 * idempotencyKey) returns the same job; a different input under a used key
 * is 409 idempotency_conflict.
 */
import { PDF_MAX_BYTES, PDF_MAX_PAGES, PDF_MAX_SECONDS, BATCH_MAX,
  HARD_STOP_MESSAGES, checkPdfJobCaps, validateJobMessage } from "./_caps.js";
import { quotePdfJob, availableCredits, reserveCredits, releaseCredits } from "./_credits.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const SETTLED = ["succeeded", "failed", "cancelled"];

function pdfOf(row) {
  return {
    id: row.id, projectId: row.project_id, reportId: row.report_id || null,
    sha256: row.sha256, r2Key: row.r2_key, bytes: row.bytes,
    pages: row.pages == null ? null : row.pages,
    uploadedBy: row.uploaded_by, ts: row.ts,
  };
}
export function jobOf(row) {
  return {
    id: row.id, projectId: row.project_id, kind: row.kind, status: row.status,
    idempotencyKey: row.idempotency_key,
    inputR2Key: row.input_r2_key || "", resultR2Key: row.result_r2_key || "",
    ceilings: JSON.parse(row.ceilings_json || "{}"),
    usage: JSON.parse(row.usage_json || "{}"),
    errorCode: row.error_code || "",
    createdBy: row.created_by, createdTs: row.created_ts,
    startedTs: row.started_ts == null ? null : row.started_ts,
    completedTs: row.completed_ts == null ? null : row.completed_ts,
    cancelRequestedTs: row.cancel_requested_ts == null ? null : row.cancel_requested_ts,
  };
}
async function sha256Bytes(bytes) {
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}

/* POST /v1/projects/{id}/pdfs. Content-addressed per project (retention.md):
 * re-uploading the same bytes reuses the object and the row (200 replay).
 * The PHI hard block stays at the gateway boundary (phi-gate.md placement);
 * pdf_extract makes no LLM call. */
export async function uploadPdf(ctx) {
  const { request, env, db, uid, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "PDF uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart PDF upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one PDF in the file field", requestId);
  if (file.size < 8) return err(400, "invalid_body", "PDF must be at least 8 bytes", requestId);
  if (file.size > PDF_MAX_BYTES) return err(413, "ceiling_bytes", HARD_STOP_MESSAGES.ceiling_bytes, requestId);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(head) !== "%PDF-") return err(415, "file_type", "Only valid PDF files are accepted", requestId);
  const bytes = await file.arrayBuffer();
  const sha256 = await sha256Bytes(bytes);
  const existing = await db.prepare("SELECT * FROM research_pdfs WHERE project_id=? AND sha256=?")
    .bind(projectId, sha256).first();
  if (existing) return json({ pdf: pdfOf(existing), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  let reportId = null;
  const rawReport = form.get("reportId");
  if (rawReport && typeof rawReport === "string") {
    const report = await db.prepare("SELECT id FROM research_reports WHERE id=? AND project_id=?")
      .bind(rawReport, projectId).first();
    if (!report) return err(404, "report_not_found", "Report not found", requestId);
    reportId = report.id;
  }
  const r2Key = "projects/" + projectId + "/pdf/" + sha256 + ".pdf";
  await env.RESEARCH_R2.put(r2Key, bytes, { httpMetadata: { contentType: "application/pdf" },
    customMetadata: { projectId, uploadedBy: uid, sha256 } });
  const id = uuid("pdf_"), now = Date.now();
  try {
    await db.prepare("INSERT INTO research_pdfs (id,project_id,report_id,sha256,r2_key,bytes,uploaded_by,ts) VALUES (?,?,?,?,?,?,?,?)")
      .bind(id, projectId, reportId, sha256, r2Key, file.size, uid, now).run();
  } catch (e) {
    const raced = await db.prepare("SELECT * FROM research_pdfs WHERE project_id=? AND sha256=?")
      .bind(projectId, sha256).first();
    if (raced) return json({ pdf: pdfOf(raced), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
    throw e;
  }
  await audit(db, projectId, uid, "pdf_uploaded", id, { bytes: file.size, sha256 });
  const row = await db.prepare("SELECT * FROM research_pdfs WHERE id=?").bind(id).first();
  return json({ pdf: pdfOf(row), requestId }, 201, { "x-request-id": requestId });
}

/* POST /v1/projects/{id}/jobs. Single pdfId, or a pdfIds batch (at most 20,
 * ceilings.md batch_too_large); batch entries derive deterministic keys
 * "<idempotencyKey>:<index>" so a replay returns the same jobs. */
export async function createJob(ctx, body) {
  const { env, db, uid, claims, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Jobs need an owner, editor or analyst role", requestId);
  if (body.kind !== "pdf_extract")
    return err(400, "invalid_body", "kind must be pdf_extract", requestId);
  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 120)
    return err(400, "invalid_body", "idempotencyKey must be 1-120 characters", requestId);
  let pdfIds;
  if (body.pdfIds !== undefined) {
    if (!Array.isArray(body.pdfIds) || body.pdfIds.some((p) => typeof p !== "string" || !p))
      return err(400, "invalid_body", "pdfIds must be an array of pdf ids", requestId);
    pdfIds = body.pdfIds;
  } else if (typeof body.pdfId === "string" && body.pdfId) {
    pdfIds = [body.pdfId];
  } else {
    return err(400, "invalid_body", "pdfId is required", requestId);
  }
  if (!pdfIds.length) return err(400, "invalid_body", "pdfIds must not be empty", requestId);
  if (pdfIds.length > BATCH_MAX)
    return err(400, "batch_too_large", HARD_STOP_MESSAGES.batch_too_large, requestId);
  const pdfs = [];
  for (const pid of pdfIds) {
    const row = await db.prepare("SELECT * FROM research_pdfs WHERE id=? AND project_id=?")
      .bind(pid, projectId).first();
    if (!row) return err(404, "pdf_not_found", "PDF not found", requestId);
    pdfs.push(row);
  }
  if (!env.RESEARCH_QUEUE) return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);

  const entries = pdfs.map((pdf, i) => ({
    pdf, key: pdfs.length === 1 ? idempotencyKey : idempotencyKey + ":" + i,
  }));
  /* Idempotent replays first: no new caps count, no new reserve. */
  const out = [];
  const fresh = [];
  for (const e of entries) {
    const existing = await db.prepare("SELECT * FROM research_job_runs WHERE project_id=? AND idempotency_key=?")
      .bind(projectId, e.key).first();
    if (existing) {
      if (existing.input_r2_key !== e.pdf.r2_key)
        return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different PDF", requestId);
      out.push({ job: jobOf(existing), idempotentReplay: true });
    } else {
      fresh.push(e);
    }
  }
  if (fresh.length) {
    const now = Date.now();
    const capBreach = await checkPdfJobCaps(db, projectId, uid, fresh.length, now);
    if (capBreach) return err(429, capBreach.code, capBreach.message, requestId);
    const quote = quotePdfJob(env);
    const credits = await availableCredits(db, env, uid, claims && claims.email);
    if (credits.availableMicroUsd < quote * fresh.length)
      return err(402, "insufficient_credits", "Not enough research credits for this job. Top up the MaiK wallet or ask your institution admin.", requestId);
    for (const e of fresh) {
      const jobId = uuid("job_");
      const ceilings = { maxPages: PDF_MAX_PAGES, maxSeconds: PDF_MAX_SECONDS, quoteMicroUsd: quote };
      const reservation = await reserveCredits(db, env, uuid, { uid, email: claims && claims.email, jobId, quote });
      let row;
      try {
        await db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,ceilings_json,created_by,created_ts) VALUES (?,?, 'pdf_extract','queued',?,?,?,?,?)")
          .bind(jobId, projectId, e.key, e.pdf.r2_key, JSON.stringify(ceilings), uid, now).run();
        row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
      } catch (insertErr) {
        await releaseCredits(db, uuid, reservation);
        const raced = await db.prepare("SELECT * FROM research_job_runs WHERE project_id=? AND idempotency_key=?")
          .bind(projectId, e.key).first();
        if (raced) {
          if (raced.input_r2_key !== e.pdf.r2_key)
            return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different PDF", requestId);
          out.push({ job: jobOf(raced), idempotentReplay: true });
          continue;
        }
        throw insertErr;
      }
      const message = {
        v: 1, jobId, kind: "pdf_extract", projectId, idempotencyKey: e.key,
        input: { r2Key: e.pdf.r2_key },
        ceilings: { maxPages: PDF_MAX_PAGES, maxSeconds: PDF_MAX_SECONDS },
        createdAt: Math.floor(now / 1000),
      };
      if (!validateJobMessage(message)) {
        await releaseCredits(db, uuid, reservation);
        await db.prepare("UPDATE research_job_runs SET status='failed',error_code='invalid_message',completed_ts=? WHERE id=?")
          .bind(Date.now(), jobId).run();
        return err(500, "invalid_message", "Job message failed the contract schema", requestId);
      }
      try {
        await env.RESEARCH_QUEUE.send(message);
      } catch (queueErr) {
        await db.prepare("UPDATE research_job_runs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
          .bind(Date.now(), jobId).run();
        await releaseCredits(db, uuid, reservation);
        return err(503, "queue_unavailable", "Could not queue the job; retry with the same idempotency key", requestId);
      }
      await audit(db, projectId, uid, "job_created", jobId, { kind: "pdf_extract", pdfId: e.pdf.id, quoteMicroUsd: quote });
      out.push({ job: jobOf(row) });
    }
  }
  if (out.length === 1) {
    const status = out[0].idempotentReplay ? 200 : 202;
    return json(Object.assign({ requestId }, out[0]), status, { "x-request-id": requestId });
  }
  return json({ jobs: out.map((o) => o.job), replays: out.filter((o) => o.idempotentReplay).length, requestId },
    202, { "x-request-id": requestId });
}

/* GET /v1/jobs/{jobId}. Returns null when the id is not a Phase 3 job so the
 * router can fall through to the pilot research_jobs lookup. Outsiders get
 * 404 (Phase 1 convention: non-members see no project). */
export async function getJob(ctx, jobId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, member } = api;
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row) return null;
  if (!(await member(db, row.project_id, uid)))
    return err(404, "job_not_found", "Job not found", requestId);
  return json({ job: jobOf(row), requestId }, 200, { "x-request-id": requestId });
}

/* POST /v1/jobs/{jobId}/cancel. Writes the R2 cancel object (retention.md)
 * and cancel_requested_ts; the worker checks the flag between pages and
 * settles via the callback. A cancel for an already-settled job is a no-op.
 * The API deletes the cancel object when the job settles (_callback.js). */
export async function cancelJob(ctx, jobId) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, projectGate, gateErr } = api;
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row) return err(404, "job_not_found", "Job not found", requestId);
  const gate = await projectGate(db, row.project_id, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Cancelling a job needs an owner, editor or analyst role", requestId);
  if (SETTLED.indexOf(row.status) >= 0)
    return json({ job: jobOf(row), alreadySettled: true, requestId }, 200, { "x-request-id": requestId });
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const cancelKey = "projects/" + row.project_id + "/jobs/" + jobId + "/cancel";
  await env.RESEARCH_R2.put(cancelKey, "", { httpMetadata: { contentType: "text/plain" } });
  const now = Date.now();
  await db.prepare("UPDATE research_job_runs SET cancel_requested_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(now, jobId).run();
  await audit(db, row.project_id, uid, "job_cancel_requested", jobId, {});
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  return json({ job: jobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}
