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
  PO_MAX_SECONDS, PO_MAX_CALLS, HARD_STOP_MESSAGES, CLOUD_FALLBACK_MESSAGES,
  checkPdfJobCaps, checkPoJobCaps, validateJobMessage } from "./_caps.js";
import { quotePdfJob, quoteAiCall, availableCredits, reserveCredits, releaseCredits, activeJobReservation, expireLostJobs } from "./_credits.js";
import { scan, phiCategories } from "./_phi.js";
import { mintJobToken } from "./_gateway.js";
import { gateManuscript, ingestManuscriptJob, tokenTable } from "./_manuscript.js";
import { checkCloudFallbackAvailable, parseFormFallback, recordCloudFallbackUsed, refundCloudFallbackForJob } from "./_cloud_fallback.js";

const WRITE_ROLES = ["owner", "editor", "analyst"];
const SETTLED = ["succeeded", "failed", "cancelled"];

/* Lost jobs must not keep counting against caps or hold credits forever.
 * Best effort: a failure here never fails the doctor's request. */
async function expireLostBefore(db, uuid) {
  try { await expireLostJobs(db, uuid); }
  catch (e) { console.error("research: expireLostJobs failed", e && e.message); }
}

function pdfOf(row) {
  return {
    id: row.id, projectId: row.project_id, reportId: row.report_id || null,
    sha256: row.sha256, r2Key: row.r2_key, bytes: row.bytes,
    pages: row.pages == null ? null : row.pages,
    uploadedBy: row.uploaded_by, ts: row.ts,
  };
}
export function jobOf(row) {
  const out = parseJson(row.output_json, {});
  const job = {
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
  if (out && out.runner) job.runner = out.runner;
  return job;
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
  const { request, env, db, uid, claims, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "PDF uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart PDF upload", requestId); }
  const fallback = parseFormFallback(form.get("fallback"));
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
  if (existing && existing.r2_key) return json({ pdf: pdfOf(existing), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  if (existing) {
    /* A device extraction stored this sha without the PDF bytes (r2_key ""). Store them now so a server job can read them. */
    const fillKey = "projects/" + projectId + "/pdf/" + sha256 + ".pdf";
    await env.RESEARCH_R2.put(fillKey, bytes, { httpMetadata: { contentType: "application/pdf" },
      customMetadata: { projectId, uploadedBy: uid, sha256 } });
    await db.prepare("UPDATE research_pdfs SET r2_key=? WHERE id=? AND r2_key=''").bind(fillKey, existing.id).run();
    const filled = await db.prepare("SELECT * FROM research_pdfs WHERE id=?").bind(existing.id).first();
    return json({ pdf: pdfOf(filled), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  }
  if (fallback) {
    const fbCheck = await checkCloudFallbackAvailable(env, db, uid, claims);
    if (!fbCheck.ok) return err(fbCheck.http, fbCheck.code, fbCheck.message, requestId);
  }
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
export async function createJob(ctx, body, opts = {}) {
  if (body && body.kind === "manuscript_draft") return createManuscriptJob(ctx, body);
  const { env, db, uid, claims, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  await expireLostBefore(db, uuid);
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Jobs need an owner, editor or analyst role", requestId);
  if (body.kind !== "pdf_extract")
    return err(400, "invalid_body", "kind must be pdf_extract or manuscript_draft", requestId);
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
    if (!row.r2_key) return err(409, "pdf_not_stored", "Upload this PDF again before starting a server job", requestId);
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
    const hasFallback = body.fallback != null && typeof body.fallback === "object" && !Array.isArray(body.fallback);
    const prechecked = !!(opts && opts.fallbackPrechecked);
    let fallbackAllowance = opts && opts.fallbackStatus ? opts.fallbackStatus.allowance : null;
    let fallbackRemaining = opts && opts.fallbackStatus ? opts.fallbackStatus.remaining : null;
    if (hasFallback) {
      if (!prechecked || fallbackAllowance == null || fallbackRemaining == null) {
        const fbCheck = await checkCloudFallbackAvailable(env, db, uid, claims, now);
        if (!fbCheck.ok) return err(fbCheck.http, fbCheck.code, fbCheck.message, requestId);
        fallbackAllowance = fbCheck.status.allowance;
        fallbackRemaining = fbCheck.status.remaining;
      }
      if (fallbackRemaining < fresh.length) {
        return err(402, "cloud_fallback_limit", CLOUD_FALLBACK_MESSAGES.cloud_fallback_limit, requestId);
      }
    }
    const capBreach = await checkPdfJobCaps(db, projectId, uid, fresh.length, now);
    if (capBreach) return err(429, capBreach.code, capBreach.message, requestId);
    const quote = quotePdfJob(env);
    const credits = await availableCredits(db, env, uid, claims && claims.email);
    if (credits.availableMicroUsd < quote * fresh.length)
      return err(402, "insufficient_credits", "Not enough research credits for this job. Top up the MaiK wallet or ask your institution admin.", requestId);
    for (const e of fresh) {
      const jobId = uuid("job_");
      const ceilings = { maxPages: PDF_MAX_PAGES, maxSeconds: PDF_MAX_SECONDS, quoteMicroUsd: quote };
      if (hasFallback) {
        const fbRec = await recordCloudFallbackUsed(db, {
          uid, projectId, kind: "pdf", jobId, fallback: body.fallback, allowance: fallbackAllowance, nowMs: now,
        });
        if (!fbRec.ok) return err(fbRec.http, fbRec.code, fbRec.message, requestId);
      }
      const reservation = await reserveCredits(db, env, uuid, { uid, email: claims && claims.email, jobId, quote });
      let row;
      try {
        await db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,ceilings_json,created_by,created_ts) VALUES (?,?,?,'queued',?,?,?,?,?)")
          .bind(jobId, projectId, "pdf_extract", e.key, e.pdf.r2_key, JSON.stringify(ceilings), uid, now).run();
        row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
      } catch (insertErr) {
        await releaseCredits(db, uuid, reservation);
        if (hasFallback) await db.prepare("DELETE FROM research_cloud_fallbacks WHERE job_id=?").bind(jobId).run().catch(() => {});
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
        if (hasFallback) await refundCloudFallbackForJob(db, jobId, "invalid_message").catch(() => {});
        return err(500, "invalid_message", "Job message failed the contract schema", requestId);
      }
      try {
        await env.RESEARCH_QUEUE.send(message);
      } catch (queueErr) {
        await db.prepare("UPDATE research_job_runs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
          .bind(Date.now(), jobId).run();
        await releaseCredits(db, uuid, reservation);
        if (hasFallback) await refundCloudFallbackForJob(db, jobId, "queue_unavailable").catch(() => {});
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

const PO_CALL_BUDGET = 64;
const DEVICE_TOKEN_TTL_SECONDS = 840; /* matches container job.py (14 min < 900 s gateway cap) */
const TOKEN_REFRESH_MIN_MS = 60000;
const DEVICE_FAIL_CODES = ["gate_failed", "phi_blocked", "ceiling_calls", "ceiling_seconds", "invalid_snapshot", "device_failed"];
const GRADE_CERTAINTIES = ["high", "moderate", "low", "very low"];
const GRADE_DOMAIN_KEYS = ["riskOfBias", "inconsistency", "indirectness", "imprecision", "publicationBias"];
const CUTOFF_DATE_RE = /^\d{4}-(?:0[1-9]|1[0-2])$/;

function parseJson(text, fallback) {
  try {
    const v = JSON.parse(text || "");
    return v == null ? fallback : v;
  } catch {
    return fallback;
  }
}

function isoUtc(ts) {
  return new Date(ts).toISOString().replace(/\.\d{3}Z$/, "Z");
}

function isSystematicReviewStudyType(studyType) {
  const s = String(studyType || "").trim().toLowerCase();
  if (!s) return false;
  if (s === "systematic_review" || s === "meta_analysis") return true;
  if (/systematic[\s_-]*review|\bmeta[\s_-]*analys/.test(s)) return true;
  if (s === "observational cohort synthesis" || s === "randomized controlled trials") return true;
  return false;
}

function hasProvenance(locator, quote) {
  if (!locator || typeof locator !== "object" || Array.isArray(locator) || !Object.keys(locator).length) return false;
  return typeof quote === "string" && quote.trim().length > 0;
}

function robDomainsAgree(toolId, a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || !a.length) return false;
  const byKey = {};
  for (const d of b) if (d && d.key) byKey[d.key] = d;
  for (const d of a) {
    if (!d || !d.key) return false;
    const o = byKey[d.key];
    if (!o || o.judgment !== d.judgment) return false;
    if (toolId === "nos" && (Number(o.stars) || 0) !== (Number(d.stars) || 0)) return false;
    if (d.judgment === "no_information" || d.judgment === "unclear") return false;
  }
  return true;
}

function recordPmid(rec, meta) {
  if (rec && rec.source === "pubmed" && /^\d+$/.test(String(rec.external_id || ""))) return String(rec.external_id);
  return meta && meta.pmid ? String(meta.pmid) : "";
}

function sourceFromRecord(rec) {
  if (!rec) return null;
  const meta = parseJson(rec.metadata_json, {});
  const authors = parseJson(rec.authors_json, []);
  const src = {};
  if (rec.title) src.title = rec.title;
  const doi = rec.doi || meta.doi || "";
  if (doi) src.doi = String(doi);
  const pmid = recordPmid(rec, meta);
  if (pmid) src.pmid = pmid;
  if (Array.isArray(authors) && authors.length) src.authors = authors;
  if (rec.year != null) src.year = rec.year;
  return Object.keys(src).length ? src : null;
}

function buildProtocolBlock(project, proto) {
  const content = parseJson(proto.content_json, {});
  const out = {};
  const title = (content.prospero && typeof content.prospero.title === "string" && content.prospero.title.trim()) ||
    (typeof content.title === "string" && content.title.trim()) ||
    (project && project.title) || "";
  if (title) out.title = title;
  const question = (typeof content.question === "string" && content.question.trim()) ||
    (project && project.research_question) || "";
  if (question) out.question = question;
  if (content.pico && typeof content.pico === "object" && !Array.isArray(content.pico) && Object.keys(content.pico).length) {
    out.pico = content.pico;
  }
  const design = (typeof content.design === "string" && content.design.trim()) ||
    (project && project.study_type) || "";
  if (design) out.design = design;
  if (Array.isArray(content.eligibility) && content.eligibility.length) {
    out.eligibility = content.eligibility;
  } else if (typeof content.eligibility === "string" && content.eligibility.trim()) {
    out.eligibility = content.eligibility;
  }
  if (Array.isArray(content.outcomes) && content.outcomes.length) {
    out.outcomes = content.outcomes;
  } else if (content.outcomes && typeof content.outcomes === "object" && !Array.isArray(content.outcomes)) {
    const list = [];
    if (typeof content.outcomes.primary === "string" && content.outcomes.primary.trim()) list.push(content.outcomes.primary.trim());
    if (Array.isArray(content.outcomes.secondary)) {
      for (const s of content.outcomes.secondary) if (typeof s === "string" && s.trim()) list.push(s.trim());
    }
    if (list.length) out.outcomes = list;
  }
  out.lockHash = proto.lock_hash;
  if (proto.locked_at != null) out.lockedAt = isoUtc(proto.locked_at);
  return out;
}

async function buildManuscriptSnapshot(db, project, proto, projectId, jobId) {
  const studies = (await db.prepare("SELECT * FROM research_studies WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const extractions = (await db.prepare("SELECT * FROM research_extractions WHERE project_id=? ORDER BY updated_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const reportRecords = (await db.prepare(
    "SELECT rep.study_id, rec.* FROM research_reports rep JOIN research_records rec ON rec.id=rep.record_id WHERE rep.project_id=? AND rep.study_id IS NOT NULL")
    .bind(projectId).all()).results || [];

  const extByStudy = new Map();
  for (const ex of extractions) extByStudy.set(ex.study_id, ex);
  const recByStudy = new Map();
  for (const rr of reportRecords) if (!recByStudy.has(rr.study_id)) recByStudy.set(rr.study_id, rr);

  const evidence = [];
  for (const st of studies) {
    const values = [];
    const seenFields = new Set();
    const ext = extByStudy.get(st.id);
    if (ext) {
      const fields = parseJson(ext.fields_json, {});
      if (fields && typeof fields === "object" && !Array.isArray(fields)) {
        for (const fieldKey of Object.keys(fields)) {
          seenFields.add(fieldKey);
          const f = fields[fieldKey];
          if (!f || (f.status !== "verified" && f.status !== "corrected")) continue;
          if (f.value === undefined || f.value === null || f.value === "") continue;
          if (!hasProvenance(f.locator, f.quote)) continue;
          values.push({ field: fieldKey, value: f.value, verified: true, locator: f.locator, quote: f.quote });
        }
      }
    }
    if (st.verified === 1) {
      const stLoc = parseJson(st.locator_json, null);
      if (hasProvenance(stLoc, st.quote)) {
        const inputs = parseJson(st.inputs_json, {});
        if (inputs && typeof inputs === "object" && !Array.isArray(inputs)) {
          for (const fieldKey of Object.keys(inputs)) {
            if (seenFields.has(fieldKey)) continue;
            const val = inputs[fieldKey];
            if (val === undefined || val === null || val === "") continue;
            values.push({ field: fieldKey, value: val, verified: true, locator: stLoc, quote: st.quote });
          }
        }
      }
    }
    if (!values.length) continue;
    const item = { studyId: st.id };
    if (st.label) item.label = st.label;
    const src = sourceFromRecord(recByStudy.get(st.id));
    if (src) item.source = src;
    item.values = values;
    evidence.push(item);
  }

  const runRows = (await db.prepare("SELECT * FROM research_runs WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const runs = runRows.map((r) => {
    const parsed = parseJson(r.result_json, {});
    const result = parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
    return {
      runId: r.id,
      engine: r.engine || "research-engine",
      engineVersion: r.engine_version || "rmd1",
      measure: r.measure,
      method: r.model || "",
      result,
    };
  });

  const recRows = (await db.prepare("SELECT * FROM research_records WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const references = recRows.map((r) => {
    const meta = parseJson(r.metadata_json, {});
    const authors = parseJson(r.authors_json, []);
    const ref = { key: r.id };
    if (r.title) ref.title = r.title;
    if (Array.isArray(authors) && authors.length) ref.authors = authors;
    if (r.year != null) ref.year = r.year;
    const venue = meta.venue || meta.journal || "";
    if (venue) ref.venue = String(venue);
    const doi = r.doi || meta.doi || "";
    if (doi) ref.doi = String(doi);
    const pmid = recordPmid(r, meta);
    if (pmid) ref.pmid = pmid;
    if (meta.volume) ref.volume = String(meta.volume);
    if (meta.pages) ref.pages = String(meta.pages);
    return ref;
  });

  const robConflicts = (await db.prepare("SELECT * FROM research_rob_conflicts WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const conflictByPair = new Map();
  for (const c of robConflicts) conflictByPair.set(c.study_id + "::" + c.tool, c);

  const robRows = (await db.prepare("SELECT * FROM research_rob_assessments WHERE project_id=? ORDER BY created_ts DESC, rowid DESC")
    .bind(projectId).all()).results || [];
  const votesByPair = new Map();
  for (const r of robRows) {
    const pair = r.study_id + "::" + r.tool;
    if (!votesByPair.has(pair)) votesByPair.set(pair, new Map());
    const byAssessor = votesByPair.get(pair);
    if (!byAssessor.has(r.assessor_uid)) byAssessor.set(r.assessor_uid, r);
  }

  const rob = [];
  const seenPairs = new Set();
  const pushRobDomains = (studyId, tool, domains) => {
    if (!Array.isArray(domains)) return;
    for (const d of domains) {
      if (!d || !d.key || !d.judgment || d.verified === false) continue;
      if (!hasProvenance(d.locator, d.quote)) continue;
      rob.push({
        studyId,
        tool,
        domain: d.key,
        judgment: d.judgment,
        verified: true,
        locator: d.locator,
        quote: d.quote,
      });
    }
  };
  for (const c of robConflicts) {
    const pair = c.study_id + "::" + c.tool;
    seenPairs.add(pair);
    if (c.status !== "resolved" || !c.consensus_json) continue;
    pushRobDomains(c.study_id, c.tool, parseJson(c.consensus_json, []));
  }
  for (const [pair, byAssessor] of votesByPair.entries()) {
    if (seenPairs.has(pair)) continue;
    const votes = [...byAssessor.values()];
    if (votes.length < 2) continue;
    const studyId = votes[0].study_id;
    const tool = votes[0].tool;
    const a = parseJson(votes[0].domains_json, []);
    const b = parseJson(votes[1].domains_json, []);
    if (!robDomainsAgree(tool, a, b)) continue;
    pushRobDomains(studyId, tool, a);
  }

  const gradeRows = (await db.prepare("SELECT * FROM research_grade_assessments WHERE project_id=? ORDER BY created_ts ASC, id ASC")
    .bind(projectId).all()).results || [];
  const grade = [];
  for (const g of gradeRows) {
    if (!g.outcome) continue;
    const res = parseJson(g.result_json, {});
    const cert = typeof res.certainty === "string" ? res.certainty.trim() : "";
    if (GRADE_CERTAINTIES.indexOf(cert.toLowerCase()) < 0) continue;
    const item = { outcome: g.outcome, certainty: cert.toLowerCase() };
    if (Array.isArray(res.footnotes) && res.footnotes.length) {
      const rat = res.footnotes.filter((f) => typeof f === "string" && f.trim()).join("; ");
      if (rat) item.rationale = rat;
    }
    const inp = parseJson(g.input_json, {});
    if (inp && typeof inp === "object" && !Array.isArray(inp)) {
      const domains = {};
      for (const dk of GRADE_DOMAIN_KEYS) {
        if (inp[dk] && typeof inp[dk].level === "string" && inp[dk].level) domains[dk] = inp[dk].level;
      }
      if (Object.keys(domains).length) item.domains = domains;
    }
    grade.push(item);
  }

  return {
    v: 1,
    projectId,
    jobId,
    protocol: buildProtocolBlock(project, proto),
    evidence,
    runs,
    references,
    rob,
    grade,
  };
}

function collectStrings(val, out) {
  if (typeof val === "string") {
    if (val) out.push(val);
    return;
  }
  if (Array.isArray(val)) {
    for (const item of val) collectStrings(item, out);
    return;
  }
  if (val && typeof val === "object") {
    for (const k of Object.keys(val)) collectStrings(val[k], out);
  }
}

function snapshotPhiTexts(snapshot) {
  /* Protocol free text and GRADE rationale are user-typed, so they scan in
   * user mode (a day-level date there is a patient date). Evidence values,
   * quotes and RoB quotes come from published papers and keep the default
   * literature-safe mode. There is no override on this path. */
  const userTexts = [];
  const literatureTexts = [];
  const p = snapshot && snapshot.protocol;
  if (p) {
    for (const k of ["title", "question", "pico", "design", "eligibility", "outcomes"]) {
      if (p[k] !== undefined) collectStrings(p[k], userTexts);
    }
  }
  for (const item of (snapshot && snapshot.evidence) || []) {
    for (const v of (item && item.values) || []) {
      if (!v) continue;
      if (v.value !== undefined) collectStrings(v.value, literatureTexts);
      if (typeof v.quote === "string" && v.quote) literatureTexts.push(v.quote);
    }
  }
  for (const r of (snapshot && snapshot.rob) || []) {
    if (r && typeof r.quote === "string" && r.quote) literatureTexts.push(r.quote);
  }
  for (const g of (snapshot && snapshot.grade) || []) {
    if (g && typeof g.rationale === "string" && g.rationale) userTexts.push(g.rationale);
  }
  return { userTexts, literatureTexts };
}

function scanSnapshotPhi(snapshot) {
  const hits = [];
  const texts = snapshotPhiTexts(snapshot);
  for (const text of texts.userTexts) {
    const res = scan(text, { mode: "user" });
    if (res.blocked) hits.push(...res.hits);
  }
  for (const text of texts.literatureTexts) {
    const res = scan(text);
    if (res.blocked) hits.push(...res.hits);
  }
  return { blocked: hits.length > 0, hits };
}

/* GET /v1/projects/{id}/jobs/quote?kind=manuscript_draft. The same ceiling the
 * create route reserves, with no credits held. */
export async function quoteManuscriptJob(ctx) {
  const { env, db, uid, projectId, requestId, api } = ctx;
  const { json, err, projectGate, gateErr } = api;
  if (!env || env.RESEARCH_PO_ENABLED !== "1")
    return err(404, "not_found", "Unknown Research API endpoint", requestId);
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Jobs need an owner, editor or analyst role", requestId);
  if (!isSystematicReviewStudyType(gate.project && gate.project.study_type))
    return err(409, "not_systematic_review", "Manuscript drafting jobs are only available for systematic review and meta-analysis projects", requestId);
  const quoteMicroUsd = quoteAiCall(env, "T2") * PO_CALL_BUDGET;
  return json({
    quoteMicroUsd,
    usd: quoteMicroUsd / 1000000,
    calls: PO_CALL_BUDGET,
    tier: "T2",
    requestId
  }, 200, { "x-request-id": requestId });
}

export async function createManuscriptJob(ctx, body) {
  const { env, db, uid, claims, projectId, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;

  /* 0. Feature flag checked first, before auth/project gate. */
  if (!env || env.RESEARCH_PO_ENABLED !== "1")
    return err(404, "not_found", "Unknown Research API endpoint", requestId);

  await expireLostBefore(db, uuid);

  /* 1. Write role + systematic review / meta-analysis project. */
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Jobs need an owner, editor or analyst role", requestId);
  if (!isSystematicReviewStudyType(gate.project && gate.project.study_type))
    return err(409, "not_systematic_review", "Manuscript drafting jobs are only available for systematic review and meta-analysis projects", requestId);

  /* 2. Latest protocol locked with lock_hash + at least one saved run. */
  const proto = await db.prepare("SELECT * FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
  if (!proto || proto.status !== "locked" || !proto.lock_hash)
    return err(409, "protocol_unlocked", "Lock the latest protocol before drafting a manuscript", requestId);
  const hasRun = await db.prepare("SELECT id FROM research_runs WHERE project_id=? LIMIT 1")
    .bind(projectId).first();
  if (!hasRun)
    return err(409, "no_saved_run", "Save at least one analysis run before drafting a manuscript", requestId);

  const idempotencyKey = typeof body.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!idempotencyKey || idempotencyKey.length > 120)
    return err(400, "invalid_body", "idempotencyKey must be 1-120 characters", requestId);
  if (body.runner !== undefined && body.runner !== "device" && body.runner !== "cloud" && body.runner !== "container")
    return err(400, "invalid_body", "runner must be cloud, container or device", requestId);
  const isDevice = body.runner === "device";
  const hasFallback = !isDevice && body.fallback != null && typeof body.fallback === "object" && !Array.isArray(body.fallback);
  if (!isDevice && !env.RESEARCH_QUEUE) return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
  if (isDevice && !env.RESEARCH_CALLBACK_SECRET) return err(503, "gateway_unavailable", "Research AI gateway is not configured", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);

  /* 4. Idempotent replay on (project, idempotencyKey) before active check. */
  const existing = await db.prepare("SELECT * FROM research_job_runs WHERE project_id=? AND idempotency_key=?")
    .bind(projectId, idempotencyKey).first();
  if (existing) {
    if (existing.kind !== "manuscript_draft")
      return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different job kind", requestId);
    const existingOut = parseJson(existing.output_json, {});
    const existingRunner = existingOut.runner === "device" ? "device" : "cloud";
    if ((isDevice && existingRunner !== "device") || (!isDevice && existingRunner === "device"))
      return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different runner", requestId);
    if (isDevice && existing.created_by === uid && (existing.status === "queued" || existing.status === "running")) {
      const snapObj = existing.input_r2_key ? await env.RESEARCH_R2.get(existing.input_r2_key) : null;
      const manifest = snapObj ? (typeof snapObj.json === "function" ? await snapObj.json() : JSON.parse(await snapObj.text())) : null;
      const expiresAt = Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS;
      const token = await mintJobToken(env.RESEARCH_CALLBACK_SECRET, existing.id, expiresAt);
      return json({ job: jobOf(existing), manifest, token, tokenExpiresAt: expiresAt, idempotentReplay: true, requestId },
        200, { "x-request-id": requestId });
    }
    return json({ job: jobOf(existing), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  }

  /* 3. No other manuscript_draft job queued/running for the project. */
  const active = await db.prepare("SELECT id FROM research_job_runs WHERE project_id=? AND kind='manuscript_draft' AND status IN ('queued','running') LIMIT 1")
    .bind(projectId).first();
  if (active)
    return err(409, "job_active", "A manuscript draft job is already queued or running for this project", requestId);

  /* 5. Monthly cloud fallback allowance (if fallback payload present), then daily UTC caps: 3/project, 5/user. */
  const now = Date.now();
  let fallbackAllowance = null;
  if (hasFallback) {
    const fbCheck = await checkCloudFallbackAvailable(env, db, uid, claims, now);
    if (!fbCheck.ok) return err(fbCheck.http, fbCheck.code, fbCheck.message, requestId);
    fallbackAllowance = fbCheck.status.allowance;
  }
  const capBreach = await checkPoJobCaps(db, projectId, uid, now);
  if (capBreach) return err(429, capBreach.code, capBreach.message, requestId);

  /* 6. Quote 64 calls at T2 and reserve credits. */
  const quote = quoteAiCall(env, "T2") * PO_CALL_BUDGET;
  const credits = await availableCredits(db, env, uid, claims && claims.email);
  if (credits.availableMicroUsd < quote)
    return err(402, "insufficient_credits", "Not enough research credits for this job. Top up the MaiK wallet or ask your institution admin.", requestId);
  const jobId = uuid("job_");
  const reservation = await reserveCredits(db, env, uuid, { uid, email: claims && claims.email, jobId, quote });

  /* 7-9. Build v1 manifest snapshot, run PHI gate on free-text fields only, and put snapshot in R2. */
  const snapshotKey = "projects/" + projectId + "/manuscript/snapshots/" + jobId + ".json";
  let snapshot;
  let phi;
  let r2Written = false;
  try {
    snapshot = await buildManuscriptSnapshot(db, gate.project, proto, projectId, jobId);
    phi = scanSnapshotPhi(snapshot);
    if (!phi.blocked) {
      await env.RESEARCH_R2.put(snapshotKey, JSON.stringify(snapshot), {
        httpMetadata: { contentType: "application/json" },
        customMetadata: { projectId, jobId, createdBy: uid },
      });
      r2Written = true;
    }
  } catch (e) {
    await releaseCredits(db, uuid, reservation).catch(() => {});
    if (r2Written && typeof env.RESEARCH_R2.delete === "function") {
      await env.RESEARCH_R2.delete(snapshotKey).catch(() => {});
    }
    throw e;
  }
  if (phi.blocked) {
    await releaseCredits(db, uuid, reservation);
    return json({
      error: { code: "phi_blocked", message: "Patient identifiers detected in project data; manuscript drafting was blocked.", requestId },
      categories: phiCategories(phi.hits),
    }, 422, { "x-request-id": requestId });
  }

  /* 10. Insert research_job_runs row (same bound-kind shape as pdf_extract). */
  const ceilings = { maxSeconds: PO_MAX_SECONDS, maxCalls: PO_MAX_CALLS, quoteMicroUsd: quote };
  const outputMeta = isDevice ? { runner: "device" } : (body.runner === "container" ? { runner: "container" } : {});
  let cutoffDate = null;
  if (typeof body.cutoffDate === "string") {
    const cd = body.cutoffDate.trim();
    if (CUTOFF_DATE_RE.test(cd)) {
      cutoffDate = cd;
      if (isDevice) outputMeta.cutoffDate = cd;
    }
  }
  let row;
  try {
    await db.prepare("INSERT INTO research_job_runs (id,project_id,kind,status,idempotency_key,input_r2_key,ceilings_json,output_json,created_by,created_ts) VALUES (?,?,?,'queued',?,?,?,?,?,?)")
      .bind(jobId, projectId, "manuscript_draft", idempotencyKey, snapshotKey, JSON.stringify(ceilings), JSON.stringify(outputMeta), uid, now).run();
    row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  } catch (insertErr) {
    await releaseCredits(db, uuid, reservation);
    if (typeof env.RESEARCH_R2.delete === "function") await env.RESEARCH_R2.delete(snapshotKey).catch(() => {});
    const raced = await db.prepare("SELECT * FROM research_job_runs WHERE project_id=? AND idempotency_key=?")
      .bind(projectId, idempotencyKey).first();
    if (raced) {
      if (raced.kind !== "manuscript_draft")
        return err(409, "idempotency_conflict", "This idempotencyKey was already used with a different job kind", requestId);
      return json({ job: jobOf(raced), idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
    }
    throw insertErr;
  }

  if (isDevice) {
    const expiresAt = Math.floor(Date.now() / 1000) + DEVICE_TOKEN_TTL_SECONDS;
    const token = await mintJobToken(env.RESEARCH_CALLBACK_SECRET, jobId, expiresAt);
    await audit(db, projectId, uid, "job_created", jobId, { kind: "manuscript_draft", runner: "device", quoteMicroUsd: quote });
    return json({ job: jobOf(row), manifest: snapshot, token, tokenExpiresAt: expiresAt, requestId }, 202, { "x-request-id": requestId });
  }
  if (hasFallback) {
    const fbRec = await recordCloudFallbackUsed(db, {
      uid, projectId, kind: "draft", jobId, fallback: body.fallback, allowance: fallbackAllowance, nowMs: now,
    });
    if (!fbRec.ok) {
      await releaseCredits(db, uuid, reservation);
      await db.prepare("DELETE FROM research_job_runs WHERE id=?").bind(jobId).run().catch(() => {});
      if (typeof env.RESEARCH_R2.delete === "function") await env.RESEARCH_R2.delete(snapshotKey).catch(() => {});
      return err(fbRec.http, fbRec.code, fbRec.message, requestId);
    }
  }

  /* 11. Build, validate and enqueue queue message. */
  const input = { r2Key: snapshotKey };
  if (cutoffDate) input.cutoffDate = cutoffDate;
  const message = {
    v: 1,
    jobId,
    kind: "manuscript_draft",
    projectId,
    idempotencyKey,
    createdAt: Math.floor(now / 1000),
    input,
    ceilings: { maxSeconds: PO_MAX_SECONDS, maxCalls: PO_MAX_CALLS },
  };
  if (!validateJobMessage(message)) {
    await releaseCredits(db, uuid, reservation);
    await db.prepare("UPDATE research_job_runs SET status='failed',error_code='invalid_message',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    if (hasFallback) await refundCloudFallbackForJob(db, jobId, "invalid_message").catch(() => {});
    if (typeof env.RESEARCH_R2.delete === "function") await env.RESEARCH_R2.delete(snapshotKey).catch(() => {});
    return err(500, "invalid_message", "Job message failed the contract schema", requestId);
  }
  try {
    await env.RESEARCH_QUEUE.send(message);
  } catch (queueErr) {
    await db.prepare("UPDATE research_job_runs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    await releaseCredits(db, uuid, reservation);
    if (hasFallback) await refundCloudFallbackForJob(db, jobId, "queue_unavailable").catch(() => {});
    if (typeof env.RESEARCH_R2.delete === "function") await env.RESEARCH_R2.delete(snapshotKey).catch(() => {});
    return err(503, "queue_unavailable", "Could not queue the job; retry with the same idempotency key", requestId);
  }
  await audit(db, projectId, uid, "job_created", jobId, { kind: "manuscript_draft", quoteMicroUsd: quote });
  return json({ job: jobOf(row), requestId }, 202, { "x-request-id": requestId });
}

/* GET /v1/jobs/{jobId}. Returns null when the id is not a Phase 3 job so the
 * router can fall through to the pilot research_jobs lookup. Outsiders get
 * 404 (Phase 1 convention: non-members see no project). */
export async function getJob(ctx, jobId) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, member } = api;
  await expireLostBefore(db, api.uuid);
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
  const out = parseJson(row.output_json, {});
  const now = Date.now();
  if (out.runner === "device") {
    const upd = await db.prepare(
      "UPDATE research_job_runs SET status='cancelled', cancel_requested_ts=?, completed_ts=? WHERE id=? AND status IN ('queued','running')")
      .bind(now, now, jobId).run();
    if (upd.meta && upd.meta.changes) {
      await releaseJobReserve(db, api.uuid, jobId);
      await audit(db, row.project_id, uid, "job_settled", jobId, { status: "cancelled", runner: "device" });
    }
    const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
    return json({ job: jobOf(fresh), requestId }, 200, { "x-request-id": requestId });
  }
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const cancelKey = "projects/" + row.project_id + "/jobs/" + jobId + "/cancel";
  await env.RESEARCH_R2.put(cancelKey, "", { httpMetadata: { contentType: "text/plain" } });
  await db.prepare("UPDATE research_job_runs SET cancel_requested_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(now, jobId).run();
  await audit(db, row.project_id, uid, "job_cancel_requested", jobId, {});
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  return json({ job: jobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}

async function releaseJobReserve(db, uuid, jobId) {
  const reservation = await activeJobReservation(db, jobId);
  if (!reservation) return;
  await releaseCredits(db, uuid, reservation);
}

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function validateDeviceManuscript(m) {
  if (!isPlainObject(m)) return "manuscript must be an object";
  if (m.v !== 1) return "manuscript.v must be 1";
  if (typeof m.title !== "string" || m.title.length > 500) return "manuscript.title must be a string";
  if (!Array.isArray(m.sections) || !m.sections.length) return "manuscript.sections must be a non-empty array";
  for (const s of m.sections) {
    if (!isPlainObject(s)) return "each section must be an object";
    if (typeof s.id !== "string" || !s.id.trim() || s.id.length > 80) return "section.id must be 1-80 characters";
    if (typeof s.heading !== "string" || s.heading.length > 300) return "section.heading must be a string";
    if (!Number.isInteger(s.level) || s.level < 1 || s.level > 6) return "section.level must be 1-6";
    if (typeof s.text !== "string" || s.text.length > 200000) return "section.text must be a string";
  }
  if (!Array.isArray(m.references)) return "manuscript.references must be an array";
  for (const r of m.references) {
    if (!isPlainObject(r)) return "each reference must be an object";
    if (!Number.isInteger(r.number) || r.number < 1) return "reference.number must be a positive integer";
    if (typeof r.key !== "string" || !r.key) return "reference.key is required";
    if (typeof r.citation !== "string") return "reference.citation must be a string";
    if (typeof r.doi !== "string" || typeof r.pmid !== "string") return "reference.doi and pmid must be strings";
    if (typeof r.resolved !== "boolean") return "reference.resolved must be a boolean";
  }
  if (!isPlainObject(m.tokens)) return "manuscript.tokens must be an object";
  if (!isPlainObject(m.provenance)) return "manuscript.provenance must be an object";
  if (typeof m.provenance.protocolHash !== "string") return "manuscript.provenance.protocolHash must be a string";
  if (!Array.isArray(m.provenance.runIds) || !Array.isArray(m.provenance.engines))
    return "manuscript.provenance.runIds and engines must be arrays";
  if (m.outline !== undefined && m.outline !== null && !isPlainObject(m.outline))
    return "manuscript.outline must be an object or null";
  return null;
}

function checkManifestCitations(sections, references, snapshot) {
  if (!snapshot) return [];
  const manifestIds = new Set();
  for (const ref of snapshot.references || []) {
    if (ref && ref.doi) manifestIds.add(String(ref.doi).toLowerCase());
    if (ref && ref.pmid) manifestIds.add(String(ref.pmid).toLowerCase());
  }
  for (const st of snapshot.evidence || []) {
    const src = st && st.source;
    if (src && src.doi) manifestIds.add(String(src.doi).toLowerCase());
    if (src && src.pmid) manifestIds.add(String(src.pmid).toLowerCase());
  }
  if (!manifestIds.size) return [];
  const byKey = {};
  for (const r of references || []) if (r && r.key) byKey[r.key] = r;
  const citeRe = /\\cite\{([^}]+)\}|\[@([A-Za-z0-9_:-]+)\]/g;
  const failures = [];
  for (const sec of sections || []) {
    citeRe.lastIndex = 0;
    let m;
    while ((m = citeRe.exec(sec.text || "")) !== null) {
      const raw = m[1] || m[2] || "";
      for (const key of raw.split(",").map((k) => k.trim()).filter(Boolean)) {
        const ref = byKey[key];
        if (!ref) continue;
        const doi = ref.doi ? String(ref.doi).toLowerCase() : "";
        const pmid = ref.pmid ? String(ref.pmid).toLowerCase() : "";
        if ((doi || pmid) && !manifestIds.has(doi) && !manifestIds.has(pmid)) {
          failures.push({
            type: "unresolved_citation",
            message: "Citation key " + key + " identifier is not in the frozen project snapshot.",
            key, sectionId: sec.id || "",
            location: (sec.heading || sec.id || "Section") + " section",
          });
        }
      }
    }
  }
  return failures;
}

/* POST /v1/jobs/:jobId/token — owner-only per-job token refresh for active device drafts.
 * Rate-limited to once per 60 seconds per job. */
export async function refreshJobToken(ctx, jobId) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, member } = api;
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row || !(await member(db, row.project_id, uid)))
    return err(404, "job_not_found", "Job not found", requestId);
  if (row.created_by !== uid)
    return err(403, "forbidden", "Only the job creator can refresh the draft token", requestId);
  const out = parseJson(row.output_json, {});
  if (out.runner !== "device")
    return err(409, "not_device_job", "Token refresh is only available for device-run jobs", requestId);
  if (row.status !== "queued" && row.status !== "running")
    return err(409, "job_settled", "Job is already settled", requestId);
  if (!env.RESEARCH_CALLBACK_SECRET)
    return err(503, "gateway_unavailable", "Research AI gateway is not configured", requestId);
  const now = Date.now();
  if (out.lastTokenTs && now - Number(out.lastTokenTs) < TOKEN_REFRESH_MIN_MS)
    return err(429, "rate_limited", "Token refresh is limited to once every 60 seconds.", requestId);
  const updatedOut = Object.assign({}, out, { lastTokenTs: now });
  await db.prepare("UPDATE research_job_runs SET output_json=? WHERE id=? AND status IN ('queued','running')")
    .bind(JSON.stringify(updatedOut), row.id).run();
  const expiresAt = Math.floor(now / 1000) + DEVICE_TOKEN_TTL_SECONDS;
  const token = await mintJobToken(env.RESEARCH_CALLBACK_SECRET, row.id, expiresAt);
  return json({ token, expiresAt, requestId }, 200, { "x-request-id": requestId });
}

/* POST /v1/jobs/:jobId/device-result — validate gates + shape, write result.json to R2,
 * mark succeeded, release initial hold, and ingest manuscript version. */
export async function submitDeviceResult(ctx, jobId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid, member } = api;
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row || !(await member(db, row.project_id, uid)))
    return err(404, "job_not_found", "Job not found", requestId);
  if (row.created_by !== uid)
    return err(403, "forbidden", "Only the job creator can submit the device draft", requestId);
  const out = parseJson(row.output_json, {});
  if (row.kind !== "manuscript_draft" || out.runner !== "device")
    return err(409, "not_device_job", "Only device-run manuscript jobs accept device results", requestId);
  if (row.status !== "queued" && row.status !== "running")
    return err(409, "job_settled", "Job is already settled", requestId);
  if (!env.RESEARCH_R2)
    return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  if (!isPlainObject(body))
    return err(400, "invalid_body", "Body must be an object with manuscript and usage", requestId);

  const shapeErr = validateDeviceManuscript(body.manuscript);
  if (shapeErr) return err(400, "invalid_manuscript", shapeErr, requestId);

  const u = body.usage === undefined ? {} : body.usage;
  if (!isPlainObject(u)) return err(400, "invalid_body", "usage must be an object", requestId);
  if (u.calls !== undefined && (!Number.isInteger(u.calls) || u.calls < 0))
    return err(400, "invalid_body", "usage.calls must be a non-negative integer", requestId);
  if (u.calls !== undefined && u.calls > PO_CALL_BUDGET)
    return err(422, "ceiling_calls", "Draft exceeded the 64-call ceiling.", requestId);
  if (u.seconds !== undefined && (typeof u.seconds !== "number" || !Number.isFinite(u.seconds) || u.seconds < 0))
    return err(400, "invalid_body", "usage.seconds must be a non-negative number", requestId);
  if (u.seconds !== undefined && u.seconds > PO_MAX_SECONDS)
    return err(422, "ceiling_seconds", "Draft exceeded the time ceiling.", requestId);

  const manuscript = body.manuscript;
  const phiHits = [];
  const titleScan = scan(manuscript.title || "");
  if (titleScan.blocked) phiHits.push(...titleScan.hits);
  for (const s of manuscript.sections) {
    const hs = scan((s.heading || "") + "\n" + (s.text || ""));
    if (hs.blocked) phiHits.push(...hs.hits);
  }
  if (phiHits.length) {
    const categories = phiCategories(phiHits);
    await audit(db, row.project_id, uid, "device_result_phi_blocked", row.id, { categories });
    return json({
      error: { code: "phi_blocked", message: "Patient identifiers detected in drafted manuscript.", requestId },
      categories,
    }, 422, { "x-request-id": requestId });
  }

  let snapshot = null;
  if (row.input_r2_key) {
    try {
      const snapObj = await env.RESEARCH_R2.get(row.input_r2_key);
      if (snapObj) {
        snapshot = typeof snapObj.json === "function" ? await snapObj.json() : JSON.parse(await snapObj.text());
      }
    } catch { snapshot = null; }
  }
  if (snapshot && snapshot.protocol && snapshot.protocol.lockHash &&
      manuscript.provenance.protocolHash !== snapshot.protocol.lockHash) {
    return err(400, "invalid_manuscript", "manuscript.provenance.protocolHash does not match the frozen snapshot", requestId);
  }

  const table = await tokenTable(db, row.project_id, {});
  const gateReport = gateManuscript(manuscript.sections, manuscript.references, table);
  const snapCiteFailures = checkManifestCitations(manuscript.sections, manuscript.references, snapshot);
  const allFailures = gateReport.gateFailures.concat(snapCiteFailures);
  if (allFailures.length) {
    return json({
      error: { code: "gate_failed", message: "Manuscript failed integrity gates.", requestId },
      gatesPassed: false,
      gateFailures: allFailures,
    }, 422, { "x-request-id": requestId });
  }

  const usageObj = {
    pages: 0,
    seconds: Number(u.seconds) || 0,
    calls: Number.isInteger(u.calls) ? u.calls : 0,
    inputTokens: Number.isInteger(u.inputTokens) ? u.inputTokens : 0,
    outputTokens: Number.isInteger(u.outputTokens) ? u.outputTokens : 0,
  };
  const resultKey = "projects/" + row.project_id + "/jobs/" + row.id + "/result.json";
  const storedPayload = {
    jobId: row.id,
    idempotencyKey: row.idempotency_key,
    status: "done",
    usage: usageObj,
    draft: manuscript,
  };
  await env.RESEARCH_R2.put(resultKey, JSON.stringify(storedPayload), {
    httpMetadata: { contentType: "application/json" },
    customMetadata: { projectId: row.project_id, jobId: row.id, runner: "device" },
  });

  const now = Date.now();
  const nextOut = Object.assign({}, out, { runner: "device", resultKey, usage: usageObj });
  const upd = await db.prepare(
    "UPDATE research_job_runs SET status='succeeded',output_json=?,result_r2_key=?,usage_json=?,error_code='',completed_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(JSON.stringify(nextOut), resultKey, JSON.stringify(usageObj), now, row.id).run();
  if (!upd.meta || !upd.meta.changes) {
    const raced = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.id).first();
    return err(409, "job_settled", "Job settled concurrently (status: " + (raced && raced.status) + ")", requestId);
  }
  await releaseJobReserve(db, uuid, row.id);
  await env.RESEARCH_R2.delete("projects/" + row.project_id + "/jobs/" + row.id + "/cancel").catch(() => {});

  const versionId = await ingestManuscriptJob({ db, env, api, requestId }, Object.assign({}, row, {
    status: "succeeded", result_r2_key: resultKey,
  }));
  await audit(db, row.project_id, uid, "job_settled", row.id, { status: "succeeded", runner: "device", usage: usageObj });
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.id).first();
  return json({ job: jobOf(fresh), versionId, requestId }, 200, { "x-request-id": requestId });
}

/* POST /v1/jobs/:jobId/device-fail — marks a device job failed with a stable code
 * and releases the initial hold. device_failed is excluded from daily caps. */
export async function failDeviceJob(ctx, jobId, body) {
  const { env, db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid, member } = api;
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row || !(await member(db, row.project_id, uid)))
    return err(404, "job_not_found", "Job not found", requestId);
  if (row.created_by !== uid)
    return err(403, "forbidden", "Only the job creator can fail this device job", requestId);
  const out = parseJson(row.output_json, {});
  if (row.kind !== "manuscript_draft" || out.runner !== "device")
    return err(409, "not_device_job", "Only device-run manuscript jobs accept device-fail", requestId);
  if (!isPlainObject(body) || typeof body.code !== "string" || DEVICE_FAIL_CODES.indexOf(body.code) < 0)
    return err(400, "invalid_body", "code must be one of " + DEVICE_FAIL_CODES.join(", "), requestId);
  const step = body.step === undefined || body.step === null ? "" : body.step;
  if (typeof step !== "string" || step.length > 80)
    return err(400, "invalid_body", "step must be a string of at most 80 characters", requestId);

  if (SETTLED.indexOf(row.status) >= 0)
    return json({ job: jobOf(row), replay: true, requestId }, 200, { "x-request-id": requestId });

  const now = Date.now();
  const nextOut = Object.assign({}, out, { runner: "device", failedStep: step });
  const upd = await db.prepare(
    "UPDATE research_job_runs SET status='failed',error_code=?,output_json=?,completed_ts=? WHERE id=? AND status IN ('queued','running')")
    .bind(body.code, JSON.stringify(nextOut), now, row.id).run();
  if (!upd.meta || !upd.meta.changes) {
    const raced = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.id).first();
    return json({ job: jobOf(raced), replay: true, requestId }, 200, { "x-request-id": requestId });
  }
  await releaseJobReserve(db, uuid, row.id);
  if (env.RESEARCH_R2) {
    await env.RESEARCH_R2.delete("projects/" + row.project_id + "/jobs/" + row.id + "/cancel").catch(() => {});
  }
  await audit(db, row.project_id, uid, "job_settled", row.id, { status: "failed", runner: "device", errorCode: body.code, step });
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.id).first();
  return json({ job: jobOf(fresh), requestId }, 200, { "x-request-id": requestId });
}

/* POST /v1/jobs/{jobId}/to-cloud (Phase 04).
 * Owner-only conversion of an on-device manuscript_draft job to runner "container"
 * after checking monthly cloud fallback allowance and daily caps. Preserves jobId
 * so research_job_steps cached from the device run hit at $0 in the gateway. */
export async function convertJobToCloud(ctx, jobId, body) {
  const { env, db, uid, claims, requestId, api } = ctx;
  const { json, err, audit, uuid, member } = api;
  await expireLostBefore(db, uuid);
  const row = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(jobId).first();
  if (!row || !(await member(db, row.project_id, uid)))
    return err(404, "job_not_found", "Job not found", requestId);
  if (row.created_by !== uid)
    return err(403, "forbidden", "Only the job owner can move this job to cloud", requestId);
  if (row.kind !== "manuscript_draft")
    return err(409, "wrong_kind", "Only manuscript draft jobs can move to cloud", requestId);
  if (row.status === "succeeded" || row.status === "cancelled")
    return err(409, "job_settled", "This job is already finished", requestId);

  const out = parseJson(row.output_json, {});
  if (out.runner === "container" || out.runner === "cloud") {
    return err(409, "already_converted", "This job has already been moved to cloud", requestId);
  }
  if (out.runner !== "device") {
    return err(409, "not_device_job", "Only device-run manuscript jobs can move to cloud", requestId);
  }
  if (!env.RESEARCH_QUEUE)
    return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
  if (!row.input_r2_key)
    return err(409, "snapshot_missing", "Manuscript snapshot is missing for this job", requestId);

  const now = Date.now();
  const fbCheck = await checkCloudFallbackAvailable(env, db, uid, claims, now);
  if (!fbCheck.ok) return err(fbCheck.http, fbCheck.code, fbCheck.message, requestId);

  const capBreach = await checkPoJobCaps(db, row.project_id, uid, now, row.id);
  if (capBreach) return err(429, capBreach.code, capBreach.message, requestId);

  /* Check if a credit hold is still active; failed device jobs released theirs.
   * Gate strictly on reserve/release rows (ignoring settled gateway charges). */
  const activeHold = await activeJobReservation(db, row.id);
  let reserveQuote = 0;
  if (!activeHold) {
    const ceilingsJson = parseJson(row.ceilings_json, {});
    reserveQuote = Number(ceilingsJson.quoteMicroUsd) > 0
      ? Number(ceilingsJson.quoteMicroUsd)
      : quoteAiCall(env, "T2") * PO_MAX_CALLS;
    const credits = await availableCredits(db, env, uid, claims && claims.email);
    if (credits.availableMicroUsd < reserveQuote)
      return err(402, "insufficient_credits", "Not enough research credits for this job. Top up the MaiK wallet or ask your institution admin.", requestId);
  }

  const fallbackMeta = isPlainObject(body) && isPlainObject(body.fallback) ? body.fallback : {};
  const fbRec = await recordCloudFallbackUsed(db, {
    uid, projectId: row.project_id, kind: "draft", jobId: row.id, fallback: fallbackMeta,
    allowance: fbCheck.status.allowance, nowMs: now,
  });
  if (!fbRec.ok) return err(fbRec.http, fbRec.code, fbRec.message, requestId);

  let newReservation = null;
  if (!activeHold) {
    newReservation = await reserveCredits(db, env, uuid, { uid, email: claims && claims.email, jobId: row.id, quote: reserveQuote });
  }

  const prevStatus = row.status;
  const prevError = row.error_code || "";
  const prevCompleted = row.completed_ts || null;
  const prevStarted = row.started_ts || null;
  const prevCreatedTs = row.created_ts;
  const nextOut = Object.assign({}, out, { runner: "container" });
  delete nextOut.failedStep;
  let cutoffDate = out.cutoffDate || null;
  if (isPlainObject(body) && typeof body.cutoffDate === "string" && /^\d{4}-(?:0[1-9]|1[0-2])$/.test(body.cutoffDate.trim())) {
    cutoffDate = body.cutoffDate.trim();
    nextOut.cutoffDate = cutoffDate;
  }

  const upd = await db.prepare(
    "UPDATE research_job_runs SET status='queued', error_code='', started_ts=NULL, completed_ts=NULL, cancel_requested_ts=NULL, created_ts=?, output_json=? WHERE id=? AND status IN ('queued','running','failed') AND output_json NOT LIKE '%\"runner\":\"container\"%' AND output_json NOT LIKE '%\"runner\":\"cloud\"%'")
    .bind(now, JSON.stringify(nextOut), row.id).run();
  if (!upd.meta || !upd.meta.changes) {
    if (newReservation) await releaseCredits(db, uuid, newReservation);
    await db.prepare("DELETE FROM research_cloud_fallbacks WHERE id=?").bind(fbRec.id).run().catch(() => {});
    return err(409, "already_converted", "This job has already been moved to cloud", requestId);
  }

  const input = { r2Key: row.input_r2_key };
  if (cutoffDate) input.cutoffDate = cutoffDate;
  const message = {
    v: 1,
    jobId: row.id,
    kind: "manuscript_draft",
    projectId: row.project_id,
    idempotencyKey: row.idempotency_key,
    createdAt: Math.floor(now / 1000),
    input,
    ceilings: { maxSeconds: PO_MAX_SECONDS, maxCalls: PO_MAX_CALLS },
  };
  if (!validateJobMessage(message)) {
    if (newReservation) await releaseCredits(db, uuid, newReservation);
    await db.prepare(
      "UPDATE research_job_runs SET status=?, error_code=?, started_ts=?, completed_ts=?, created_ts=?, output_json=? WHERE id=?")
      .bind(prevStatus, prevError, prevStarted, prevCompleted, prevCreatedTs, JSON.stringify(out), row.id).run();
    await refundCloudFallbackForJob(db, row.id, "invalid_message").catch(() => {});
    return err(500, "invalid_message", "Job message failed the contract schema", requestId);
  }
  try {
    await env.RESEARCH_QUEUE.send(message);
  } catch (queueErr) {
    if (newReservation) await releaseCredits(db, uuid, newReservation);
    await db.prepare("UPDATE research_job_runs SET status='failed', error_code='queue_unavailable', completed_ts=? WHERE id=?")
      .bind(Date.now(), row.id).run();
    await refundCloudFallbackForJob(db, row.id, "queue_unavailable").catch(() => {});
    return err(503, "queue_unavailable", "Could not queue the job; retry with the same idempotency key", requestId);
  }
  await audit(db, row.project_id, uid, "job_moved_to_cloud", row.id, { kind: "manuscript_draft", runner: "container" });
  const fresh = await db.prepare("SELECT * FROM research_job_runs WHERE id=?").bind(row.id).first();
  return json({ job: jobOf(fresh), requestId }, 202, { "x-request-id": requestId });
}
