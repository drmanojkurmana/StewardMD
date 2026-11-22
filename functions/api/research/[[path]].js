/* StewardMD Research API edge.
 * Production is fail-closed until RESEARCH_ENABLED=1, RESEARCH_PILOT_MODE=1 and
 * dedicated RESEARCH_DB / RESEARCH_R2 / RESEARCH_QUEUE bindings are provisioned.
 * Firebase ID token is verified here; project membership is checked on every resource.
 */
import { verifyFirebaseClaims } from "../../_fbauth.js";

const MAX_JSON = 1024 * 1024;
const MAX_PDF = 25 * 1024 * 1024;
const JSON_HEADERS = { "content-type": "application/json; charset=utf-8", "cache-control": "no-store",
  "x-content-type-options": "nosniff", "referrer-policy": "no-referrer" };
const json = (body, status = 200, extra = {}) =>
  new Response(JSON.stringify(body), { status, headers: { ...JSON_HEADERS, ...extra } });
const uuid = (prefix) => prefix + crypto.randomUUID().replace(/-/g, "");
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) return false;
  let x = 0; for (let i = 0; i < a.length; i++) x |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return x === 0;
}
async function caller(request, env) {
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  if (!token) return null;
  return verifyFirebaseClaims(token, env);
}
async function member(db, projectId, uid, roles = ["owner", "editor", "analyst", "reviewer", "viewer"]) {
  const row = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(projectId, uid).first();
  return row && roles.includes(row.role) ? row : null;
}
async function bodyJson(request) {
  const bytes = await request.arrayBuffer();
  if (bytes.byteLength > MAX_JSON) throw new Error("payload_too_large");
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_json");
  return body;
}
function err(status, code, message, requestId) {
  return json({ error: { code, message, requestId } }, status, { "x-request-id": requestId });
}
async function audit(db, projectId, uid, eventType, resourceId, metadata = {}) {
  await db.prepare("INSERT INTO research_audit_events (id,project_id,actor_uid,event_type,resource_id,metadata_json,created_ts) VALUES (?,?,?,?,?,?,?)")
    .bind(uuid("aud_"), projectId, uid, eventType, resourceId || "", JSON.stringify(metadata), Date.now()).run();
}

async function createProject(db, uid, body) {
  const title = String(body.title || "").trim();
  if (!title || title.length > 180) return { error: "title must be 1–180 characters" };
  const discipline = String(body.discipline || "medicine").slice(0, 40);
  const specialty = String(body.specialty || "").slice(0, 80);
  const studyType = String(body.studyType || "").slice(0, 80);
  const question = String(body.researchQuestion || "").slice(0, 2000);
  const id = uuid("prj_"), now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO research_projects (id,owner_uid,title,discipline,specialty,study_type,research_question,status,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,'active',?,?)")
      .bind(id, uid, title, discipline, specialty, studyType, question, now, now),
    db.prepare("INSERT INTO research_members (project_id,uid,role,created_ts) VALUES (?,?, 'owner', ?)")
      .bind(id, uid, now),
    db.prepare("INSERT INTO research_audit_events (id,project_id,actor_uid,event_type,resource_id,metadata_json,created_ts) VALUES (?,?,?,'project.created',?,'{}',?)")
      .bind(uuid("aud_"), id, uid, id, now),
  ]);
  return { project: { id, title, discipline, specialty, studyType, role: "owner", createdAt: now } };
}

async function uploadPaper(request, env, db, uid, projectId, requestId) {
  if (!(await member(db, projectId, uid, ["owner", "editor", "analyst"]))) return err(403, "forbidden", "Project access denied", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart PDF upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one PDF in the file field", requestId);
  if (file.size < 8 || file.size > MAX_PDF) return err(413, "file_size", "PDF must be smaller than 25 MiB", requestId);
  const head = new Uint8Array(await file.slice(0, 5).arrayBuffer());
  if (new TextDecoder().decode(head) !== "%PDF-") return err(415, "file_type", "Only valid PDF files are accepted", requestId);
  const artifactId = uuid("art_"), key = "projects/" + projectId + "/papers/" + artifactId + ".pdf";
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map(x => x.toString(16).padStart(2, "0")).join("");
  await env.RESEARCH_R2.put(key, bytes, { httpMetadata: { contentType: "application/pdf" },
    customMetadata: { projectId, artifactId, uploadedBy: uid, sha256 } });
  try {
    await db.prepare("INSERT INTO research_artifacts (id,project_id,artifact_type,object_key,content_type,sha256,bytes,created_by,created_ts) VALUES (?,?, 'source_pdf', ?, 'application/pdf', ?,?,?,?)")
      .bind(artifactId, projectId, key, sha256, file.size, uid, Date.now()).run();
    await audit(db, projectId, uid, "paper.uploaded", artifactId, { bytes: file.size, sha256 });
  } catch (e) {
    await env.RESEARCH_R2.delete(key).catch(() => {});
    throw e;
  }
  return json({ artifact: { id: artifactId, type: "source_pdf", bytes: file.size, sha256 }, requestId }, 201, { "x-request-id": requestId });
}

async function submitMetaAnalysis(db, queue, uid, projectId, body, requestId) {
  if (!(await member(db, projectId, uid, ["owner", "editor", "analyst"]))) return err(403, "forbidden", "Project access denied", requestId);
  const idempotencyKey = String(body.idempotencyKey || "").trim();
  if (!idempotencyKey || idempotencyKey.length > 120) return err(400, "idempotency_required", "Provide an idempotencyKey", requestId);
  const analysis = body.analysis;
  if (!analysis || !["OR", "RR", "HR", "MD", "SMD"].includes(analysis.effect_measure) ||
      !["fixed", "random_dl"].includes(analysis.model || "random_dl") ||
      !Array.isArray(analysis.studies) || analysis.studies.length < 2 || analysis.studies.length > 500) {
    return err(400, "invalid_analysis", "Provide 2–500 studies, a supported effect measure and pooling model", requestId);
  }
  const existing = await db.prepare("SELECT id,status FROM research_jobs WHERE project_id=? AND idempotency_key=?")
    .bind(projectId, idempotencyKey).first();
  if (existing) return json({ jobId: existing.id, status: existing.status, idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  const jobId = uuid("job_"), analysisId = uuid("ma_"), now = Date.now();
  const input = JSON.stringify({ effect_measure: analysis.effect_measure, model: analysis.model || "random_dl",
    confidence_level: analysis.confidence_level || 0.95, studies: analysis.studies });
  const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const inputHash = [...new Uint8Array(hashBytes)].map(x => x.toString(16).padStart(2, "0")).join("");
  try {
    await db.batch([
      db.prepare("INSERT INTO research_jobs (id,project_id,job_type,status,idempotency_key,input_json,created_by,created_ts) VALUES (?,?, 'meta_analysis','queued',?,?,?,?)")
        .bind(jobId, projectId, idempotencyKey, JSON.stringify({ analysisId }), uid, now),
      db.prepare("INSERT INTO research_meta_analyses (id,project_id,job_id,model,effect_measure,input_hash,input_json,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(analysisId, projectId, jobId, analysis.model || "random_dl", analysis.effect_measure, inputHash, input, uid, now),
    ]);
  } catch (e) {
    const raced = await db.prepare("SELECT id,status FROM research_jobs WHERE project_id=? AND idempotency_key=?")
      .bind(projectId, idempotencyKey).first();
    if (raced) return json({ jobId: raced.id, status: raced.status, idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
    throw e;
  }
  try {
    await queue.send({ type: "meta-analysis", jobId, analysisId, projectId, input: JSON.parse(input), requestedBy: uid, requestId });
  } catch (e) {
    await db.prepare("UPDATE research_jobs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    return err(503, "queue_unavailable", "Could not queue analysis; retry with the same idempotency key", requestId);
  }
  await audit(db, projectId, uid, "meta_analysis.submitted", analysisId, { model: analysis.model || "random_dl", studies: analysis.studies.length });
  return json({ jobId, analysisId, status: "queued", requestId }, 202, { "x-request-id": requestId });
}

export async function onRequest({ request, env, params }) {
  const requestId = request.headers.get("x-request-id") || uuid("req_");
  if (env.RESEARCH_ENABLED !== "1" || env.RESEARCH_PILOT_MODE !== "1")
    return err(404, "not_found", "Research pilot is not enabled", requestId);
  if (!env.RESEARCH_DB) return err(503, "database_unavailable", "Research database is not provisioned", requestId);
  const db = env.RESEARCH_DB;
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = "/" + parts.join("/");

  // Queue consumer callback: internal service-to-service auth, no Firebase token.
  const callback = path.match(/^\/v1\/internal\/jobs\/([^/]+)\/complete$/);
  if (callback && request.method === "POST") {
    if (!env.RESEARCH_CALLBACK_TOKEN || !safeEqual(request.headers.get("x-research-callback-token") || "", env.RESEARCH_CALLBACK_TOKEN))
      return err(401, "unauthorized", "Invalid callback credentials", requestId);
    const body = await bodyJson(request);
    const job = await db.prepare("SELECT id,project_id FROM research_jobs WHERE id=? AND job_type='meta_analysis'").bind(callback[1]).first();
    if (!job) return err(404, "job_not_found", "Job not found", requestId);
    const analysisRow = await db.prepare("SELECT id FROM research_meta_analyses WHERE job_id=?").bind(job.id).first();
    if (!analysisRow || analysisRow.id !== body.analysisId) return err(409, "callback_mismatch", "Callback does not match the analysis job", requestId);
    const now = Date.now();
    const succeeded = body.status === "succeeded" && body.result && typeof body.result === "object";
    const terminalStatus = succeeded ? "succeeded" : "failed";
    await db.batch([
      db.prepare("UPDATE research_jobs SET status=?,output_json=?,error_code=?,completed_ts=? WHERE id=? AND status IN ('queued','running')")
        .bind(terminalStatus, JSON.stringify({ analysisId: body.analysisId }), succeeded ? "" : String(body.errorCode || "analysis_failed").slice(0, 80), now, job.id),
      db.prepare("UPDATE research_meta_analyses SET result_json=?,completed_ts=? WHERE job_id=?")
        .bind(JSON.stringify(succeeded ? body.result : { error: body.errorCode || "analysis_failed" }), now, job.id),
    ]);
    return json({ ok: true, requestId }, 200, { "x-request-id": requestId });
  }

  const claims = await caller(request, env);
  if (!claims || !claims.sub) return err(401, "unauthorized", "Sign in to use StewardMD Research", requestId);
  const uid = claims.sub;

  if (path === "/v1/projects" && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid project payload", requestId); }
    const out = await createProject(db, uid, body);
    return out.error ? err(400, "invalid_project", out.error, requestId) : json({ ...out, requestId }, 201, { "x-request-id": requestId });
  }

  const paper = path.match(/^\/v1\/projects\/([^/]+)\/papers$/);
  if (paper && request.method === "POST") return uploadPaper(request, env, db, uid, paper[1], requestId);

  const meta = path.match(/^\/v1\/projects\/([^/]+)\/meta-analyses$/);
  if (meta && request.method === "POST") {
    if (!env.RESEARCH_QUEUE) return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid analysis payload", requestId); }
    return submitMetaAnalysis(db, env.RESEARCH_QUEUE, uid, meta[1], body, requestId);
  }

  const resultMatch = path.match(/^\\/v1\\/projects\\/([^/]+)\\/meta-analyses\\/([^/]+)$/);
  if (resultMatch && request.method === "GET") {
    if (!(await member(db, resultMatch[1], uid))) return err(404, "analysis_not_found", "Analysis not found", requestId);
    const row = await db.prepare("SELECT id,job_id,model,effect_measure,input_hash,result_json,created_ts,completed_ts FROM research_meta_analyses WHERE id=? AND project_id=?")
      .bind(resultMatch[2], resultMatch[1]).first();
    if (!row) return err(404, "analysis_not_found", "Analysis not found", requestId);
    return json({ analysis: { ...row, result: JSON.parse(row.result_json || "{}") }, requestId }, 200, { "x-request-id": requestId });
  }

  const jobMatch = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (jobMatch && request.method === "GET") {
    const job = await db.prepare("SELECT j.id,j.project_id,j.job_type,j.status,j.output_json,j.error_code,j.created_ts,j.completed_ts FROM research_jobs j WHERE j.id=?")
      .bind(jobMatch[1]).first();
    if (!job || !(await member(db, job.project_id, uid))) return err(404, "job_not_found", "Job not found", requestId);
    return json({ job, requestId }, 200, { "x-request-id": requestId });
  }
  return err(404, "not_found", "Unknown Research API endpoint", requestId);
}
