/* StewardMD Research API edge.
 * Production is fail-closed until RESEARCH_ENABLED=1, RESEARCH_PILOT_MODE=1 and
 * dedicated RESEARCH_DB / RESEARCH_R2 / RESEARCH_QUEUE bindings are provisioned.
 * Firebase ID token is verified here; project membership is checked on every resource.
 *
 * Phase 1.3 (docs/research/contracts/phase-1): projects, members, studies CRUD
 * with optimistic-concurrency version (HTTP 409 on stale), runs computed
 * server-side by importing research-engine.js through ./_engine.js (HTTP 422 on
 * unverified or unpoolable), manifests stored, audit events on every mutation.
 * The Phase 3 async queue workflow (papers, meta-analyses, jobs) stays live below.
 *
 * Phase 2 (docs/research/contracts/phase-2): protocols (versioned, one-way lock
 * with SHA-256 hash, PROSPERO export), invitations + roles, database searches
 * through ./_connectors/ (full ID archive in R2, D1 fallback when R2 is absent),
 * RIS/BibTeX/CSV import, deterministic dedup (./_dedup.js), blinded dual
 * screening with auto-conflicts and owner/editor resolution, exclusion reasons,
 * and PRISMA 2020 counts read from the research_prisma_counts view.
 * Connector credentials come from env only: RESEARCH_CONTACT_EMAIL (required),
 * RESEARCH_NCBI_API_KEY (optional), RESEARCH_CROSSREF_TOKEN (optional Plus).
 * Integration additions (2026-11-23, contract-additions.md): GET protocol
 * version list and POST import-uploads (multipart -> R2 -> {storageKey}).
 */
import { verifyFirebaseClaims } from "../../_fbauth.js";
import { run as engineRun, version as ENGINE_VERSION } from "./_engine.js";
import * as pubmedConnector from "./_connectors/pubmed.js";
import * as europepmcConnector from "./_connectors/europepmc.js";
import * as crossrefConnector from "./_connectors/crossref.js";
import * as s2Connector from "./_connectors/semanticscholar.js";
import { parseImport, matchesExistingRecord } from "./_connectors/import.js";
import { dedupRecords, normaliseDoi } from "./_dedup.js";
/* Phase 3 server side (docs/research/contracts/phase-3): jobs v2 + PDFs
 * (_jobs.js), HMAC worker callback (_callback.js), ceilings and daily caps
 * (_caps.js), credit lifecycle on the MaiK wallet + institution ledger
 * (_credits.js), PHI gate (_phi.js) and the central AI gateway (_gateway.js,
 * reusing callGemini from ../ai/[[path]].js). The pilot routes below are
 * untouched; Phase 3 jobs live in research_job_runs (0003 header decision). */
import { uploadPdf, createJob, getJob, cancelJob } from "./_jobs.js";
import { jobCallback } from "./_callback.js";
import { llmRoute, literatureSearchRoute } from "./_gateway.js";
import { adminInstitutionRoute, creditsView } from "./_credits.js";
/* Phase 3.4/3.5/3.6/3.8 + Phase 4.3 (docs/research/contracts/phase-3 and
 * phase-4/grade.md): extraction (_extraction.js), T1 suggestions (_suggest.js),
 * risk of bias (_rob.js), study-level data import (_data.js) and GRADE
 * (_grade.js). Small route hooks below; every route verifies Firebase claims
 * (above) and the project role, and an outsider gets 404. */
import { extractionTemplates, getExtraction, putExtraction, verifyExtraction,
  correctExtraction, extractionAudit, acceptSuggestion, promoteExtraction,
  listArtifacts, uploadPdfArtifact, artifactResult } from "./_extraction.js";
import { extractionSuggestions, screeningSuggestion, listScreeningSuggestions } from "./_suggest.js";
import { robTools, getRob, submitRob, listRobConflicts, resolveRobConflict, robAudit } from "./_rob.js";
import { getDictionary, putDictionary, uploadData, createDataImport,
  listDataImports, getDataImport, getDataSnapshot, freezeDataImport } from "./_data.js";
import { listGrade, getGrade, putGrade, summaryOfFindings, gradeSuggestions } from "./_grade.js";
/* Phase 6 (docs/research/contracts/phase-6): IPD compliance (_ipd.js, 5C.2/5C.3),
 * credit purchase + institution invoicing (_purchase.js, 6.1), cost reports
 * (_reports.js, 6.3), institution workspaces (_institutions.js, 6.5), study
 * templates (_templates.js, 5D.1), journals (_journals.js, 5B.3) and the
 * reviewer-response workspace (_responses.js, 5B.5). Small route hooks below;
 * every user route verifies Firebase claims (above) and the project or
 * institution role, and an outsider gets 404. Admin routes use adminAuth
 * (the existing research admin token OR the app's owner claim). */
import { uploadEvidence, listEvidence, getEvidence, evidenceFile, decideEvidence,
  putIpdConfig, getIpdConfig, uploadIpd, listIpdDatasets, getIpdDataset, ipdSnapshot,
  ipdAccessLog, createStatsJob, getStatsJob, cancelStatsJob, statsJobCallback,
  createIncident, listIncidents, getIncident, updateIncidentStatus } from "./_ipd.js";
import { purchasePacks, purchaseOrder, purchaseIapVerify, grantCreditsRoute,
  createInvoice, listInvoices, markInvoicePaid } from "./_purchase.js";
import { projectCostReport, userCostReport, pricingNote } from "./_reports.js";
import { createInstitution, listAllInstitutions, myInstitutions, getInstitutionRoute,
  institutionSeats, addInstitutionMember, updateInstitutionMember, removeInstitutionMember,
  listInstitutionProjects, createInstitutionProject, institutionOnboarding,
  putInstitutionOnboarding } from "./_institutions.js";
import { listTemplates, getTemplate } from "./_templates.js";
import { listJournals, getJournal, matchJournals } from "./_journals.js";
import { createComment, listComments, createResponse, listResponses,
  listProjectResponses, updateResponse } from "./_responses.js";
/* Phase 5A.3 / 5B (docs/research/contracts/phase-5/manuscript-api.md):
 * manuscript versions (_manuscript.js) and reporting checklists
 * (_checklists.js). Firebase auth is the block above; each project route
 * uses projectGate and an outsider gets 404. */
import { listVersions, getManuscript, putSection, requestApproval, approveManuscript,
  lockManuscript, manuscriptGates, exportManuscript } from "./_manuscript.js";
import { listChecklists, getChecklist, checklistSnapshot, getManual, putManual } from "./_checklists.js";
import { findStudies, autoAddStudies } from "./_auto_studies.js";
import { aiDraft } from "./_ai_draft.js";
import { paperCard, explainPaperCard } from "./_paper_card.js";
import { formatCheck } from "./_format_check.js";

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
  return row && roles.indexOf(row.role) >= 0 ? row : null;
}
async function getProject(db, id) {
  return db.prepare("SELECT * FROM research_projects WHERE id=? AND status!='deleted'").bind(id).first();
}
async function bodyJson(request) {
  const announced = Number(request.headers.get("content-length") || 0);
  if (announced > MAX_JSON) throw new Error("payload_too_large");
  if (!request.body) throw new Error("invalid_json");
  const reader = request.body.getReader(), chunks = [];
  let size = 0;
  while (true) {
    const part = await reader.read();
    if (part.done) break;
    size += part.value.byteLength;
    if (size > MAX_JSON) { await reader.cancel(); throw new Error("payload_too_large"); }
    chunks.push(part.value);
  }
  const bytes = new Uint8Array(size);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  const body = JSON.parse(new TextDecoder().decode(bytes));
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("invalid_json");
  return body;
}
function err(status, code, message, requestId) {
  return json({ error: { code, message, requestId } }, status, { "x-request-id": requestId });
}
function staleConflict(row, requestId) {
  return json({ error: { code: "stale_version", message: "Study changed on the server", requestId },
    current: { study: studyOf(row) } }, 409, { "x-request-id": requestId });
}
async function audit(db, projectId, uid, eventType, resourceId, metadata = {}) {
  await db.prepare("INSERT INTO research_audit_events (id,project_id,actor_uid,event_type,resource_id,metadata_json,created_ts) VALUES (?,?,?,?,?,?,?)")
    .bind(uuid("aud_"), projectId, uid, eventType, resourceId || "", JSON.stringify(metadata), Date.now()).run();
}

/* Phase 1 contract constants (docs/research/contracts/phase-1/errors.md). */
const MEASURES = { OR: 1, RR: 1, HR: 1, RD: 1, MD: 1, SMD: 1 };
const MODELS = { fixed: 1, random_dl: 1, random_reml: 1 };
const TESTS = { wald: 1, knha: 1 };
const WRITE_ROLES = ["owner", "editor", "analyst"];
const ASSIGNABLE_ROLES = ["editor", "analyst", "reviewer", "viewer"];

/* Pagination (?limit 1-100 default 20, opaque ?cursor). Studies order by
 * updated_ts DESC, runs and projects likewise; cursor is {ts, id}. */
function pageParams(url) {
  let limit = parseInt(url.searchParams.get("limit") || "20", 10);
  if (!Number.isFinite(limit)) limit = 20;
  limit = Math.max(1, Math.min(100, limit));
  let cursor = null;
  const raw = url.searchParams.get("cursor") || "";
  if (raw) {
    try {
      const decoded = JSON.parse(new TextDecoder().decode(
        Uint8Array.from(atob(raw), (c) => c.charCodeAt(0))));
      if (decoded && typeof decoded.ts === "number") cursor = decoded;
    } catch (e) { cursor = null; }
  }
  return { limit, cursor };
}
function encodeCursor(ts, id) {
  const bytes = new TextEncoder().encode(JSON.stringify({ ts, id }));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
function pageBody(items, key, limit, tsOf, requestId) {
  const body = {};
  body[key] = items.slice(0, limit);
  body.requestId = requestId;
  if (items.length > limit) {
    const last = body[key][body[key].length - 1];
    body.nextCursor = encodeCursor(tsOf(last), last.id);
  }
  return body;
}

function isFin(n) { return typeof n === "number" && Number.isFinite(n); }
function isInt(n) { return typeof n === "number" && Number.isInteger(n); }

/* Evidence locator (contracts/phase-1/locator.schema.json): manual in Phase 1,
 * pdf block accepted and preserved for Phase 3. */
function validateLocator(loc) {
  if (!loc || typeof loc !== "object" || Array.isArray(loc)) return "locator is required";
  if (loc.kind !== "manual" && loc.kind !== "pdf") return "locator.kind must be manual or pdf";
  if (typeof loc.citation !== "string" || !loc.citation.trim() || loc.citation.length > 500)
    return "locator.citation must be 1-500 characters";
  if (loc.page !== undefined && typeof loc.page !== "string" && !isInt(loc.page))
    return "locator.page must be a string or integer";
  if (loc.section !== undefined && (typeof loc.section !== "string" || loc.section.length > 200))
    return "locator.section must be at most 200 characters";
  if (loc.table !== undefined && (typeof loc.table !== "string" || loc.table.length > 200))
    return "locator.table must be at most 200 characters";
  if (loc.quote !== undefined && (typeof loc.quote !== "string" || loc.quote.length > 2000))
    return "locator.quote must be at most 2000 characters";
  if (loc.pdf !== undefined && loc.pdf !== null) {
    const pdf = loc.pdf;
    if (!pdf || typeof pdf !== "object" || Array.isArray(pdf)) return "locator.pdf must be an object";
    if (typeof pdf.artifactId !== "string" || !pdf.artifactId) return "locator.pdf.artifactId is required";
    if (!isInt(pdf.page) || pdf.page < 1) return "locator.pdf.page must be an integer of at least 1";
    if (pdf.box !== undefined) {
      const box = pdf.box;
      if (!box || typeof box !== "object") return "locator.pdf.box must be an object";
      for (const k of ["x", "y", "w", "h"]) {
        if (!(typeof box[k] === "number" && box[k] >= 0 && box[k] <= 1))
          return "locator.pdf.box." + k + " must be between 0 and 1";
      }
    }
  }
  return null;
}

/* Study inputs: exactly one of rawCounts / rawMeans / reported / generic,
 * with the measure match the engine needs. */
function validateInputs(measure, inputs) {
  if (!inputs || typeof inputs !== "object" || Array.isArray(inputs)) return "inputs must be an object";
  const keys = Object.keys(inputs);
  const has = (...ks) => ks.every((k) => keys.indexOf(k) >= 0);
  const noExtra = (...ks) => keys.every((k) => ks.indexOf(k) >= 0);
  let shape = null;
  if (has("events1", "n1", "events2", "n2") && noExtra("events1", "n1", "events2", "n2")) shape = "rawCounts";
  else if (has("mean1", "sd1", "n1", "mean2", "sd2", "n2") && noExtra("mean1", "sd1", "n1", "mean2", "sd2", "n2")) shape = "rawMeans";
  else if (has("effect", "ciLower", "ciUpper") && noExtra("effect", "ciLower", "ciUpper", "ciLevel")) shape = "reported";
  else if (has("yi") && noExtra("yi", "se", "sei", "vi")) shape = "generic";
  else return "inputs must be exactly one of rawCounts, rawMeans, reported or generic";
  if (shape === "rawCounts") {
    if (measure !== "OR" && measure !== "RR" && measure !== "RD")
      return "raw counts need measure OR, RR or RD (HR has no raw-count form)";
    const { events1, n1, events2, n2 } = inputs;
    if (!isInt(events1) || events1 < 0 || !isInt(n1) || n1 < 1 ||
        !isInt(events2) || events2 < 0 || !isInt(n2) || n2 < 1)
      return "raw counts need integer events of at least 0 and n of at least 1";
    if (events1 > n1 || events2 > n2) return "events cannot exceed n";
    return null;
  }
  if (shape === "rawMeans") {
    if (measure !== "MD" && measure !== "SMD") return "raw means need measure MD or SMD";
    const { mean1, sd1, n1, mean2, sd2, n2 } = inputs;
    if (!isFin(mean1) || !isFin(mean2)) return "means must be finite numbers";
    if (!isFin(sd1) || !(sd1 > 0) || !isFin(sd2) || !(sd2 > 0)) return "sd must be above 0";
    if (!isInt(n1) || n1 < 1 || !isInt(n2) || n2 < 1) return "n must be an integer of at least 1";
    return null;
  }
  if (shape === "reported") {
    const { effect, ciLower, ciUpper, ciLevel } = inputs;
    if (!isFin(effect) || !isFin(ciLower) || !isFin(ciUpper)) return "effect and CI bounds must be finite";
    if (!(ciLower < effect && effect < ciUpper)) return "reported CI needs ciLower below effect below ciUpper";
    if (ciLevel !== undefined && !(typeof ciLevel === "number" && ciLevel > 0 && ciLevel < 1))
      return "ciLevel must be between 0 and 1";
    if ((measure === "OR" || measure === "RR" || measure === "HR") &&
        !(effect > 0 && ciLower > 0 && ciUpper > 0))
      return "ratio effects must be positive";
    return null;
  }
  if (!isFin(inputs.yi)) return "generic yi must be finite";
  const spreads = [inputs.se, inputs.sei, inputs.vi].filter((v) => v !== undefined);
  if (!spreads.length) return "generic inputs need se, sei or vi";
  for (const v of spreads) if (!isFin(v) || !(v > 0)) return "generic se, sei and vi must be above 0";
  return null;
}

function studyOf(row) {
  return {
    id: row.id, projectId: row.project_id, label: row.label || "", measure: row.measure,
    inputs: JSON.parse(row.inputs_json || "{}"), locator: JSON.parse(row.locator_json || "{}"),
    quote: row.quote || "", verified: row.verified === 1,
    verifiedBy: row.verified_by || "", verifiedAt: row.verified_at == null ? null : row.verified_at,
    version: row.version, createdBy: row.created_by || "",
    createdAt: row.created_ts, updatedAt: row.updated_ts,
  };
}
function runOf(row) {
  return {
    id: row.id, projectId: row.project_id, measure: row.measure, model: row.model,
    test: row.test, level: row.level,
    studyVersions: JSON.parse(row.study_versions_json || "[]"),
    manifest: JSON.parse(row.manifest_json || "{}"), result: JSON.parse(row.result_json || "{}"),
    createdBy: row.created_by || "", createdAt: row.created_ts,
  };
}
function projectListItem(row, role) {
  return {
    id: row.id, title: row.title, discipline: row.discipline, specialty: row.specialty || "",
    studyType: row.study_type || "", role, updatedAt: row.updated_ts,
  };
}

async function createProject(db, uid, body) {
  const title = String(body.title || "").trim();
  if (!title || title.length > 180) return { error: "title must be 1-180 characters" };
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

async function listProjects(db, uid, url, requestId) {
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT p.*,m.role AS role FROM research_projects p JOIN research_members m ON m.project_id=p.id WHERE m.uid=? AND p.status!='deleted' AND (p.updated_ts<? OR (p.updated_ts=? AND p.id<?)) ORDER BY p.updated_ts DESC,p.id DESC LIMIT ?")
      .bind(uid, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT p.*,m.role AS role FROM research_projects p JOIN research_members m ON m.project_id=p.id WHERE m.uid=? AND p.status!='deleted' ORDER BY p.updated_ts DESC,p.id DESC LIMIT ?")
      .bind(uid, limit + 1).all()).results || [];
  }
  const items = list.map((r) => projectListItem(r, r.role));
  return json(pageBody(items, "projects", limit,
    (s) => s.updatedAt, requestId), 200, { "x-request-id": requestId });
}

async function getProjectRoute(db, uid, projectId, requestId) {
  const project = await getProject(db, projectId);
  if (!project || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const me = await member(db, projectId, uid);
  return json({ project: Object.assign(projectListItem(project, me.role),
    { researchQuestion: project.research_question || "", status: project.status,
      createdAt: project.created_ts }),
    requestId }, 200, { "x-request-id": requestId });
}

async function updateProject(db, uid, projectId, body, requestId) {
  const project = await getProject(db, projectId);
  if (!project) return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, ["owner", "editor"])))
    return err(403, "not_member", "Project access denied", requestId);
  const patch = {};
  if (body.title !== undefined) {
    const title = String(body.title).trim();
    if (!title || title.length > 180) return err(400, "invalid_project", "title must be 1-180 characters", requestId);
    patch.title = title;
  }
  if (body.discipline !== undefined) patch.discipline = String(body.discipline).slice(0, 40);
  if (body.specialty !== undefined) patch.specialty = String(body.specialty).slice(0, 80);
  if (body.studyType !== undefined) patch.studyType = String(body.studyType).slice(0, 80);
  if (body.researchQuestion !== undefined) patch.researchQuestion = String(body.researchQuestion).slice(0, 2000);
  if (!Object.keys(patch).length) return err(400, "invalid_project", "Nothing to update", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_projects SET title=COALESCE(?,title),discipline=COALESCE(?,discipline),specialty=COALESCE(?,specialty),study_type=COALESCE(?,study_type),research_question=COALESCE(?,research_question),updated_ts=? WHERE id=?")
    .bind(patch.title || null, patch.discipline !== undefined ? patch.discipline : null,
      patch.specialty !== undefined ? patch.specialty : null,
      patch.studyType !== undefined ? patch.studyType : null,
      patch.researchQuestion !== undefined ? patch.researchQuestion : null, now, projectId).run();
  await audit(db, projectId, uid, "project.updated", projectId, { fields: Object.keys(patch) });
  const me = await member(db, projectId, uid);
  const row = await getProject(db, projectId);
  return json({ project: Object.assign(projectListItem(row, me.role),
    { researchQuestion: row.research_question || "", status: row.status, createdAt: row.created_ts }),
    requestId }, 200, { "x-request-id": requestId });
}

async function deleteProject(db, uid, projectId, requestId) {
  const project = await getProject(db, projectId);
  if (!project) return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, ["owner"])))
    return err(403, "not_member", "Project access denied", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_projects SET status='deleted',updated_ts=? WHERE id=?").bind(now, projectId).run();
  await audit(db, projectId, uid, "project.deleted", projectId, {});
  return json({ ok: true, requestId }, 200, { "x-request-id": requestId });
}

async function listMembers(db, uid, projectId, requestId) {
  if (!(await getProject(db, projectId)) || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const rows = (await db.prepare("SELECT uid,role,created_ts FROM research_members WHERE project_id=? ORDER BY created_ts ASC")
    .bind(projectId).all()).results || [];
  return json({ members: rows.map((r) => ({ uid: r.uid, role: r.role, createdAt: r.created_ts })),
    requestId }, 200, { "x-request-id": requestId });
}

async function addMember(db, uid, projectId, body, requestId) {
  const project = await getProject(db, projectId);
  if (!project) return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, ["owner"])))
    return err(403, "not_member", "Project access denied", requestId);
  const newUid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!newUid || newUid.length > 128) return err(400, "invalid_body", "uid must be 1-128 characters", requestId);
  if (ASSIGNABLE_ROLES.indexOf(body.role) < 0)
    return err(400, "invalid_body", "role must be one of " + ASSIGNABLE_ROLES.join(", "), requestId);
  const now = Date.now();
  const existing = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(projectId, newUid).first();
  if (existing) {
    await db.prepare("UPDATE research_members SET role=? WHERE project_id=? AND uid=?")
      .bind(body.role, projectId, newUid).run();
    await audit(db, projectId, uid, "member.role_changed", newUid, { role: body.role });
    return json({ member: { uid: newUid, role: body.role, createdAt: now }, requestId },
      200, { "x-request-id": requestId });
  }
  await db.prepare("INSERT INTO research_members (project_id,uid,role,created_ts) VALUES (?,?,?,?)")
    .bind(projectId, newUid, body.role, now).run();
  await audit(db, projectId, uid, "member.added", newUid, { role: body.role });
  return json({ member: { uid: newUid, role: body.role, createdAt: now }, requestId },
    201, { "x-request-id": requestId });
}

async function createStudy(db, uid, projectId, body, requestId) {
  if (!(await getProject(db, projectId)))
    return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, WRITE_ROLES)))
    return err(403, "not_member", "Studies need an owner, editor or analyst role", requestId);
  const measure = body.measure;
  if (!MEASURES[measure]) return err(400, "invalid_study", "measure must be one of OR, RR, HR, RD, MD, SMD", requestId);
  const badInputs = validateInputs(measure, body.inputs);
  if (badInputs) return err(400, "invalid_study", badInputs, requestId);
  const badLocator = validateLocator(body.locator);
  if (badLocator) return err(400, "invalid_study", badLocator, requestId);
  const label = body.label === undefined ? "" : String(body.label);
  if (label.length > 240) return err(400, "invalid_study", "label must be at most 240 characters", requestId);
  const quote = body.quote === undefined ? "" : String(body.quote);
  if (quote.length > 2000) return err(400, "invalid_study", "quote must be at most 2000 characters", requestId);
  const id = uuid("st_"), now = Date.now();
  await db.prepare("INSERT INTO research_studies (id,project_id,label,measure,inputs_json,locator_json,quote,verified,verified_by,verified_at,version,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,0,'',NULL,1,?,?,?)")
    .bind(id, projectId, label, measure, JSON.stringify(body.inputs), JSON.stringify(body.locator),
      quote, uid, now, now).run();
  await audit(db, projectId, uid, "study.created", id, { measure });
  const row = await db.prepare("SELECT * FROM research_studies WHERE id=?").bind(id).first();
  return json({ study: studyOf(row), requestId }, 201, { "x-request-id": requestId });
}

async function listStudies(db, uid, projectId, url, requestId) {
  if (!(await getProject(db, projectId)) || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_studies WHERE project_id=? AND (updated_ts<? OR (updated_ts=? AND id<?)) ORDER BY updated_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_studies WHERE project_id=? ORDER BY updated_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  const items = list.map(studyOf);
  return json(pageBody(items, "studies", limit, (s) => s.updatedAt, requestId),
    200, { "x-request-id": requestId });
}

async function getStudy(db, uid, projectId, studyId, requestId) {
  if (!(await getProject(db, projectId)) || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const row = await db.prepare("SELECT * FROM research_studies WHERE id=? AND project_id=?")
    .bind(studyId, projectId).first();
  if (!row) return err(404, "study_not_found", "Study not found", requestId);
  return json({ study: studyOf(row), requestId }, 200, { "x-request-id": requestId });
}

async function updateStudy(db, uid, projectId, studyId, body, requestId) {
  if (!(await getProject(db, projectId)))
    return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, WRITE_ROLES)))
    return err(403, "not_member", "Studies need an owner, editor or analyst role", requestId);
  const row = await db.prepare("SELECT * FROM research_studies WHERE id=? AND project_id=?")
    .bind(studyId, projectId).first();
  if (!row) return err(404, "study_not_found", "Study not found", requestId);
  if (!isInt(body.version) || body.version < 1)
    return err(400, "invalid_body", "version must be an integer of at least 1", requestId);
  if (body.version !== row.version) return staleConflict(row, requestId);
  const patch = {};
  if (body.label !== undefined) {
    const label = String(body.label);
    if (label.length > 240) return err(400, "invalid_study", "label must be at most 240 characters", requestId);
    patch.label = label;
  }
  if (body.inputs !== undefined) {
    const bad = validateInputs(row.measure, body.inputs);
    if (bad) return err(400, "invalid_study", bad, requestId);
    patch.inputs = JSON.stringify(body.inputs);
  }
  if (body.locator !== undefined) {
    const bad = validateLocator(body.locator);
    if (bad) return err(400, "invalid_study", bad, requestId);
    patch.locator = JSON.stringify(body.locator);
  }
  if (body.quote !== undefined) {
    const quote = String(body.quote);
    if (quote.length > 2000) return err(400, "invalid_study", "quote must be at most 2000 characters", requestId);
    patch.quote = quote;
  }
  let verifiedEvent = null;
  if (body.verified !== undefined) {
    if (typeof body.verified !== "boolean") return err(400, "invalid_study", "verified must be a boolean", requestId);
    if (body.verified && row.verified !== 1) verifiedEvent = "study.verified";
    patch.verified = body.verified ? 1 : 0;
  }
  const now = Date.now();
  await db.prepare("UPDATE research_studies SET label=COALESCE(?,label),inputs_json=COALESCE(?,inputs_json),locator_json=COALESCE(?,locator_json),quote=COALESCE(?,quote),verified=COALESCE(?,verified),verified_by=CASE WHEN ? IS NULL THEN verified_by WHEN ?=1 THEN ? ELSE '' END,verified_at=CASE WHEN ? IS NULL THEN verified_at WHEN ?=1 THEN ? ELSE NULL END,version=version+1,updated_ts=? WHERE id=?")
    .bind(patch.label !== undefined ? patch.label : null, patch.inputs || null, patch.locator || null,
      patch.quote !== undefined ? patch.quote : null, patch.verified !== undefined ? patch.verified : null,
      patch.verified !== undefined ? patch.verified : null, patch.verified || 0, uid,
      patch.verified !== undefined ? patch.verified : null, patch.verified || 0, now,
      now, studyId).run();
  await audit(db, projectId, uid, "study.updated", studyId, { version: row.version + 1 });
  if (verifiedEvent) await audit(db, projectId, uid, verifiedEvent, studyId, { verifiedBy: uid });
  const next = await db.prepare("SELECT * FROM research_studies WHERE id=?").bind(studyId).first();
  return json({ study: studyOf(next), requestId }, 200, { "x-request-id": requestId });
}

async function deleteStudy(db, uid, projectId, studyId, version, requestId) {
  if (!(await getProject(db, projectId)))
    return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, WRITE_ROLES)))
    return err(403, "not_member", "Studies need an owner, editor or analyst role", requestId);
  const row = await db.prepare("SELECT * FROM research_studies WHERE id=? AND project_id=?")
    .bind(studyId, projectId).first();
  if (!row) return err(404, "study_not_found", "Study not found", requestId);
  if (!isInt(version) || version < 1)
    return err(400, "invalid_body", "version must be an integer of at least 1", requestId);
  if (version !== row.version) return staleConflict(row, requestId);
  await db.prepare("DELETE FROM research_studies WHERE id=?").bind(studyId).run();
  await audit(db, projectId, uid, "study.deleted", studyId, { version });
  return json({ ok: true, requestId }, 200, { "x-request-id": requestId });
}

function unprocessable(code, message, requestId) {
  return json({ error: { code, message, requestId } }, 422, { "x-request-id": requestId });
}

async function createRun(db, uid, projectId, body, requestId) {
  if (!(await getProject(db, projectId)))
    return err(404, "project_not_found", "Project not found", requestId);
  if (!(await member(db, projectId, uid, WRITE_ROLES)))
    return err(403, "not_member", "Runs need an owner, editor or analyst role", requestId);
  const measure = body.measure;
  if (!MEASURES[measure])
    return err(400, "invalid_run", "measure must be one of OR, RR, HR, RD, MD, SMD", requestId);
  const model = body.model === undefined ? "random_dl" : body.model;
  if (!MODELS[model]) return err(400, "invalid_run", "model must be one of fixed, random_dl, random_reml", requestId);
  const tst = body.test === undefined ? "wald" : body.test;
  if (!TESTS[tst]) return err(400, "invalid_run", "test must be wald or knha", requestId);
  const level = body.level === undefined ? 0.95 : body.level;
  if (!(typeof level === "number" && level > 0 && level < 1))
    return err(400, "invalid_run", "level must be between 0 and 1", requestId);
  const rows = (await db.prepare("SELECT * FROM research_studies WHERE project_id=?").bind(projectId).all())
    .results || [];
  let pins = body.studyVersions;
  if (pins === undefined) {
    if (rows.length < 2)
      return err(400, "invalid_run", "At least 2 studies are required for a run", requestId);
    pins = rows.map((r) => ({ studyId: r.id, version: r.version }));
  } else {
    if (!Array.isArray(pins) || pins.length < 2)
      return err(400, "invalid_run", "studyVersions needs at least 2 pinned studies", requestId);
    for (const p of pins) {
      if (!p || typeof p.studyId !== "string" || !isInt(p.version) || p.version < 1)
        return err(400, "invalid_run", "Each studyVersion needs a studyId and a version of at least 1", requestId);
    }
  }
  const byId = {};
  for (const r of rows) byId[r.id] = r;
  for (const p of pins) {
    if (!byId[p.studyId]) return err(404, "study_not_found", "Study not found: " + p.studyId, requestId);
  }
  for (const p of pins) {
    if (byId[p.studyId].version !== p.version) return staleConflict(byId[p.studyId], requestId);
  }
  for (const p of pins) {
    if (byId[p.studyId].measure !== measure)
      return err(400, "invalid_run", "Pinned study " + p.studyId + " uses measure " +
        byId[p.studyId].measure, requestId);
  }
  const unverified = pins.filter((p) => byId[p.studyId].verified !== 1).map((p) => p.studyId);
  if (unverified.length)
    return unprocessable("unverified_studies",
      "Unverified studies cannot be pooled: " + unverified.join(", "), requestId);
  const now = Date.now();
  const engineStudies = pins.map((p) =>
    Object.assign({ id: p.studyId, verified: true }, JSON.parse(byId[p.studyId].inputs_json || "{}")));
  let res;
  try {
    res = engineRun({ measure, model, test: tst, level, studies: engineStudies,
      createdAt: new Date(now).toISOString() });
  } catch (e) {
    const message = String((e && e.message) || e).slice(0, 300);
    if (message.indexOf("unverified") >= 0)
      return unprocessable("unverified_studies", message, requestId);
    return unprocessable("unpoolable_studies", message, requestId);
  }
  const manifest = res.manifest || { engine: "research-engine",
    engineVersion: String(ENGINE_VERSION || "rmd1"), measure, model, test: tst, level,
    inputs: engineStudies.map((s) => ({ id: s.id })), createdAt: new Date(now).toISOString() };
  const result = Object.assign({}, res);
  delete result.manifest;
  const id = uuid("run_");
  await db.prepare("INSERT INTO research_runs (id,project_id,measure,model,test,level,study_versions_json,manifest_json,result_json,engine,engine_version,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, measure, model, tst, level, JSON.stringify(pins),
      JSON.stringify(manifest), JSON.stringify(result),
      "research-engine", String(ENGINE_VERSION || "rmd1"), uid, now).run();
  await audit(db, projectId, uid, "run.created", id, { measure, model, studies: pins.length });
  const row = await db.prepare("SELECT * FROM research_runs WHERE id=?").bind(id).first();
  return json({ run: runOf(row), requestId }, 201, { "x-request-id": requestId });
}

async function listRuns(db, uid, projectId, url, requestId) {
  if (!(await getProject(db, projectId)) || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_runs WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_runs WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  return json(pageBody(list.map(runOf), "runs", limit, (s) => s.createdAt, requestId),
    200, { "x-request-id": requestId });
}

async function getRun(db, uid, projectId, runId, requestId) {
  if (!(await getProject(db, projectId)) || !(await member(db, projectId, uid)))
    return err(404, "project_not_found", "Project not found", requestId);
  const row = await db.prepare("SELECT * FROM research_runs WHERE id=? AND project_id=?")
    .bind(runId, projectId).first();
  if (!row) return err(404, "run_not_found", "Run not found", requestId);
  return json({ run: runOf(row), requestId }, 200, { "x-request-id": requestId });
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
  const jobId = uuid("job_"), analysisId = uuid("ma_"), now = Date.now();
  const input = JSON.stringify({ effect_measure: analysis.effect_measure, model: analysis.model || "random_dl",
    confidence_level: analysis.confidence_level ?? 0.95, studies: analysis.studies });
  const hashBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(input));
  const inputHash = [...new Uint8Array(hashBytes)].map(x => x.toString(16).padStart(2, "0")).join("");
  const existing = await db.prepare("SELECT j.id,j.status,m.input_hash FROM research_jobs j JOIN research_meta_analyses m ON m.job_id=j.id WHERE j.project_id=? AND j.idempotency_key=?")
    .bind(projectId, idempotencyKey).first();
  if (existing) {
    if (existing.input_hash !== inputHash) return err(409, "idempotency_conflict", "This idempotencyKey was already used with different analysis input", requestId);
    return json({ jobId: existing.id, status: existing.status, idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
  }
  try {
    await db.batch([
      db.prepare("INSERT INTO research_jobs (id,project_id,job_type,status,idempotency_key,input_json,created_by,created_ts) VALUES (?,?, 'meta_analysis','queued',?,?,?,?)")
        .bind(jobId, projectId, idempotencyKey, JSON.stringify({ analysisId }), uid, now),
      db.prepare("INSERT INTO research_meta_analyses (id,project_id,job_id,model,effect_measure,input_hash,input_json,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?)")
        .bind(analysisId, projectId, jobId, analysis.model || "random_dl", analysis.effect_measure, inputHash, input, uid, now),
    ]);
  } catch (e) {
    const raced = await db.prepare("SELECT j.id,j.status,m.input_hash FROM research_jobs j JOIN research_meta_analyses m ON m.job_id=j.id WHERE j.project_id=? AND j.idempotency_key=?")
      .bind(projectId, idempotencyKey).first();
    if (raced) {
      if (raced.input_hash !== inputHash) return err(409, "idempotency_conflict", "This idempotencyKey was already used with different analysis input", requestId);
      return json({ jobId: raced.id, status: raced.status, idempotentReplay: true, requestId }, 200, { "x-request-id": requestId });
    }
    throw e;
  }
  try {
    await queue.send({ type: "meta-analysis", jobId, analysisId, projectId, requestedBy: uid, requestId });
  } catch (e) {
    await db.prepare("UPDATE research_jobs SET status='failed',error_code='queue_unavailable',completed_ts=? WHERE id=?")
      .bind(Date.now(), jobId).run();
    return err(503, "queue_unavailable", "Could not queue analysis; retry with the same idempotency key", requestId);
  }
  await audit(db, projectId, uid, "meta_analysis.submitted", analysisId, { model: analysis.model || "random_dl", studies: analysis.studies.length });
  return json({ jobId, analysisId, status: "queued", requestId }, 202, { "x-request-id": requestId });
}

/* ============================ Phase 2 ===================================
 * Contracts: docs/research/contracts/phase-2 (0002 migration, blinding.md,
 * connector-api.md, prisma2020.md, errors.md, schemas/). Role matrix from
 * errors.md: owner create/version/lock + invites + resolve; editor
 * create/version + invites + resolve; analyst searches/imports/dedup + vote;
 * reviewer vote + blinded reads; viewer non-vote reads only.
 * ======================================================================== */

const SEARCH_DATABASES = {
  pubmed: pubmedConnector, europe_pmc: europepmcConnector,
  crossref: crossrefConnector, semantic_scholar: s2Connector,
};
const VOTE_ROLES = ["owner", "editor", "analyst", "reviewer"];
const RESOLVER_ROLES = ["owner", "editor"];
const REPORT_STATUSES = ["sought", "not_retrieved", "retrieved", "excluded", "included"];
const DECISIONS = ["include", "exclude", "uncertain"];
/* prisma2020.md standard global exclusion codes, seeded as project_id='global'. */
const GLOBAL_REASONS = [
  ["WRONG_POPULATION", "Wrong population"],
  ["WRONG_INTERVENTION", "Wrong intervention or exposure"],
  ["WRONG_COMPARATOR", "Wrong comparator"],
  ["WRONG_OUTCOME", "Wrong outcome"],
  ["WRONG_DESIGN", "Wrong study design"],
  ["DUPLICATE_REPORT", "Duplicate report of an included study"],
  ["FULL_TEXT_UNAVAILABLE", "Full text unavailable"],
  ["LANGUAGE", "Language exclusion"],
  ["ABSTRACT_ONLY", "Conference abstract only, no full data"],
  ["ONGOING_STUDY", "Ongoing study, no results yet"],
];

async function sha256Hex(text) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
}
/* Canonical JSON: object keys sorted recursively, no whitespace. The lock
 * hash covers these bytes, so key order in the request cannot change it. */
function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return "[" + value.map(canonicalJson).join(",") + "]";
  return "{" + Object.keys(value).sort().map((k) => JSON.stringify(k) + ":" + canonicalJson(value[k])).join(",") + "}";
}

/* Membership gate: 404 when the project is unknown or the caller is not a
 * member at all, 403 when the role is too weak for the write. */
async function projectGate(db, projectId, uid, roles) {
  const project = await getProject(db, projectId);
  if (!project) return { status: 404, code: "project_not_found" };
  const me = await member(db, projectId, uid, roles);
  if (!me) {
    const any = await member(db, projectId, uid);
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "project_not_found" };
  }
  return { project, role: me.role };
}
function gateErr(gate, message, requestId) {
  return err(gate.status, gate.code, message, requestId);
}

/* Phase 2 list bodies carry only the schema properties (no top-level
 * requestId; the x-request-id header echoes it). */
function phase2Page(items, key, limit, tsOf) {
  const body = {};
  body[key] = items.slice(0, limit);
  if (items.length > limit) {
    const last = body[key][body[key].length - 1];
    body.nextCursor = encodeCursor(tsOf(last), last.id);
  }
  return body;
}

/* ---- Protocols (2.1) ------------------------------------------------------ */

function protocolOf(row) {
  const out = {
    id: row.id, projectId: row.project_id, version: row.version, status: row.status,
    content: JSON.parse(row.content_json || "{}"),
    createdBy: row.created_by || "", createdTs: row.created_ts,
  };
  if (row.status === "locked") { out.lockHash = row.lock_hash; out.lockedAt = row.locked_at; }
  return out;
}
function validateProtocolContent(content) {
  if (!content || typeof content !== "object" || Array.isArray(content)) return "content must be an object";
  for (const k of Object.keys(content))
    if (["pico", "eligibility", "outcomes", "subgroups", "prospero"].indexOf(k) < 0)
      return "content." + k + " is not allowed";
  const pico = content.pico;
  if (!pico || typeof pico !== "object" || Array.isArray(pico)) return "content.pico is required";
  for (const k of ["population", "intervention", "comparison", "outcome"])
    if (!(k in pico)) return "content.pico." + k + " is required";
  for (const k of ["population", "intervention", "outcome"]) {
    const v = pico[k];
    if (typeof v !== "string" || !v.trim() || v.length > 2000)
      return "content.pico." + k + " must be 1-2000 characters";
  }
  if (typeof pico.comparison !== "string" || pico.comparison.length > 2000)
    return "content.pico.comparison must be at most 2000 characters";
  const elig = content.eligibility;
  if (!Array.isArray(elig) || elig.length < 1 || elig.length > 100)
    return "content.eligibility must list 1-100 criteria";
  for (const e of elig)
    if (typeof e !== "string" || !e.trim() || e.length > 500)
      return "each eligibility criterion must be 1-500 characters";
  const outcomes = content.outcomes;
  if (!outcomes || typeof outcomes !== "object" || Array.isArray(outcomes)) return "content.outcomes is required";
  for (const k of Object.keys(outcomes))
    if (["primary", "secondary", "timePoints"].indexOf(k) < 0) return "content.outcomes." + k + " is not allowed";
  if (typeof outcomes.primary !== "string" || !outcomes.primary.trim() || outcomes.primary.length > 500)
    return "content.outcomes.primary must be 1-500 characters";
  if (outcomes.secondary !== undefined && (!Array.isArray(outcomes.secondary) || outcomes.secondary.length > 50 ||
      outcomes.secondary.some((s) => typeof s !== "string" || !s.trim() || s.length > 500)))
    return "content.outcomes.secondary must be at most 50 strings of 1-500 characters";
  if (outcomes.timePoints !== undefined && (!Array.isArray(outcomes.timePoints) || outcomes.timePoints.length > 50 ||
      outcomes.timePoints.some((s) => typeof s !== "string" || !s.trim() || s.length > 200)))
    return "content.outcomes.timePoints must be at most 50 strings of 1-200 characters";
  if (content.subgroups !== undefined && (!Array.isArray(content.subgroups) || content.subgroups.length > 50 ||
      content.subgroups.some((s) => typeof s !== "string" || !s.trim() || s.length > 500)))
    return "content.subgroups must be at most 50 strings of 1-500 characters";
  if (content.prospero !== undefined && (!content.prospero || typeof content.prospero !== "object" || Array.isArray(content.prospero)))
    return "content.prospero must be an object";
  return null;
}
async function latestProtocol(db, projectId) {
  return db.prepare("SELECT * FROM research_protocols WHERE project_id=? ORDER BY version DESC LIMIT 1")
    .bind(projectId).first();
}
async function createProtocol(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor"]);
  if (gate.status) return gateErr(gate, "Protocols need an owner or editor role", requestId);
  if (body.title !== undefined && (typeof body.title !== "string" || !body.title.trim() || body.title.length > 240))
    return err(400, "invalid_protocol", "title must be 1-240 characters", requestId);
  const bad = validateProtocolContent(body.content);
  if (bad) return err(400, "invalid_protocol", bad, requestId);
  /* The 0002 DDL pins UNIQUE(project_id, version): one version chain per
   * project. A draft already exists -> version or lock it. After a lock the
   * chain continues with a fresh draft ("create a new protocol instead"). */
  const latest = await latestProtocol(db, projectId);
  if (latest && latest.status === "draft")
    return err(409, "protocol_locked", "A draft protocol already exists; add a version or lock it", requestId);
  const version = latest ? latest.version + 1 : 1;
  const id = uuid("prot_"), now = Date.now();
  await db.prepare("INSERT INTO research_protocols (id,project_id,version,status,content_json,created_by,created_ts) VALUES (?,?,?,'draft',?,?,?)")
    .bind(id, projectId, version, JSON.stringify(body.content), uid, now).run();
  await audit(db, projectId, uid, "protocol_created", id, { version });
  const row = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(id).first();
  return json({ protocol: protocolOf(row) }, 201, { "x-request-id": requestId });
}
async function resolveProtocolRoute(db, uid, protocolId, requestId) {
  const anchor = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(protocolId).first();
  if (!anchor) return { status: 404, code: "protocol_not_found" };
  const gate = await projectGate(db, anchor.project_id, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return { status: 404, code: "protocol_not_found" };
  return { projectId: anchor.project_id, role: gate.role };
}
async function getProtocol(db, uid, protocolId, url, requestId) {
  const resolved = await resolveProtocolRoute(db, uid, protocolId, requestId);
  if (resolved.status) return err(resolved.status, resolved.code, "Protocol not found", requestId);
  const rawVersion = url.searchParams.get("version");
  let row;
  if (rawVersion !== null) {
    const v = parseInt(rawVersion, 10);
    if (!Number.isFinite(v) || v < 1) return err(400, "invalid_protocol", "version must be an integer of at least 1", requestId);
    row = await db.prepare("SELECT * FROM research_protocols WHERE project_id=? AND version=?")
      .bind(resolved.projectId, v).first();
  } else {
    row = await latestProtocol(db, resolved.projectId);
  }
  if (!row) return err(404, "protocol_not_found", "Protocol version not found", requestId);
  return json({ protocol: protocolOf(row) }, 200, { "x-request-id": requestId });
}
/* Protocol version list (contract addition 2026-11-23:
 * schemas/protocol-list.response.json, contract-additions.md). The protocol
 * screen groups this list by item id, so every row carries the chain handle
 * (the first version's id) as `id`; per-version identity is (id, version).
 * Every /v1/protocols/{id} route resolves any chain id to the project, so the
 * handle works for GET (?version=N), versions and lock. One chain per project
 * (0002 UNIQUE(project_id, version)). All member roles may read. */
async function listProtocols(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const anchor = await db.prepare("SELECT id FROM research_protocols WHERE project_id=? ORDER BY version ASC LIMIT 1")
    .bind(projectId).first();
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_protocols WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_protocols WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  const page = list.slice(0, limit);
  const body = { protocols: page.map((r) => Object.assign(protocolOf(r), { id: anchor ? anchor.id : r.id })) };
  if (list.length > limit) {
    const last = page[page.length - 1];
    /* Cursor keeps the real row id: the shared chain handle would break ties. */
    body.nextCursor = encodeCursor(last.created_ts, last.id);
  }
  return json(body, 200, { "x-request-id": requestId });
}
async function versionProtocol(db, uid, protocolId, body, requestId) {
  const anchor = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(protocolId).first();
  if (!anchor) return err(404, "protocol_not_found", "Protocol not found", requestId);
  const gate = await projectGate(db, anchor.project_id, uid, ["owner", "editor"]);
  if (gate.status) return gateErr(gate, "Protocol versions need an owner or editor role", requestId);
  const latest = await latestProtocol(db, anchor.project_id);
  if (latest.status === "locked")
    return err(409, "protocol_locked", "Protocol is locked; create a new protocol instead", requestId);
  if (!isInt(body.baseVersion) || body.baseVersion < 1)
    return err(400, "invalid_protocol", "baseVersion must be an integer of at least 1", requestId);
  if (body.baseVersion !== latest.version)
    return json({ error: { code: "stale_version", message: "Protocol changed on the server", requestId },
      current: { protocol: protocolOf(latest) } }, 409, { "x-request-id": requestId });
  const bad = validateProtocolContent(body.content);
  if (bad) return err(400, "invalid_protocol", bad, requestId);
  const id = uuid("prot_"), now = Date.now();
  await db.prepare("INSERT INTO research_protocols (id,project_id,version,status,content_json,created_by,created_ts) VALUES (?,?,?,'draft',?,?,?)")
    .bind(id, anchor.project_id, latest.version + 1, JSON.stringify(body.content), uid, now).run();
  await audit(db, anchor.project_id, uid, "protocol_versioned", id, { version: latest.version + 1, baseVersion: latest.version });
  const row = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(id).first();
  return json({ protocol: protocolOf(row) }, 201, { "x-request-id": requestId });
}
async function lockProtocol(request, db, uid, protocolId, requestId) {
  const anchor = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(protocolId).first();
  if (!anchor) return err(404, "protocol_not_found", "Protocol not found", requestId);
  /* Role matrix: lock is owner-only (editor may create/version, not lock). */
  const gate = await projectGate(db, anchor.project_id, uid, ["owner"]);
  if (gate.status) return gateErr(gate, "Locking a protocol needs the owner role", requestId);
  if (request.body) {
    try {
      const body = await bodyJson(request);
      if (Object.keys(body).length) return err(400, "invalid_protocol", "Lock takes an empty body", requestId);
    } catch (e) { /* an empty or unreadable body is treated as empty */ }
  }
  const latest = await latestProtocol(db, anchor.project_id);
  if (latest.status === "locked")
    return err(409, "protocol_locked", "Protocol is already locked", requestId);
  const lockHash = await sha256Hex(canonicalJson(JSON.parse(latest.content_json || "{}")));
  const now = Date.now();
  await db.prepare("UPDATE research_protocols SET status='locked',lock_hash=?,locked_at=? WHERE id=? AND status='draft'")
    .bind(lockHash, now, latest.id).run();
  await audit(db, anchor.project_id, uid, "protocol_locked", latest.id, { version: latest.version, lockHash });
  const row = await db.prepare("SELECT * FROM research_protocols WHERE id=?").bind(latest.id).first();
  return json({ protocol: protocolOf(row) }, 200, { "x-request-id": requestId });
}
/* PROSPERO-field export. No frozen schema exists for this response in the
 * Phase 2 contract; the shape below maps the protocol content onto PROSPERO
 * registration fields plus the builder-filled content.prospero block. */
async function prosperoExport(db, uid, protocolId, url, requestId) {
  const resolved = await resolveProtocolRoute(db, uid, protocolId, requestId);
  if (resolved.status) return err(resolved.status, resolved.code, "Protocol not found", requestId);
  const rawVersion = url.searchParams.get("version");
  let row;
  if (rawVersion !== null) {
    const v = parseInt(rawVersion, 10);
    if (!Number.isFinite(v) || v < 1) return err(400, "invalid_protocol", "version must be an integer of at least 1", requestId);
    row = await db.prepare("SELECT * FROM research_protocols WHERE project_id=? AND version=?")
      .bind(resolved.projectId, v).first();
  } else row = await latestProtocol(db, resolved.projectId);
  if (!row) return err(404, "protocol_not_found", "Protocol version not found", requestId);
  const content = JSON.parse(row.content_json || "{}");
  const pico = content.pico || {}, outcomes = content.outcomes || {}, extra = content.prospero || {};
  const prospero = Object.assign({
    title: typeof extra.title === "string" ? extra.title : "",
    population: pico.population || "",
    intervention: pico.intervention || "",
    comparison: pico.comparison || "",
    primaryOutcome: outcomes.primary || "",
    secondaryOutcomes: outcomes.secondary || [],
    timePoints: outcomes.timePoints || [],
    eligibilityCriteria: content.eligibility || [],
    subgroups: content.subgroups || [],
  }, extra);
  const protocol = { id: row.id, projectId: row.project_id, version: row.version, status: row.status };
  if (row.status === "locked") { protocol.lockHash = row.lock_hash; protocol.lockedAt = row.locked_at; }
  return json({ prospero, protocol }, 200, { "x-request-id": requestId });
}

/* ---- Invitations and roles (2.2) ------------------------------------------ */

function invitationOf(row) {
  const out = {
    id: row.id, projectId: row.project_id, email: row.email, role: row.role, status: row.status,
    createdBy: row.created_by || "", createdTs: row.created_ts, expiresTs: row.expires_ts,
  };
  if (row.decided_ts != null) out.decidedTs = row.decided_ts;
  return out;
}
async function createInvitation(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor"]);
  if (gate.status) return gateErr(gate, "Invitations need an owner or editor role", requestId);
  const email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    return err(400, "invalid_invitation", "email must be a valid address", requestId);
  /* The schema enum lists owner, but granting owner by invitation is refused
   * (Phase 1 precedent: ownership transfers only via the owner-only members
   * route). Inviting by StewardMD ID uses that same owner-only route. */
  if (ASSIGNABLE_ROLES.indexOf(body.role) < 0)
    return err(400, "invalid_invitation", "role must be one of " + ASSIGNABLE_ROLES.join(", ") + " (owner cannot be invited)", requestId);
  const days = body.expiresInDays === undefined ? 14 : body.expiresInDays;
  if (!isInt(days) || days < 1 || days > 90)
    return err(400, "invalid_invitation", "expiresInDays must be 1-90", requestId);
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const token = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const tokenHash = await sha256Hex(token);
  const id = uuid("inv_"), now = Date.now();
  await db.prepare("INSERT INTO research_invitations (id,project_id,email,role,token_hash,status,created_by,created_ts,expires_ts) VALUES (?,?,?,?,?,'pending',?,?,?)")
    .bind(id, projectId, email, body.role, tokenHash, uid, now, now + days * 86400000).run();
  await audit(db, projectId, uid, "invitation_created", id, { role: body.role });
  const row = await db.prepare("SELECT * FROM research_invitations WHERE id=?").bind(id).first();
  return json({ invitation: invitationOf(row), token }, 201, { "x-request-id": requestId });
}
async function listInvitations(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor"]);
  if (gate.status) return gateErr(gate, "Invitations need an owner or editor role", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_invitations WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_invitations WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  return json(phase2Page(list.map(invitationOf), "invitations", limit, (i) => i.createdTs),
    200, { "x-request-id": requestId });
}
async function acceptInvitation(db, uid, body, requestId) {
  const token = typeof body.token === "string" ? body.token : "";
  if (token.length < 32) return err(404, "invitation_not_found", "Invitation not found", requestId);
  const tokenHash = await sha256Hex(token);
  const row = await db.prepare("SELECT * FROM research_invitations WHERE token_hash=?").bind(tokenHash).first();
  if (!row || !(await getProject(db, row.project_id)))
    return err(404, "invitation_not_found", "Invitation not found", requestId);
  if (row.status !== "pending")
    return err(409, "already_decided", "Invitation already " + row.status, requestId);
  const now = Date.now();
  if (row.expires_ts < now) {
    await db.prepare("UPDATE research_invitations SET status='expired',decided_ts=? WHERE id=?").bind(now, row.id).run();
    await audit(db, row.project_id, uid, "invitation_expired", row.id, {});
    return json({ error: { code: "invitation_expired", message: "Invitation expired", requestId },
      current: { invitation: { id: row.id, status: "expired" } } }, 410, { "x-request-id": requestId });
  }
  /* Role changes are owner-only (members route). Accepting never escalates an
   * existing member: the stored role wins; a new member gets the invited role. */
  const existing = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  const role = existing ? existing.role : row.role;
  if (!existing) {
    await db.prepare("INSERT INTO research_members (project_id,uid,role,created_ts) VALUES (?,?,?,?)")
      .bind(row.project_id, uid, role, now).run();
  }
  await db.prepare("UPDATE research_invitations SET status='accepted',decided_ts=? WHERE id=?").bind(now, row.id).run();
  await audit(db, row.project_id, uid, "invitation_accepted", row.id, { role });
  return json({ membership: { projectId: row.project_id, uid, role } }, 200, { "x-request-id": requestId });
}

/* ---- Exclusion reasons (2.5) ---------------------------------------------- */

async function ensureGlobalReasons(db) {
  const now = Date.now();
  await db.batch(GLOBAL_REASONS.map(([code, label]) =>
    db.prepare("INSERT OR IGNORE INTO research_exclusion_reasons (id,project_id,code,label,description,created_ts) VALUES (?,'global',?,?,'',?)")
      .bind("rsn_global_" + code, code, label, now)));
}
function reasonOf(row) {
  return { code: row.code, label: row.label, description: row.description || "",
    scope: row.project_id === "global" ? "global" : "project" };
}
async function reasonExists(db, projectId, code) {
  await ensureGlobalReasons(db);
  const row = await db.prepare("SELECT id FROM research_exclusion_reasons WHERE code=? AND project_id IN ('global',?)")
    .bind(code, projectId).first();
  return !!row;
}
async function listReasons(db, uid, projectId, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  await ensureGlobalReasons(db);
  const rows = (await db.prepare("SELECT * FROM research_exclusion_reasons WHERE project_id IN ('global',?) ORDER BY CASE WHEN project_id='global' THEN 0 ELSE 1 END, code ASC")
    .bind(projectId).all()).results || [];
  return json({ reasons: rows.map(reasonOf) }, 200, { "x-request-id": requestId });
}
async function createReason(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor"]);
  if (gate.status) return gateErr(gate, "Exclusion reasons need an owner or editor role", requestId);
  const code = typeof body.code === "string" ? body.code : "";
  if (!/^[A-Z][A-Z0-9_]{1,79}$/.test(code))
    return err(400, "invalid_body", "code must be UPPER_SNAKE, 2-80 characters", requestId);
  const label = typeof body.label === "string" ? body.label.trim() : "";
  if (!label || label.length > 200) return err(400, "invalid_body", "label must be 1-200 characters", requestId);
  const description = body.description === undefined ? "" : String(body.description);
  if (description.length > 2000) return err(400, "invalid_body", "description must be at most 2000 characters", requestId);
  await ensureGlobalReasons(db);
  const clash = await db.prepare("SELECT project_id FROM research_exclusion_reasons WHERE code=? AND project_id IN ('global',?)")
    .bind(code, projectId).first();
  if (clash)
    return err(400, "invalid_body", clash.project_id === "global" ? "Global codes cannot be redefined" : "Code already exists in this project", requestId);
  const id = uuid("rsn_"), now = Date.now();
  await db.prepare("INSERT INTO research_exclusion_reasons (id,project_id,code,label,description,created_ts) VALUES (?,?,?,?,?,?)")
    .bind(id, projectId, code, label, description, now).run();
  await audit(db, projectId, uid, "reason_created", id, { code });
  const row = await db.prepare("SELECT * FROM research_exclusion_reasons WHERE id=?").bind(id).first();
  return json({ reason: reasonOf(row) }, 201, { "x-request-id": requestId });
}

/* ---- Screening decisions, blinding, conflicts (2.5) ------------------------ */

function decisionColumn(stage) { return stage === "title_abstract" ? "record_id" : "report_id"; }
async function latestVotes(db, projectId, stage, itemId) {
  const col = decisionColumn(stage);
  /* rowid breaks same-millisecond ties by insertion order: a re-vote always
   * supersedes the earlier row, even when both land in the same millisecond. */
  return (await db.prepare(
    "SELECT * FROM (SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.reviewer_uid ORDER BY d.created_ts DESC, d.rowid DESC) AS rn FROM research_screening_decisions d WHERE d.project_id=? AND d.stage=? AND d." + col + " IS ?) WHERE rn=1")
    .bind(projectId, stage, itemId).all()).results || [];
}
async function conflictFor(db, projectId, stage, itemId) {
  const col = decisionColumn(stage);
  return db.prepare("SELECT * FROM research_conflicts WHERE project_id=? AND stage=? AND " + col + " IS ?")
    .bind(projectId, stage, itemId).first();
}
/* Outcome for the API views (blinding.md): open conflict -> conflict; resolved
 * conflict follows the resolution; fewer than two current voters -> pending;
 * unanimous include/exclude decides; a split or uncertain vote is pending. */
function outcomeOf(votes, conflict) {
  if (conflict) return conflict.status === "open" ? "conflict" : conflict.resolution;
  if (votes.length < 2) return "pending";
  const first = votes[0].decision;
  if (first !== "uncertain" && votes.every((v) => v.decision === first)) return first;
  return "pending";
}
function conflictOf(row) {
  const out = { id: row.id, projectId: row.project_id, stage: row.stage, status: row.status, createdTs: row.created_ts };
  if (row.record_id) out.recordId = row.record_id;
  if (row.report_id) out.reportId = row.report_id;
  if (row.status === "resolved") {
    out.resolution = row.resolution;
    out.resolutionReason = row.resolution_reason || "";
    out.resolvedBy = row.resolved_by || "";
    out.resolvedTs = row.resolved_ts;
  }
  return out;
}
async function syncReportStatus(db, reportRow, outcome, now) {
  if (!reportRow || reportRow.status === "not_retrieved") return;
  const want = outcome === "include" ? "included" : outcome === "exclude" ? "excluded" : null;
  if (want && reportRow.status !== want)
    await db.prepare("UPDATE research_reports SET status=?,updated_ts=? WHERE id=?").bind(want, now, reportRow.id).run();
}
async function resolveItemRoute(db, uid, kind, itemId, roles, requestId) {
  const table = kind === "record" ? "research_records" : "research_reports";
  const notFound = kind === "record" ? "record_not_found" : "report_not_found";
  const row = await db.prepare("SELECT * FROM " + table + " WHERE id=?").bind(itemId).first();
  if (!row || !(await getProject(db, row.project_id))) return { status: 404, code: notFound };
  const me = await member(db, row.project_id, uid, roles);
  if (!me) {
    const any = await member(db, row.project_id, uid);
    return any ? { status: 403, code: "not_member" } : { status: 404, code: notFound };
  }
  return { row, projectId: row.project_id, role: me.role };
}
async function createDecision(db, uid, kind, itemId, body, requestId) {
  const stage = kind === "record" ? "title_abstract" : "full_text";
  const resolved = await resolveItemRoute(db, uid, kind, itemId, VOTE_ROLES, requestId);
  if (resolved.status)
    return err(resolved.status, resolved.code, resolved.code === "not_member" ? "Viewers cannot vote" : "Item not found", requestId);
  const { row, projectId } = resolved;
  const conflict = await conflictFor(db, projectId, stage, itemId);
  if (conflict && conflict.status === "open")
    return err(409, "conflict_open", "This item has an open conflict; resolve it first", requestId);
  if (conflict && conflict.status === "resolved")
    return err(409, "conflict_open", "Votes are frozen after resolution; the resolution stands", requestId);
  const votes = await latestVotes(db, projectId, stage, itemId);
  const mine = votes.find((v) => v.reviewer_uid === uid);
  if (votes.length >= 2) {
    if (mine)
      return err(409, "conflict_open", "Votes are frozen once both reviewers have decided; a conflict is required to change them", requestId);
    return err(400, "invalid_decision", "This item already has two reviewers", requestId);
  }
  const decision = body.decision;
  if (DECISIONS.indexOf(decision) < 0)
    return err(400, "invalid_decision", "decision must be include, exclude or uncertain", requestId);
  let reasonCode = null;
  if (body.reasonCode !== undefined) {
    if (typeof body.reasonCode !== "string" || !body.reasonCode || body.reasonCode.length > 80)
      return err(400, "invalid_decision", "reasonCode must be 1-80 characters", requestId);
    if (decision === "include")
      return err(400, "invalid_decision", "reasonCode is forbidden with include", requestId);
    if (!(await reasonExists(db, projectId, body.reasonCode)))
      return err(422, "exclusion_reason_unknown", "Unknown exclusion reason: " + body.reasonCode, requestId);
    reasonCode = body.reasonCode;
  }
  if (decision === "exclude" && !reasonCode)
    return err(400, "invalid_decision", "exclude requires a reasonCode", requestId);
  const id = uuid("dec_"), now = Date.now();
  const col = decisionColumn(stage);
  await db.prepare("INSERT INTO research_screening_decisions (id,project_id," + col + ",stage,reviewer_uid,decision,reason_code,created_ts) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, projectId, itemId, stage, uid, decision, reasonCode, now).run();
  await audit(db, projectId, uid, "decision_recorded", id,
    Object.assign({ stage, decision }, reasonCode ? { reasonCode } : {}, kind === "record" ? { recordId: itemId } : { reportId: itemId }));
  const after = await latestVotes(db, projectId, stage, itemId);
  let outcome = "pending", conflictId;
  if (after.length >= 2) {
    if (votes.length < 2)
      await audit(db, projectId, uid, "decisions_unblinded", itemId, { stage });
    const values = after.map((v) => v.decision);
    const disagree = values.some((v) => v !== values[0]) || values.indexOf("uncertain") >= 0;
    if (disagree) {
      await db.prepare("INSERT INTO research_conflicts (id,project_id," + col + ",stage,status,created_ts) VALUES (?,?,?,?,'open',?) ON CONFLICT DO NOTHING")
        .bind(uuid("cf_"), projectId, itemId, stage, now).run();
      const opened = await conflictFor(db, projectId, stage, itemId);
      await audit(db, projectId, uid, "conflict_opened", opened.id, Object.assign({ stage, votes: values }, kind === "record" ? { recordId: itemId } : { reportId: itemId }));
      outcome = "conflict";
      conflictId = opened.id;
    } else {
      outcome = values[0];
      if (kind === "report") await syncReportStatus(db, row, outcome, now);
    }
  }
  const stored = { id, stage, decision, createdTs: now };
  if (reasonCode) stored.reasonCode = reasonCode;
  const out = { decision: stored, outcome };
  if (conflictId) out.conflictId = conflictId;
  return json(out, 201, { "x-request-id": requestId });
}
async function listDecisions(db, uid, kind, itemId, requestId) {
  const stage = kind === "record" ? "title_abstract" : "full_text";
  const resolved = await resolveItemRoute(db, uid, kind, itemId, ["owner", "editor", "analyst", "reviewer", "viewer"], requestId);
  if (resolved.status) return err(resolved.status, resolved.code, "Item not found", requestId);
  const { projectId, role } = resolved;
  const votes = await latestVotes(db, projectId, stage, itemId);
  const conflict = await conflictFor(db, projectId, stage, itemId);
  const outcome = outcomeOf(votes, conflict);
  /* B1: the audit log records who viewed what, never the votes. */
  await audit(db, projectId, uid, "decisions_viewed", itemId, { stage });
  if (role === "viewer") return json({ votes: [], outcome }, 200, { "x-request-id": requestId });
  const unblinded = votes.length >= 2;
  const entries = [];
  for (const v of votes) {
    if (v.reviewer_uid === uid) {
      const e = { reviewer: "self", decision: v.decision, visible: true, createdTs: v.created_ts };
      if (v.reason_code) e.reasonCode = v.reason_code;
      entries.push(e);
    } else if (unblinded) {
      const e = { reviewer: "peer", decision: v.decision, visible: true, createdTs: v.created_ts };
      if (v.reason_code) e.reasonCode = v.reason_code;
      entries.push(e);
    } else {
      entries.push({ reviewer: "peer", decision: "hidden", visible: false });
    }
  }
  entries.sort((a, b) => (a.reviewer === "self" ? -1 : b.reviewer === "self" ? 1 : (a.createdTs || 0) - (b.createdTs || 0)));
  return json({ votes: entries, outcome }, 200, { "x-request-id": requestId });
}
async function listConflicts(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const { limit, cursor } = pageParams(url);
  const rankExpr = "CASE WHEN status='open' THEN 0 ELSE 1 END";
  let sql = "SELECT * FROM (SELECT c.*, " + rankExpr + " AS rank FROM research_conflicts c WHERE c.project_id=?)";
  const binds = [projectId];
  if (cursor) {
    const rank = isInt(cursor.rank) ? cursor.rank : 0;
    sql += " WHERE rank>? OR (rank=? AND (created_ts<? OR (created_ts=? AND id<?)))";
    binds.push(rank, rank, cursor.ts, cursor.ts, String(cursor.id || ""));
  }
  sql += " ORDER BY rank ASC, created_ts DESC, id DESC LIMIT ?";
  binds.push(limit + 1);
  const rows = (await db.prepare(sql).bind(...binds).all()).results || [];
  const items = rows.slice(0, limit).map(conflictOf);
  const body = { conflicts: items };
  if (rows.length > limit) {
    const last = rows[limit - 1];
    body.nextCursor = encodeCursorRank(last.rank, last.created_ts, last.id);
  }
  return json(body, 200, { "x-request-id": requestId });
}
function encodeCursorRank(rank, ts, id) {
  const bytes = new TextEncoder().encode(JSON.stringify({ rank, ts, id }));
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin);
}
async function resolveConflict(db, uid, conflictId, body, requestId) {
  const conflict = await db.prepare("SELECT * FROM research_conflicts WHERE id=?").bind(conflictId).first();
  if (!conflict || !(await getProject(db, conflict.project_id)))
    return err(404, "conflict_not_found", "Conflict not found", requestId);
  const me = await member(db, conflict.project_id, uid, RESOLVER_ROLES);
  if (!me) {
    const any = await member(db, conflict.project_id, uid);
    return any ? err(403, "resolver_only", "Conflict resolution needs an owner or editor", requestId)
      : err(404, "conflict_not_found", "Conflict not found", requestId);
  }
  if (conflict.status !== "open")
    return err(409, "already_decided", "Conflict already resolved", requestId);
  const resolution = body.resolution;
  if (resolution !== "include" && resolution !== "exclude")
    return err(400, "invalid_decision", "resolution must be include or exclude", requestId);
  let reasonCode = "";
  if (body.reasonCode !== undefined) {
    if (typeof body.reasonCode !== "string" || !body.reasonCode || body.reasonCode.length > 80)
      return err(400, "invalid_decision", "reasonCode must be 1-80 characters", requestId);
    if (!(await reasonExists(db, conflict.project_id, body.reasonCode)))
      return err(422, "exclusion_reason_unknown", "Unknown exclusion reason: " + body.reasonCode, requestId);
    reasonCode = body.reasonCode;
  }
  if (resolution === "exclude" && !reasonCode)
    return err(400, "invalid_decision", "exclude resolution requires a reasonCode", requestId);
  let note = body.note === undefined ? "" : String(body.note);
  if (note.length > 2000) return err(400, "invalid_decision", "note must be at most 2000 characters", requestId);
  const stage = conflict.stage;
  const itemId = stage === "title_abstract" ? conflict.record_id : conflict.report_id;
  const voters = (await latestVotes(db, conflict.project_id, stage, itemId)).map((v) => v.reviewer_uid);
  const resolverIsVoter = voters.indexOf(uid) >= 0;
  if (resolverIsVoter) {
    /* B4: a voter may resolve only when no non-voter owner/editor exists. */
    const placeholders = voters.map(() => "?").join(",");
    const others = (await db.prepare("SELECT uid FROM research_members WHERE project_id=? AND role IN ('owner','editor') AND uid NOT IN (" + placeholders + ")")
      .bind(conflict.project_id, ...voters).all()).results || [];
    if (others.length)
      return err(403, "resolver_only", "A non-voter owner or editor must resolve this conflict", requestId);
    note = (note ? note + " " : "") + "[resolved by a voter: no non-voter owner/editor available]";
  }
  const now = Date.now();
  await db.prepare("UPDATE research_conflicts SET status='resolved',resolution=?,resolution_reason=?,resolved_by=?,resolved_ts=? WHERE id=? AND status='open'")
    .bind(resolution, reasonCode, uid, now, conflictId).run();
  await audit(db, conflict.project_id, uid, "conflict_resolved", conflictId,
    { stage, resolution, reasonCode, note, resolverWasVoter: resolverIsVoter });
  if (stage === "full_text") {
    const report = await db.prepare("SELECT * FROM research_reports WHERE id=?").bind(itemId).first();
    await syncReportStatus(db, report, resolution, now);
  }
  const row = await db.prepare("SELECT * FROM research_conflicts WHERE id=?").bind(conflictId).first();
  return json({ conflict: conflictOf(row) }, 200, { "x-request-id": requestId });
}

/* ---- Records and reports (read shapes + report lifecycle) ------------------ */

function recordOf(row) {
  return {
    id: row.id, projectId: row.project_id, searchRunId: row.search_run_id || null,
    source: row.source, externalId: row.external_id, title: row.title,
    authors: JSON.parse(row.authors_json || "[]"), year: row.year, doi: row.doi || "",
    metadata: JSON.parse(row.metadata_json || "{}"), createdTs: row.created_ts,
  };
}
function reportOf(row) {
  return {
    id: row.id, projectId: row.project_id, recordId: row.record_id, status: row.status,
    retrievalSource: row.retrieval_source || "", r2Key: row.r2_key || "",
    studyId: row.study_id || null, createdTs: row.created_ts, updatedTs: row.updated_ts,
  };
}
async function listRecords(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_records WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_records WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  return json(phase2Page(list.map(recordOf), "records", limit, (r) => r.createdTs), 200, { "x-request-id": requestId });
}
async function getRecord(db, uid, recordId, requestId) {
  const resolved = await resolveItemRoute(db, uid, "record", recordId, ["owner", "editor", "analyst", "reviewer", "viewer"], requestId);
  if (resolved.status) return err(resolved.status, resolved.code, "Record not found", requestId);
  return json({ record: recordOf(resolved.row) }, 200, { "x-request-id": requestId });
}
async function createDirectRecord(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Adding records needs an owner, editor or analyst role", requestId);
  const title = typeof body.title === "string" ? body.title.trim().slice(0, 2000) : "";
  if (!title) return err(400, "invalid_body", "title is required", requestId);
  const pmid = typeof body.pmid === "string" ? body.pmid.replace(/\D/g, "").slice(0, 32) : "";
  const doi = typeof body.doi === "string" ? normaliseDoi(body.doi).slice(0, 200) : "";
  const rawSource = typeof body.source === "string" ? body.source.trim().toLowerCase() : "";
  const source = ["pubmed", "europe_pmc", "crossref", "manual"].indexOf(rawSource) >= 0
    ? rawSource
    : (pmid ? "pubmed" : (doi ? "crossref" : "manual"));
  const rawExt = typeof body.externalId === "string" ? body.externalId.trim().slice(0, 200) : "";
  const externalId = pmid || doi || rawExt || await sha256Hex(source + ":" + title.toLowerCase() + ":" + (body.year || ""));
  const authors = Array.isArray(body.authors)
    ? body.authors.map((a) => String(a || "").trim()).filter(Boolean).slice(0, 50)
    : [];
  const yearNum = body.year != null && body.year !== "" ? parseInt(body.year, 10) : null;
  const year = yearNum && Number.isFinite(yearNum) && yearNum >= 1800 && yearNum <= 2100 ? yearNum : null;
  const meta = {};
  if (pmid) meta.pmid = pmid;
  if (doi) meta.doi = doi;
  if (typeof body.journal === "string" && body.journal.trim()) {
    const j = body.journal.trim().slice(0, 300);
    meta.journal = j;
    meta.venue = j;
  }
  if (typeof body.abstract === "string" && body.abstract.trim()) meta.abstract = body.abstract.trim().slice(0, 4000);
  if (typeof body.url === "string" && /^https?:\/\//i.test(body.url.trim())) meta.url = body.url.trim().slice(0, 500);

  const exact = await db.prepare("SELECT * FROM research_records WHERE project_id=? AND source=? AND external_id=?")
    .bind(projectId, source, externalId).first();
  if (exact) return json({ record: recordOf(exact), duplicate: true }, 200, { "x-request-id": requestId });

  const priorRows = recordRowsToDedup((await db.prepare("SELECT * FROM research_records WHERE project_id=?").bind(projectId).all()).results || []);
  const dupId = matchesExistingRecord(priorRows, { source, externalId, title, authors, year, doi, pmid, extra: meta });
  if (dupId) {
    const existingRow = await db.prepare("SELECT * FROM research_records WHERE id=? AND project_id=?").bind(dupId, projectId).first();
    if (existingRow) return json({ record: recordOf(existingRow), duplicate: true }, 200, { "x-request-id": requestId });
  }

  const id = uuid("rec_"), now = Date.now();
  await db.prepare("INSERT INTO research_records (id,project_id,search_run_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,NULL,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, source, externalId, title, JSON.stringify(authors), year, doi, JSON.stringify(meta), now).run();
  await audit(db, projectId, uid, "record_added_direct", id, { source, externalId });
  const row = await db.prepare("SELECT * FROM research_records WHERE id=?").bind(id).first();
  return json({ record: recordOf(row), duplicate: false }, 201, { "x-request-id": requestId });
}
async function createReport(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Reports need an owner, editor or analyst role", requestId);
  const recordId = typeof body.recordId === "string" ? body.recordId : "";
  const record = await db.prepare("SELECT * FROM research_records WHERE id=? AND project_id=?").bind(recordId, projectId).first();
  if (!record) return err(404, "record_not_found", "Record not found", requestId);
  const existing = await db.prepare("SELECT * FROM research_reports WHERE record_id=?").bind(recordId).first();
  if (existing) return json({ report: reportOf(existing) }, 200, { "x-request-id": requestId });
  const status = body.status === undefined ? "sought" : body.status;
  if (REPORT_STATUSES.indexOf(status) < 0)
    return err(400, "invalid_body", "status must be one of " + REPORT_STATUSES.join(", "), requestId);
  const retrievalSource = body.retrievalSource === undefined ? "" : String(body.retrievalSource).slice(0, 200);
  const id = uuid("rep_"), now = Date.now();
  await db.prepare("INSERT INTO research_reports (id,project_id,record_id,status,retrieval_source,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?)")
    .bind(id, projectId, recordId, status, retrievalSource, now, now).run();
  await audit(db, projectId, uid, "report_created", id, { recordId, status });
  const row = await db.prepare("SELECT * FROM research_reports WHERE id=?").bind(id).first();
  return json({ report: reportOf(row) }, 201, { "x-request-id": requestId });
}
async function listReports(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_reports WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_reports WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  return json(phase2Page(list.map(reportOf), "reports", limit, (r) => r.createdTs), 200, { "x-request-id": requestId });
}
async function setReportStatus(db, uid, reportId, body, requestId) {
  const resolved = await resolveItemRoute(db, uid, "report", reportId, WRITE_ROLES, requestId);
  if (resolved.status)
    return err(resolved.status, resolved.code, resolved.code === "not_member" ? "Reports need an owner, editor or analyst role" : "Report not found", requestId);
  const status = body.status;
  if (REPORT_STATUSES.indexOf(status) < 0)
    return err(400, "invalid_body", "status must be one of " + REPORT_STATUSES.join(", "), requestId);
  if (resolved.row.status === "not_retrieved" && status !== "not_retrieved")
    return err(400, "invalid_body", "not_retrieved is a terminal state", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_reports SET status=?,updated_ts=? WHERE id=?").bind(status, now, reportId).run();
  await audit(db, resolved.projectId, uid, "report_status_changed", reportId, { status });
  const row = await db.prepare("SELECT * FROM research_reports WHERE id=?").bind(reportId).first();
  return json({ report: reportOf(row) }, 200, { "x-request-id": requestId });
}

/* ---- Search runs (2.3) ------------------------------------------------------ */

function searchRunOf(row) {
  return {
    id: row.id, projectId: row.project_id, database: row.database, query: row.query,
    filters: JSON.parse(row.filters_json || "{}"), dateTo: row.date_to == null ? null : row.date_to,
    apiVersion: row.api_version || "", resultCount: row.result_count, r2Key: row.r2_key || "",
    createdBy: row.created_by || "", createdTs: row.created_ts,
  };
}
async function storeSearchArchive(env, db, projectId, runId, archive, now) {
  let r2Key = "";
  if (env.RESEARCH_R2) {
    r2Key = "projects/" + projectId + "/searches/" + runId + ".json";
    await env.RESEARCH_R2.put(r2Key, JSON.stringify(archive), { httpMetadata: { contentType: "application/json" } });
  } else {
    /* Pilot fallback: the same archive JSON in a D1 column (research_search_ids). */
    await db.prepare("INSERT INTO research_search_ids (run_id,ids_json,created_ts) VALUES (?,?,?)")
      .bind(runId, JSON.stringify(archive), now).run();
  }
  return r2Key;
}
async function insertSearchRun(db, projectId, uid, spec, resultCount, r2Key, now) {
  const id = uuid("srch_");
  await db.prepare("INSERT INTO research_search_runs (id,project_id,database,query,filters_json,date_to,api_version,result_count,r2_key,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(id, projectId, spec.database, spec.query, canonicalJson(spec.filters || {}),
      spec.dateTo || null, spec.apiVersion || "", resultCount, r2Key, uid, now).run();
  return id;
}
async function searchFailure(env, db, uid, projectId, spec, e, requestId) {
  const code = e && e.code === "search_rate_limited" ? "search_rate_limited"
    : e && e.code === "invalid_search" ? "invalid_search" : "search_failed";
  const message = String((e && e.message) || e).slice(0, 300);
  if (code === "search_failed") {
    /* errors.md: the run is saved with result_count 0 and the error; partial
     * results are never saved. 429 stays retryable with no run row. */
    const now = Date.now();
    const runId = uuid("srch_");
    await db.prepare("INSERT INTO research_search_runs (id,project_id,database,query,filters_json,date_to,api_version,result_count,r2_key,created_by,created_ts) VALUES (?,?,?,?,?,?,?,0,?,?,?)")
      .bind(runId, projectId, spec.database, spec.query, canonicalJson(spec.filters || {}),
        spec.dateTo || null, "", "", uid, now).run();
    const r2Key = await storeSearchArchive(env, db, projectId, runId,
      { database: spec.database, query: spec.query, filters: spec.filters || {}, dateTo: spec.dateTo || null,
        error: message, ids: [], totalCount: 0 }, now);
    if (r2Key) await db.prepare("UPDATE research_search_runs SET r2_key=? WHERE id=?").bind(r2Key, runId).run();
    await audit(db, projectId, uid, "search_run_created", runId, { database: spec.database, resultCount: 0, failed: true });
    return err(502, code, message, requestId);
  }
  return err(code === "search_rate_limited" ? 429 : 400, code, message, requestId);
}
async function createSearchRun(env, db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Searches need an owner, editor or analyst role", requestId);
  const database = body.database;
  if (!SEARCH_DATABASES[database])
    return err(400, "invalid_search", "database must be pubmed, europe_pmc, crossref or semantic_scholar", requestId);
  const query = typeof body.query === "string" ? body.query : "";
  if (!query.trim() || query.length > 4000)
    return err(400, "invalid_search", "query must be 1-4000 characters", requestId);
  const filters = body.filters === undefined ? {} : body.filters;
  if (!filters || typeof filters !== "object" || Array.isArray(filters) || Object.keys(filters).length > 50)
    return err(400, "invalid_search", "filters must be an object of at most 50 keys", requestId);
  const dateTo = body.dateTo === undefined || body.dateTo === null ? null : body.dateTo;
  if (dateTo !== null && !/^[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(String(dateTo)))
    return err(400, "invalid_search", "dateTo must be YYYY-MM-DD", requestId);
  const spec = { database, query, filters, dateTo };
  /* Idempotency: the same (database, query, filters, dateTo) within 24 h
   * returns the existing run instead of re-querying (connector-api.md). */
  const existing = await db.prepare("SELECT * FROM research_search_runs WHERE project_id=? AND database=? AND query=? AND filters_json=? AND date_to IS ? AND created_ts>? ORDER BY created_ts DESC LIMIT 1")
    .bind(projectId, database, query, canonicalJson(filters), dateTo, Date.now() - 86400000).first();
  if (existing) return json({ searchRun: searchRunOf(existing) }, 200, { "x-request-id": requestId });
  const connector = SEARCH_DATABASES[database];
  const config = {
    contactEmail: env.RESEARCH_CONTACT_EMAIL,
    apiKey: env.RESEARCH_NCBI_API_KEY,
    plusToken: env.RESEARCH_CROSSREF_TOKEN,
    deadline: Date.now() + 600000,
  };
  let result;
  try {
    result = await connector.search(query, filters, dateTo, config);
  } catch (e) { return searchFailure(env, db, uid, projectId, spec, e, requestId); }
  let raws;
  try { raws = await connector.fetchRecords(result.ids, config); }
  catch (e) { return searchFailure(env, db, uid, projectId, spec, e, requestId); }
  const now = Date.now();
  const runId = uuid("srch_");
  const archive = {
    database, query, filters, dateTo,
    apiVersion: result.metadata.apiVersion, executedAt: result.metadata.executedAt,
    queryEcho: result.metadata.queryEcho, totalCount: result.totalCount, ids: result.ids,
    rateHeaders: result.rateHeaders || {},
  };
  /* The run row exists before the archive: the D1 fallback table references it. */
  await db.prepare("INSERT INTO research_search_runs (id,project_id,database,query,filters_json,date_to,api_version,result_count,r2_key,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
    .bind(runId, projectId, database, query, canonicalJson(filters), dateTo,
      String(result.metadata.apiVersion || "unknown"), result.ids.length, "", uid, now).run();
  const r2Key = await storeSearchArchive(env, db, projectId, runId, archive, now);
  if (r2Key) await db.prepare("UPDATE research_search_runs SET r2_key=? WHERE id=?").bind(r2Key, runId).run();
  let recordsAdded = 0;
  for (const raw of raws) {
    let rec;
    try { rec = connector.normalise(raw); } catch (e) { continue; }
    const inserted = await db.prepare("INSERT INTO research_records (id,project_id,search_run_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,source,external_id) DO NOTHING")
      .bind(uuid("rec_"), projectId, runId, rec.source, rec.externalId, rec.title,
        JSON.stringify(rec.authors), rec.year, rec.doi, JSON.stringify(rec.extra || {}), now).run();
    recordsAdded += (inserted.meta && inserted.meta.changes) || 0;
  }
  await audit(db, projectId, uid, "search_run_created", runId, { database, resultCount: result.ids.length, recordsAdded });
  const row = await db.prepare("SELECT * FROM research_search_runs WHERE id=?").bind(runId).first();
  return json({ searchRun: searchRunOf(row) }, 201, { "x-request-id": requestId });
}
async function getSearchRun(db, uid, searchRunId, requestId) {
  const row = await db.prepare("SELECT * FROM research_search_runs WHERE id=?").bind(searchRunId).first();
  if (!row || !(await getProject(db, row.project_id)) || !(await member(db, row.project_id, uid)))
    return err(404, "search_not_found", "Search run not found", requestId);
  return json({ searchRun: searchRunOf(row) }, 200, { "x-request-id": requestId });
}
async function listSearchRuns(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_search_runs WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_search_runs WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  return json(phase2Page(list.map(searchRunOf), "searchRuns", limit, (r) => r.createdTs), 200, { "x-request-id": requestId });
}

/* ---- Import (2.4) ------------------------------------------------------------ */

/* Multipart reference-file upload (contract addition 2026-11-23:
 * schemas/import-upload.response.json, contract-additions.md). Stores the
 * bytes in private R2 under projects/{projectId}/imports/{sha256}.{ext} and
 * returns the storageKey the screen passes to POST /imports. Same auth and
 * role gate as createImport; content parsing stays in the import step. */
const MAX_IMPORT_UPLOAD = 5 * 1024 * 1024;
const IMPORT_EXTENSIONS = { ris: 1, bib: 1, bibtex: 1, csv: 1, json: 1, xml: 1, nbib: 1, txt: 1 };
async function uploadImportFile(request, env, db, uid, projectId, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Import uploads need an owner, editor or analyst role", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  let form;
  try { form = await request.formData(); } catch { return err(400, "invalid_multipart", "Expected multipart reference-file upload", requestId); }
  const file = form.get("file");
  if (!file || typeof file === "string") return err(400, "missing_file", "Upload one reference file in the file field", requestId);
  if (file.size < 1 || file.size > MAX_IMPORT_UPLOAD)
    return err(413, "file_size", "Reference file must be 1 byte to 5 MiB", requestId);
  const name = typeof file.name === "string" ? file.name : "";
  const dot = name.lastIndexOf(".");
  const ext = dot >= 0 ? name.slice(dot + 1).toLowerCase() : "";
  if (!IMPORT_EXTENSIONS[ext])
    return err(415, "file_type", "Reference file must be .ris, .bib, .bibtex, .csv, .json, .xml, .nbib or .txt", requestId);
  const bytes = await file.arrayBuffer();
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  const sha256 = [...new Uint8Array(digest)].map((x) => x.toString(16).padStart(2, "0")).join("");
  const storageKey = "projects/" + projectId + "/imports/" + sha256 + "." + ext;
  await env.RESEARCH_R2.put(storageKey, bytes, { httpMetadata: { contentType: "text/plain; charset=utf-8" },
    customMetadata: { projectId, uploadedBy: uid, sha256 } });
  await audit(db, projectId, uid, "import_uploaded", storageKey, { bytes: file.size, sha256, ext });
  return json({ storageKey, sha256, bytes: file.size }, 201, { "x-request-id": requestId });
}

async function createImport(env, db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Imports need an owner, editor or analyst role", requestId);
  const format = body.format;
  if (["ris", "bibtex", "csv", "csl-json", "csl", "json", "endnote-xml", "endnote", "xml", "nbib", "medline"].indexOf(format) < 0)
    return err(400, "invalid_search", "format must be ris, bibtex, csv, csl-json, endnote-xml or nbib", requestId);
  const storageKey = typeof body.storageKey === "string" ? body.storageKey : "";
  if (!storageKey || storageKey.length > 500)
    return err(400, "invalid_search", "storageKey must be 1-500 characters", requestId);
  if (storageKey.indexOf("projects/" + projectId + "/") !== 0)
    return err(403, "not_member", "Storage key is outside this project", requestId);
  if (!env.RESEARCH_R2) return err(503, "storage_unavailable", "Research file storage is not provisioned", requestId);
  const obj = await env.RESEARCH_R2.get(storageKey);
  if (!obj) return err(400, "invalid_search", "Import file not found in storage", requestId);
  const text = await obj.text();
  let entries;
  try { entries = parseImport(format, text); }
  catch (e) { return err(400, "invalid_search", String((e && e.message) || e).slice(0, 300), requestId); }
  const now = Date.now(), runId = uuid("srch_");
  const archive = { database: "import", query: storageKey, filters: { format }, dateTo: null,
    apiVersion: "import-v1", executedAt: new Date(now).toISOString(), queryEcho: "",
    totalCount: entries.length, ids: entries.map((e) => e.externalId) };
  await db.prepare("INSERT INTO research_search_runs (id,project_id,database,query,filters_json,date_to,api_version,result_count,r2_key,created_by,created_ts) VALUES (?,?, 'import',?,?,NULL,?,?,?,?,?)")
    .bind(runId, projectId, storageKey, canonicalJson({ format }), "import-v1", entries.length, "", uid, now).run();
  const r2Key = await storeSearchArchive(env, db, projectId, runId, archive, now);
  if (r2Key) await db.prepare("UPDATE research_search_runs SET r2_key=? WHERE id=?").bind(r2Key, runId).run();
  const priorRows = recordRowsToDedup((await db.prepare("SELECT * FROM research_records WHERE project_id=?").bind(projectId).all()).results || []);
  let recordsAdded = 0, skipped = 0;
  const addedIds = [], entryIds = [];
  for (const entry of entries) {
    const source = entry.source || ("import:" + format);
    const existing = await db.prepare("SELECT id FROM research_records WHERE project_id=? AND source=? AND external_id=?")
      .bind(projectId, source, entry.externalId).first();
    if (existing) { skipped++; entryIds.push(existing.id); continue; }
    /* A paper already in the project (any source) is not inserted again.
     * Within this file, duplicates are still stored and flagged below, so
     * PRISMA can count them. */
    const dupId = matchesExistingRecord(priorRows, entry);
    if (dupId) { skipped++; entryIds.push(dupId); continue; }
    const id = uuid("rec_");
    await db.prepare("INSERT INTO research_records (id,project_id,search_run_id,source,external_id,title,authors_json,year,doi,metadata_json,created_ts) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      .bind(id, projectId, runId, source, entry.externalId, entry.title, JSON.stringify(entry.authors),
        entry.year, entry.doi, JSON.stringify(entry.extra || {}), now).run();
    recordsAdded++; addedIds.push(id); entryIds.push(id);
  }
  const dedup = await persistDedup(db, projectId, null, now);
  const nonCanonical = await nonCanonicalSet(db, projectId);
  const duplicatesFlagged = skipped + addedIds.filter((id) => nonCanonical.has(id)).length;
  const touched = new Set(entryIds);
  const groupIds = dedup.allGroups.filter((g) => g.memberIds.some((m) => touched.has(m))).map((g) => g.id);
  await audit(db, projectId, uid, "records_imported", runId, { format, recordsAdded, duplicatesFlagged });
  await audit(db, projectId, uid, "dedup_run", runId, { groupsCreated: dedup.groupsCreated, duplicatesRemoved: dedup.duplicatesRemoved });
  return json({ import: { searchRunId: runId, recordsAdded, duplicatesFlagged, groupIds } }, 201, { "x-request-id": requestId });
}

/* ---- Deterministic dedup (2.4) ------------------------------------------------ */

async function nonCanonicalSet(db, projectId) {
  const rows = (await db.prepare("SELECT m.record_id FROM research_dedup_members m JOIN research_dedup_groups g ON g.id=m.group_id WHERE g.project_id=? AND m.record_id != g.canonical_record_id")
    .bind(projectId).all()).results || [];
  return new Set(rows.map((r) => r.record_id));
}
function recordRowsToDedup(rows) {
  return rows.map((r) => ({
    id: r.id, source: r.source, externalId: r.external_id, title: r.title,
    authors: JSON.parse(r.authors_json || "[]"), year: r.year, doi: r.doi,
    createdTs: r.created_ts, metadata: JSON.parse(r.metadata_json || "{}"),
  }));
}
/* Computes groups over the scope and persists only genuinely new ones; an
 * identical re-run reuses the stored groups (idempotent). Nothing is deleted. */
async function persistDedup(db, projectId, searchRunIds, now) {
  let rows;
  if (searchRunIds) {
    rows = [];
    for (const runId of searchRunIds) {
      const run = await db.prepare("SELECT id FROM research_search_runs WHERE id=? AND project_id=?").bind(runId, projectId).first();
      if (!run) return { notFound: runId };
      const part = (await db.prepare("SELECT * FROM research_records WHERE project_id=? AND search_run_id=?").bind(projectId, runId).all()).results || [];
      rows.push(...part);
    }
  } else {
    rows = (await db.prepare("SELECT * FROM research_records WHERE project_id=?").bind(projectId).all()).results || [];
  }
  const { groups } = dedupRecords(recordRowsToDedup(rows));
  const existingGroups = (await db.prepare("SELECT * FROM research_dedup_groups WHERE project_id=?").bind(projectId).all()).results || [];
  const existingMembers = (await db.prepare("SELECT m.group_id,m.record_id FROM research_dedup_members m JOIN research_dedup_groups g ON g.id=m.group_id WHERE g.project_id=?")
    .bind(projectId).all()).results || [];
  const membersByGroup = new Map();
  for (const m of existingMembers) {
    if (!membersByGroup.has(m.group_id)) membersByGroup.set(m.group_id, []);
    membersByGroup.get(m.group_id).push(m.record_id);
  }
  const existingByKey = new Map();
  for (const g of existingGroups) {
    const key = (membersByGroup.get(g.id) || []).slice().sort().join("|");
    existingByKey.set(g.canonical_record_id + "::" + key, g);
  }
  let groupsCreated = 0;
  const groupIds = [];
  const allGroups = existingGroups.map((g) => ({ id: g.id, memberIds: membersByGroup.get(g.id) || [] }));
  for (const g of groups) {
    const key = g.canonicalRecordId + "::" + g.memberIds.slice().sort().join("|");
    const hit = existingByKey.get(key);
    if (hit) { groupIds.push(hit.id); continue; }
    const gid = uuid("ddg_");
    await db.prepare("INSERT INTO research_dedup_groups (id,project_id,canonical_record_id,algorithm,created_ts) VALUES (?,?,?,'deterministic-v1',?)")
      .bind(gid, projectId, g.canonicalRecordId, now).run();
    for (const memberId of g.memberIds)
      await db.prepare("INSERT INTO research_dedup_members (group_id,record_id) VALUES (?,?)").bind(gid, memberId).run();
    groupsCreated++;
    groupIds.push(gid);
    allGroups.push({ id: gid, memberIds: g.memberIds.slice() });
  }
  const dr = await db.prepare("SELECT COUNT(DISTINCT m.record_id) AS n FROM research_dedup_members m JOIN research_dedup_groups g ON g.id=m.group_id WHERE g.project_id=? AND m.record_id != g.canonical_record_id")
    .bind(projectId).first();
  return { groupsCreated, duplicatesRemoved: (dr && dr.n) || 0, groupIds, allGroups };
}
async function runDedupRoute(db, uid, projectId, body, requestId) {
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Dedup needs an owner, editor or analyst role", requestId);
  if (body.algorithm !== undefined && body.algorithm !== "deterministic-v1")
    return err(400, "invalid_body", "algorithm must be deterministic-v1", requestId);
  let searchRunIds = null;
  if (body.searchRunIds !== undefined) {
    if (!Array.isArray(body.searchRunIds) || !body.searchRunIds.length || body.searchRunIds.some((s) => typeof s !== "string"))
      return err(400, "invalid_body", "searchRunIds must be a non-empty array of ids", requestId);
    searchRunIds = body.searchRunIds;
  }
  const out = await persistDedup(db, projectId, searchRunIds, Date.now());
  if (out.notFound) return err(404, "search_not_found", "Search run not found: " + out.notFound, requestId);
  await audit(db, projectId, uid, "dedup_run", projectId, { groupsCreated: out.groupsCreated, duplicatesRemoved: out.duplicatesRemoved, scoped: !!searchRunIds });
  return json({ dedupRun: { groupsCreated: out.groupsCreated, duplicatesRemoved: out.duplicatesRemoved, groupIds: out.groupIds } },
    200, { "x-request-id": requestId });
}
async function listDedupGroups(db, uid, projectId, url, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const { limit, cursor } = pageParams(url);
  let list;
  if (cursor) {
    list = (await db.prepare("SELECT * FROM research_dedup_groups WHERE project_id=? AND (created_ts<? OR (created_ts=? AND id<?)) ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, cursor.ts, cursor.ts, String(cursor.id || ""), limit + 1).all()).results || [];
  } else {
    list = (await db.prepare("SELECT * FROM research_dedup_groups WHERE project_id=? ORDER BY created_ts DESC,id DESC LIMIT ?")
      .bind(projectId, limit + 1).all()).results || [];
  }
  const page = list.slice(0, limit);
  const groups = [];
  for (const g of page) {
    const members = (await db.prepare("SELECT record_id FROM research_dedup_members WHERE group_id=?").bind(g.id).all()).results || [];
    groups.push({ id: g.id, projectId: g.project_id, canonicalRecordId: g.canonical_record_id,
      memberIds: members.map((m) => m.record_id), algorithm: g.algorithm, createdTs: g.created_ts });
  }
  const body = { groups };
  if (list.length > limit) {
    const last = page[page.length - 1];
    body.nextCursor = encodeCursor(last.created_ts, last.id);
  }
  return json(body, 200, { "x-request-id": requestId });
}

/* ---- PRISMA 2020 counts (2.6) -------------------------------------------------- */

/* Shared with the checklist snapshot (_checklists.js). One SQL path. */
async function prismaCounts(db, projectId) {
  const row = await db.prepare("SELECT * FROM research_prisma_counts WHERE project_id=?").bind(projectId).first();
  if (!row) return null;
  /* excludedByReason: the only API-computed part. Latest full-text vote per
   * reviewer on exclude-outcome reports; a resolved exclusion counts its
   * resolution reason once. Same decision rows the view reads. */
  const latest = (await db.prepare("SELECT * FROM (SELECT d.*, ROW_NUMBER() OVER (PARTITION BY d.report_id, d.reviewer_uid ORDER BY d.created_ts DESC, d.rowid DESC) AS rn FROM research_screening_decisions d WHERE d.project_id=? AND d.stage='full_text') WHERE rn=1")
    .bind(projectId).all()).results || [];
  const votesByReport = new Map();
  for (const v of latest) {
    if (!votesByReport.has(v.report_id)) votesByReport.set(v.report_id, []);
    votesByReport.get(v.report_id).push(v);
  }
  const conflicts = (await db.prepare("SELECT * FROM research_conflicts WHERE project_id=? AND stage='full_text'")
    .bind(projectId).all()).results || [];
  const conflictByReport = new Map(conflicts.map((c) => [c.report_id, c]));
  const reports = (await db.prepare("SELECT id FROM research_reports WHERE project_id=?").bind(projectId).all()).results || [];
  const counts = new Map();
  const bump = (code) => { if (code) counts.set(code, (counts.get(code) || 0) + 1); };
  for (const rep of reports) {
    const votes = votesByReport.get(rep.id) || [];
    const conflict = conflictByReport.get(rep.id) || null;
    if (!votes.length && !conflict) continue;
    const outcome = outcomeOf(votes, conflict);
    if (outcome !== "exclude") continue;
    if (conflict && conflict.status === "resolved") bump(conflict.resolution_reason);
    else for (const v of votes) if (v.decision === "exclude") bump(v.reason_code);
  }
  const excludedByReason = [...counts.entries()].map(([reasonCode, count]) => ({ reasonCode, count }))
    .sort((a, b) => b.count - a.count || (a.reasonCode < b.reasonCode ? -1 : 1));
  return {
    projectId,
    recordsIdentified: row.records_identified,
    recordsFromDatabases: row.records_from_databases,
    recordsFromOtherSources: row.records_from_other_sources,
    recordsDuplicatesRemoved: row.records_duplicates_removed,
    recordsScreened: row.records_screened,
    recordsExcluded: row.records_excluded,
    reportsSought: row.reports_sought,
    reportsNotRetrieved: row.reports_not_retrieved,
    reportsAssessed: row.reports_assessed,
    reportsExcluded: row.reports_excluded,
    studiesIncluded: row.studies_included,
    conflictsOpen: row.conflicts_open,
    excludedByReason,
  };
}
async function prismaRoute(db, uid, projectId, requestId) {
  const gate = await projectGate(db, projectId, uid, ["owner", "editor", "analyst", "reviewer", "viewer"]);
  if (gate.status) return gateErr(gate, "Project access denied", requestId);
  const prisma = await prismaCounts(db, projectId);
  if (!prisma) return err(404, "project_not_found", "Project not found", requestId);
  await audit(db, projectId, uid, "prisma_viewed", projectId, {});
  return json({ prisma, generatedTs: Date.now() }, 200, { "x-request-id": requestId });
}

export async function onRequest({ request, env, params }) {
  const requestId = request.headers.get("x-request-id") || uuid("req_");
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = "/" + parts.join("/");
  if (!env.RESEARCH_DB) return err(503, "database_unavailable", "Research database is not provisioned", requestId);
  const db = env.RESEARCH_DB;
  /* Shared helpers handed to the Phase 3 modules (small route hooks only). */
  const P3 = { json, err, audit, uuid, safeEqual, member, getProject, projectGate, gateErr, bodyJson, sha256Hex, prismaCounts };

  /* ---- Phase 6 admin surface (adminAuth inside each handler: the existing
   * research admin token OR a verified Firebase owner claim). Hooked before
   * the pilot gate, like the Phase 3 admin routes. ---- */
  const p6Ctx = { request, env, db, requestId, api: P3 };
  const p6Body = async () => { try { return await bodyJson(request); } catch (e) { return null; } };
  if (path === "/v1/institutions" && request.method === "POST") {
    const body = await p6Body(); if (!body) return err(400, "invalid_body", "Invalid institution payload", requestId);
    return createInstitution(p6Ctx, body);
  }
  if (path === "/v1/admin/institutions" && request.method === "GET") return listAllInstitutions(p6Ctx);
  if (path === "/v1/admin/pricing-note" && request.method === "GET") return pricingNote(p6Ctx);
  if (path === "/v1/admin/incidents" && request.method === "POST") {
    const body = await p6Body(); if (!body) return err(400, "invalid_body", "Invalid incident payload", requestId);
    return createIncident(p6Ctx, body);
  }
  if (path === "/v1/admin/incidents" && request.method === "GET") return listIncidents(p6Ctx);
  const p6IncOne = path.match(/^\/v1\/admin\/incidents\/([^/]+)$/);
  if (p6IncOne && request.method === "GET") return getIncident(p6Ctx, p6IncOne[1]);
  const p6IncStatus = path.match(/^\/v1\/admin\/incidents\/([^/]+)\/status$/);
  if (p6IncStatus && request.method === "POST") {
    const body = await p6Body(); if (!body) return err(400, "invalid_body", "Invalid incident payload", requestId);
    return updateIncidentStatus(p6Ctx, p6IncStatus[1], body);
  }
  const p6InstCredits = path.match(/^\/v1\/institutions\/([^/]+)\/credits$/);
  if (p6InstCredits && request.method === "POST") {
    const body = await p6Body(); if (!body) return err(400, "invalid_body", "Invalid credit payload", requestId);
    return grantCreditsRoute(p6Ctx, p6InstCredits[1], body);
  }
  const p6InstInvoices = path.match(/^\/v1\/institutions\/([^/]+)\/invoices$/);
  if (p6InstInvoices && request.method === "POST") {
    const body = await p6Body(); if (!body) return err(400, "invalid_body", "Invalid invoice payload", requestId);
    return createInvoice(p6Ctx, p6InstInvoices[1], body);
  }
  const p6InvoicePaid = path.match(/^\/v1\/invoices\/([^/]+)\/mark-paid$/);
  if (p6InvoicePaid && request.method === "POST") return markInvoicePaid(p6Ctx, p6InvoicePaid[1]);

  /* ---- Phase 3 worker-facing routes (NO Firebase auth: the worker holds no
   * user tokens; HMAC / per-job token is its only credential). ---- */
  /* stats_model callbacks (Phase 5C/5D) dispatch here when the job id lives in
   * research_stats_jobs; pdf_extract callbacks fall through to jobCallback. */
  const p6StatsCb = path.match(/^\/(?:v1\/)?jobs\/([^/]+)\/callback$/);
  if (p6StatsCb && request.method === "POST") {
    const isStats = await db.prepare("SELECT id FROM research_stats_jobs WHERE id=?").bind(p6StatsCb[1]).first();
    if (isStats) return statsJobCallback(p6Ctx, p6StatsCb[1]);
  }
  const p3Callback = path.match(/^\/(?:v1\/)?jobs\/([^/]+)\/callback$/);
  if (p3Callback && request.method === "POST")
    return jobCallback({ request, env, db, requestId, api: P3 }, p3Callback[1]);
  if (path === "/v1/internal/llm" && request.method === "POST")
    return llmRoute({ request, env, db, requestId, api: P3 });
  if (path === "/v1/internal/literature-search" && request.method === "POST")
    return literatureSearchRoute({ request, env, db, requestId, api: P3 });
  const p3Admin = path.match(/^\/v1\/admin\/institutions(?:\/([^/]+)\/(members|credits))?$/);
  if (p3Admin && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid admin payload", requestId); }
    return adminInstitutionRoute({ request, env, db, requestId, api: P3 }, p3Admin[1] || null, p3Admin[2] || null, body);
  }

  // Queue consumer retrieves the persisted, bounded analysis payload by job ID; queue messages stay tiny.
  const inputLookup = path.match(/^\/v1\/internal\/jobs\/([^/]+)\/input$/);
  if (inputLookup && request.method === "GET") {
    if (!env.RESEARCH_CALLBACK_TOKEN || !safeEqual(request.headers.get("x-research-callback-token") || "", env.RESEARCH_CALLBACK_TOKEN))
      return err(401, "unauthorized", "Invalid worker credentials", requestId);
    const row = await db.prepare("SELECT j.id,m.id AS analysis_id,m.input_json FROM research_jobs j JOIN research_meta_analyses m ON m.job_id=j.id WHERE j.id=? AND j.job_type='meta_analysis'")
      .bind(inputLookup[1]).first();
    if (!row) return err(404, "job_not_found", "Job not found", requestId);
    return json({ analysisId: row.analysis_id, input: JSON.parse(row.input_json) }, 200, { "x-request-id": requestId });
  }

  // Internal callbacks may finish already-queued work even after new submissions are disabled.
  const callback = path.match(/^\/v1\/internal\/jobs\/([^/]+)\/(start|complete)$/);
  if (callback && request.method === "POST") {
    if (!env.RESEARCH_CALLBACK_TOKEN || !safeEqual(request.headers.get("x-research-callback-token") || "", env.RESEARCH_CALLBACK_TOKEN))
      return err(401, "unauthorized", "Invalid callback credentials", requestId);
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid callback payload", requestId); }
    const job = await db.prepare("SELECT id,project_id FROM research_jobs WHERE id=? AND job_type='meta_analysis'").bind(callback[1]).first();
    if (!job) return err(404, "job_not_found", "Job not found", requestId);
    const analysisRow = await db.prepare("SELECT id FROM research_meta_analyses WHERE job_id=?").bind(job.id).first();
    if (!analysisRow || analysisRow.id !== body.analysisId) return err(409, "callback_mismatch", "Callback does not match the analysis job", requestId);
    const now = Date.now();
    if (callback[2] === "start") {
      await db.prepare("UPDATE research_jobs SET status='running',started_ts=COALESCE(started_ts,?) WHERE id=? AND status IN ('queued','running')")
        .bind(now, job.id).run();
      return json({ ok: true, requestId }, 200, { "x-request-id": requestId });
    }
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

  if (env.RESEARCH_MODE !== "pilot")
    return err(404, "not_found", "Research pilot is not enabled", requestId);
  const claims = await caller(request, env);
  if (!claims || !claims.sub) return err(401, "unauthorized", "Sign in to use StewardMD Research", requestId);
  const uid = claims.sub;
  const url = new URL(request.url);

  /* ---- Phase 3 user routes (Firebase auth + project role, same as above). */
  const p3Ctx = { request, env, db, uid, claims, requestId, api: P3 };
  const p3Pdfs = path.match(/^\/v1\/projects\/([^/]+)\/pdfs$/);
  if (p3Pdfs && request.method === "POST")
    return uploadPdf(Object.assign({}, p3Ctx, { projectId: p3Pdfs[1] }));
  const p3Jobs = path.match(/^\/v1\/projects\/([^/]+)\/jobs$/);
  if (p3Jobs && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid job payload", requestId); }
    return createJob(Object.assign({}, p3Ctx, { projectId: p3Jobs[1] }), body);
  }
  const p3JobOne = path.match(/^\/v1\/jobs\/([^/]+)$/);
  if (p3JobOne && request.method === "GET") {
    const out = await getJob(p3Ctx, p3JobOne[1]);
    if (out) return out; /* null -> not a Phase 3 job; pilot lookup below */
  }
  const p3Cancel = path.match(/^\/v1\/jobs\/([^/]+)\/cancel$/);
  if (p3Cancel && request.method === "POST")
    return cancelJob(p3Ctx, p3Cancel[1]);
  if (path === "/v1/credits" && request.method === "GET") return creditsView(p3Ctx);

  /* ---- Phase 3.4/3.5/3.6/3.8 + Phase 4.3 routes (Firebase auth above; each
   * module enforces the project role and answers 404 to an outsider). ---- */
  const p3bBody = async () => { try { return await bodyJson(request); } catch (e) { return null; } };
  if (path === "/v1/extraction-templates" && request.method === "GET") return extractionTemplates(p3Ctx);
  if (path === "/v1/rob-tools" && request.method === "GET") return robTools(p3Ctx);

  const extStudy = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)\/extraction$/);
  if (extStudy && request.method === "GET") return getExtraction(p3Ctx, extStudy[1], extStudy[2], url);
  if (extStudy && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid extraction payload", requestId);
    return putExtraction(p3Ctx, extStudy[1], extStudy[2], body);
  }
  const extSug = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)\/extraction\/suggestions$/);
  if (extSug && request.method === "POST") {
    const body = await p3bBody();
    return extractionSuggestions(p3Ctx, extSug[1], extSug[2], body || {});
  }
  const extAction = path.match(/^\/v1\/extractions\/([^/]+)\/(verify|correct|audit|promote)$/);
  if (extAction && request.method === "GET" && extAction[2] === "audit") return extractionAudit(p3Ctx, extAction[1]);
  if (extAction && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid extraction payload", requestId);
    if (extAction[2] === "verify") return verifyExtraction(p3Ctx, extAction[1], body);
    if (extAction[2] === "correct") return correctExtraction(p3Ctx, extAction[1], body);
    if (extAction[2] === "promote") return promoteExtraction(p3Ctx, extAction[1], body);
  }
  const extAccept = path.match(/^\/v1\/extractions\/([^/]+)\/suggestions\/([^/]+)\/accept$/);
  if (extAccept && request.method === "POST") {
    const body = await p3bBody();
    return acceptSuggestion(p3Ctx, extAccept[1], extAccept[2], body || {});
  }

  const robStudy = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)\/rob$/);
  if (robStudy && request.method === "GET") return getRob(p3Ctx, robStudy[1], robStudy[2], url);
  if (robStudy && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid risk-of-bias payload", requestId);
    return submitRob(p3Ctx, robStudy[1], robStudy[2], body);
  }
  const robAuditRoute = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)\/rob\/audit$/);
  if (robAuditRoute && request.method === "GET") return robAudit(p3Ctx, robAuditRoute[1], robAuditRoute[2], url);
  const robConfCol = path.match(/^\/v1\/projects\/([^/]+)\/rob-conflicts$/);
  if (robConfCol && request.method === "GET") return listRobConflicts(p3Ctx, robConfCol[1], url);
  const robConfResolve = path.match(/^\/v1\/rob-conflicts\/([^/]+)\/resolve$/);
  if (robConfResolve && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid consensus payload", requestId);
    return resolveRobConflict(p3Ctx, robConfResolve[1], body);
  }

  const artCol = path.match(/^\/v1\/projects\/([^/]+)\/artifacts$/);
  if (artCol && request.method === "GET") return listArtifacts(p3Ctx, artCol[1]);
  const pdfUp = path.match(/^\/v1\/projects\/([^/]+)\/pdf-uploads$/);
  if (pdfUp && request.method === "POST") return uploadPdfArtifact(Object.assign({}, p3Ctx, { projectId: pdfUp[1] }));
  const artResult = path.match(/^\/v1\/artifacts\/([^/]+)\/result$/);
  if (artResult && request.method === "GET") return artifactResult(p3Ctx, artResult[1]);

  const dictRoute = path.match(/^\/v1\/projects\/([^/]+)\/data-dictionary$/);
  if (dictRoute && request.method === "GET") return getDictionary(p3Ctx, dictRoute[1]);
  if (dictRoute && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid dictionary payload", requestId);
    return putDictionary(p3Ctx, dictRoute[1], body);
  }
  const dataUp = path.match(/^\/v1\/projects\/([^/]+)\/data-uploads$/);
  if (dataUp && request.method === "POST") return uploadData(Object.assign({}, p3Ctx, { projectId: dataUp[1] }));
  const dataImpCol = path.match(/^\/v1\/projects\/([^/]+)\/data-imports$/);
  if (dataImpCol && request.method === "GET") return listDataImports(p3Ctx, dataImpCol[1], url);
  if (dataImpCol && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid data import payload", requestId);
    return createDataImport(p3Ctx, dataImpCol[1], body);
  }
  const dataImpSnap = path.match(/^\/v1\/data-imports\/([^/]+)\/snapshot$/);
  if (dataImpSnap && request.method === "GET") return getDataSnapshot(p3Ctx, dataImpSnap[1]);
  const dataImpFreeze = path.match(/^\/v1\/data-imports\/([^/]+)\/freeze$/);
  if (dataImpFreeze && request.method === "POST") return freezeDataImport(p3Ctx, dataImpFreeze[1]);
  const dataImpOne = path.match(/^\/v1\/data-imports\/([^/]+)$/);
  if (dataImpOne && request.method === "GET") return getDataImport(p3Ctx, dataImpOne[1]);

  const screenSug = path.match(/^\/v1\/projects\/([^/]+)\/records\/([^/]+)\/screening-suggestions$/);
  if (screenSug && request.method === "GET") return listScreeningSuggestions(p3Ctx, screenSug[1], screenSug[2]);
  if (screenSug && request.method === "POST") return screeningSuggestion(p3Ctx, screenSug[1], screenSug[2]);

  const gradeCol = path.match(/^\/v1\/projects\/([^/]+)\/grade-assessments$/);
  if (gradeCol && request.method === "GET") return listGrade(p3Ctx, gradeCol[1]);
  if (gradeCol && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid GRADE payload", requestId);
    return putGrade(p3Ctx, gradeCol[1], body);
  }
  const gradeOne = path.match(/^\/v1\/projects\/([^/]+)\/grade-assessments\/([^/]+)$/);
  if (gradeOne && request.method === "GET") return getGrade(p3Ctx, gradeOne[1], gradeOne[2]);
  const sofRoute = path.match(/^\/v1\/projects\/([^/]+)\/summary-of-findings$/);
  if (sofRoute && request.method === "GET") return summaryOfFindings(p3Ctx, sofRoute[1]);
  const gradeSug = path.match(/^\/v1\/projects\/([^/]+)\/grade-suggestions$/);
  if (gradeSug && request.method === "GET") return gradeSuggestions(p3Ctx, gradeSug[1], url);

  /* ---- Phase 5A.3 manuscript + 5B checklists (Firebase auth above). ---- */
  if (path === "/v1/checklists" && request.method === "GET") return listChecklists(p3Ctx);
  const checklistOne = path.match(/^\/v1\/checklists\/([^/]+)$/);
  if (checklistOne && request.method === "GET") return getChecklist(p3Ctx, checklistOne[1]);
  const snapRoute = path.match(/^\/v1\/projects\/([^/]+)\/checklist-snapshot$/);
  if (snapRoute && request.method === "GET") return checklistSnapshot(p3Ctx, snapRoute[1]);
  const manualRoute = path.match(/^\/v1\/projects\/([^/]+)\/checklist-manual\/([^/]+)$/);
  if (manualRoute && request.method === "GET") return getManual(p3Ctx, manualRoute[1], manualRoute[2]);
  if (manualRoute && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid checklist payload", requestId);
    return putManual(p3Ctx, manualRoute[1], manualRoute[2], body);
  }
  const manVersions = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/versions$/);
  if (manVersions && request.method === "GET") return listVersions(p3Ctx, manVersions[1]);
  const manSection = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/sections\/([^/]+)$/);
  if (manSection && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid manuscript payload", requestId);
    return putSection(p3Ctx, manSection[1], manSection[2], body);
  }
  const manRequest = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/approval\/request$/);
  if (manRequest && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid manuscript payload", requestId);
    return requestApproval(p3Ctx, manRequest[1], body);
  }
  const manApprove = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/approval\/approve$/);
  if (manApprove && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid manuscript payload", requestId);
    return approveManuscript(p3Ctx, manApprove[1], body);
  }
  const manLock = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/lock$/);
  if (manLock && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid manuscript payload", requestId);
    return lockManuscript(p3Ctx, manLock[1], body);
  }
  const manExport = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/export$/);
  if (manExport && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid manuscript payload", requestId);
    return exportManuscript(p3Ctx, manExport[1], body);
  }
  const manGates = path.match(/^\/v1\/projects\/([^/]+)\/manuscript\/gates$/);
  if (manGates && request.method === "GET") return manuscriptGates(p3Ctx, manGates[1], url);
  const formatRoute = path.match(/^\/v1\/projects\/([^/]+)\/format-check$/);
  if (formatRoute && request.method === "GET") return formatCheck(p3Ctx, formatRoute[1], url);
  const manGet = path.match(/^\/v1\/projects\/([^/]+)\/manuscript$/);
  if (manGet && request.method === "GET") return getManuscript(p3Ctx, manGet[1], url);

  /* ---- Phase 6 user routes (Firebase auth above; each module enforces the
   * project / institution role and answers 404 to an outsider). ---- */

  /* 5C.2/5C.3 IPD compliance (_ipd.js). */
  const ipdEvCol = path.match(/^\/v1\/projects\/([^/]+)\/ipd-evidence$/);
  if (ipdEvCol && request.method === "POST") return uploadEvidence(Object.assign({}, p3Ctx, { projectId: ipdEvCol[1] }));
  if (ipdEvCol && request.method === "GET") return listEvidence(p3Ctx, ipdEvCol[1]);
  const ipdEvFile = path.match(/^\/v1\/ipd-evidence\/([^/]+)\/file$/);
  if (ipdEvFile && request.method === "GET") return evidenceFile(p3Ctx, ipdEvFile[1]);
  const ipdEvDecide = path.match(/^\/v1\/ipd-evidence\/([^/]+)\/(approve|reject)$/);
  if (ipdEvDecide && request.method === "POST") return decideEvidence(p3Ctx, ipdEvDecide[1], ipdEvDecide[2] === "approve");
  const ipdEvOne = path.match(/^\/v1\/ipd-evidence\/([^/]+)$/);
  if (ipdEvOne && request.method === "GET") return getEvidence(p3Ctx, ipdEvOne[1]);
  const ipdConfig = path.match(/^\/v1\/projects\/([^/]+)\/ipd-config$/);
  if (ipdConfig && request.method === "GET") return getIpdConfig(p3Ctx, ipdConfig[1]);
  if (ipdConfig && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid IPD config payload", requestId);
    return putIpdConfig(p3Ctx, ipdConfig[1], body);
  }
  const ipdUp = path.match(/^\/v1\/projects\/([^/]+)\/ipd-uploads$/);
  if (ipdUp && request.method === "POST") return uploadIpd(Object.assign({}, p3Ctx, { projectId: ipdUp[1] }));
  const ipdDsCol = path.match(/^\/v1\/projects\/([^/]+)\/ipd-datasets$/);
  if (ipdDsCol && request.method === "GET") return listIpdDatasets(p3Ctx, ipdDsCol[1]);
  const ipdDsSnap = path.match(/^\/v1\/ipd-datasets\/([^/]+)\/snapshot$/);
  if (ipdDsSnap && request.method === "GET") return ipdSnapshot(p3Ctx, ipdDsSnap[1]);
  const ipdDsOne = path.match(/^\/v1\/ipd-datasets\/([^/]+)$/);
  if (ipdDsOne && request.method === "GET") return getIpdDataset(p3Ctx, ipdDsOne[1]);
  const ipdLogRoute = path.match(/^\/v1\/projects\/([^/]+)\/ipd-access-log$/);
  if (ipdLogRoute && request.method === "GET") return ipdAccessLog(p3Ctx, ipdLogRoute[1]);
  const statsJobCol = path.match(/^\/v1\/projects\/([^/]+)\/stats-jobs$/);
  if (statsJobCol && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid stats job payload", requestId);
    return createStatsJob(p3Ctx, statsJobCol[1], body);
  }
  const statsJobCancel = path.match(/^\/v1\/stats-jobs\/([^/]+)\/cancel$/);
  if (statsJobCancel && request.method === "POST") return cancelStatsJob(p3Ctx, statsJobCancel[1]);
  const statsJobOne = path.match(/^\/v1\/stats-jobs\/([^/]+)$/);
  if (statsJobOne && request.method === "GET") return getStatsJob(p3Ctx, statsJobOne[1]);

  /* 6.1 purchase through the existing MaiK route (_purchase.js). */
  if (path === "/v1/purchase/packs" && request.method === "GET") return purchasePacks(p3Ctx);
  if (path === "/v1/purchase/order" && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid purchase payload", requestId);
    return purchaseOrder(p3Ctx, body);
  }
  if (path === "/v1/purchase/iap-verify" && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid purchase payload", requestId);
    return purchaseIapVerify(p3Ctx, body);
  }

  /* 6.3 cost reports (_reports.js). */
  const costProjectCsv = path.match(/^\/v1\/projects\/([^/]+)\/cost-report\.csv$/);
  if (costProjectCsv && request.method === "GET") return projectCostReport(p3Ctx, costProjectCsv[1], url, true);
  const costProject = path.match(/^\/v1\/projects\/([^/]+)\/cost-report$/);
  if (costProject && request.method === "GET") return projectCostReport(p3Ctx, costProject[1], url, false);
  if (path === "/v1/cost-report.csv" && request.method === "GET") return userCostReport(p3Ctx, url, true);
  if (path === "/v1/cost-report" && request.method === "GET") return userCostReport(p3Ctx, url, false);

  /* 6.5 institution workspaces (_institutions.js). */
  if (path === "/v1/institutions" && request.method === "GET") return myInstitutions(p3Ctx);
  const instInvoices = path.match(/^\/v1\/institutions\/([^/]+)\/invoices$/);
  if (instInvoices && request.method === "GET") return listInvoices(p3Ctx, instInvoices[1]);
  const instSeats = path.match(/^\/v1\/institutions\/([^/]+)\/seats$/);
  if (instSeats && request.method === "GET") return institutionSeats(p3Ctx, instSeats[1]);
  const instMembers = path.match(/^\/v1\/institutions\/([^/]+)\/members$/);
  if (instMembers && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid member payload", requestId);
    return addInstitutionMember(p3Ctx, instMembers[1], body);
  }
  const instMemberOne = path.match(/^\/v1\/institutions\/([^/]+)\/members\/([^/]+)$/);
  if (instMemberOne && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid member payload", requestId);
    return updateInstitutionMember(p3Ctx, instMemberOne[1], instMemberOne[2], body);
  }
  if (instMemberOne && request.method === "DELETE") return removeInstitutionMember(p3Ctx, instMemberOne[1], instMemberOne[2]);
  const instProjects = path.match(/^\/v1\/institutions\/([^/]+)\/projects$/);
  if (instProjects && request.method === "GET") return listInstitutionProjects(p3Ctx, instProjects[1]);
  if (instProjects && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid project payload", requestId);
    return createInstitutionProject(p3Ctx, instProjects[1], body);
  }
  const instOnboarding = path.match(/^\/v1\/institutions\/([^/]+)\/onboarding$/);
  if (instOnboarding && request.method === "GET") return institutionOnboarding(p3Ctx, instOnboarding[1]);
  if (instOnboarding && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid onboarding payload", requestId);
    return putInstitutionOnboarding(p3Ctx, instOnboarding[1], body);
  }
  const instOne = path.match(/^\/v1\/institutions\/([^/]+)$/);
  if (instOne && request.method === "GET") return getInstitutionRoute(p3Ctx, instOne[1]);

  /* 5D.1 study templates (_templates.js, read-only). */
  if (path === "/v1/study-templates" && request.method === "GET") return listTemplates(p3Ctx);
  const templateOne = path.match(/^\/v1\/study-templates\/([^/]+)$/);
  if (templateOne && request.method === "GET") return getTemplate(p3Ctx, templateOne[1]);

  /* 5B.3 journals (_journals.js, read-only + deterministic match). */
  if (path === "/v1/journals/match" && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid match payload", requestId);
    return matchJournals(p3Ctx, body);
  }
  if (path === "/v1/journals" && request.method === "GET") return listJournals(p3Ctx, url);
  const journalOne = path.match(/^\/v1\/journals\/([^/]+)$/);
  if (journalOne && request.method === "GET") return getJournal(p3Ctx, journalOne[1]);

  /* 5B.5 reviewer-response workspace (_responses.js). */
  const rcCol = path.match(/^\/v1\/projects\/([^/]+)\/reviewer-comments$/);
  if (rcCol && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid reviewer comment payload", requestId);
    return createComment(p3Ctx, rcCol[1], body);
  }
  if (rcCol && request.method === "GET") return listComments(p3Ctx, rcCol[1], url);
  const rrCol = path.match(/^\/v1\/reviewer-comments\/([^/]+)\/responses$/);
  if (rrCol && request.method === "POST") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid reviewer response payload", requestId);
    return createResponse(p3Ctx, rrCol[1], body);
  }
  if (rrCol && request.method === "GET") return listResponses(p3Ctx, rrCol[1]);
  const rrProject = path.match(/^\/v1\/projects\/([^/]+)\/reviewer-responses$/);
  if (rrProject && request.method === "GET") return listProjectResponses(p3Ctx, rrProject[1]);
  const rrOne = path.match(/^\/v1\/reviewer-responses\/([^/]+)$/);
  if (rrOne && request.method === "PUT") {
    const body = await p3bBody(); if (!body) return err(400, "invalid_body", "Invalid reviewer response payload", requestId);
    return updateResponse(p3Ctx, rrOne[1], body);
  }

  if (path === "/v1/projects" && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid project payload", requestId); }
    const out = await createProject(db, uid, body);
    return out.error ? err(400, "invalid_project", out.error, requestId) : json({ ...out, requestId }, 201, { "x-request-id": requestId });
  }
  if (path === "/v1/projects" && request.method === "GET") return listProjects(db, uid, url, requestId);

  const proj = path.match(/^\/v1\/projects\/([^/]+)$/);
  if (proj && request.method === "GET") return getProjectRoute(db, uid, proj[1], requestId);
  if (proj && (request.method === "PUT" || request.method === "PATCH")) {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid project payload", requestId); }
    return updateProject(db, uid, proj[1], body, requestId);
  }
  if (proj && request.method === "DELETE") return deleteProject(db, uid, proj[1], requestId);

  const mem = path.match(/^\/v1\/projects\/([^/]+)\/members$/);
  if (mem && request.method === "GET") return listMembers(db, uid, mem[1], requestId);
  if (mem && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid member payload", requestId); }
    return addMember(db, uid, mem[1], body, requestId);
  }

  const findStudiesRoute = path.match(/^\/v1\/projects\/([^/]+)\/find-studies$/);
  if (findStudiesRoute && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid search payload", requestId); }
    return findStudies(p3Ctx, findStudiesRoute[1], body);
  }
  const autoAddRoute = path.match(/^\/v1\/projects\/([^/]+)\/studies\/auto-add$/);
  if (autoAddRoute && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid study payload", requestId); }
    return autoAddStudies(p3Ctx, autoAddRoute[1], body);
  }
  const aiDraftRoute = path.match(/^\/v1\/projects\/([^/]+)\/ai-draft$/);
  if (aiDraftRoute && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid draft payload", requestId); }
    return aiDraft(p3Ctx, aiDraftRoute[1], body);
  }
  const paperExplainRoute = path.match(/^\/v1\/projects\/([^/]+)\/paper-card\/explain$/);
  if (paperExplainRoute && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid study card payload", requestId); }
    return explainPaperCard(p3Ctx, paperExplainRoute[1], body);
  }
  const paperCardRoute = path.match(/^\/v1\/projects\/([^/]+)\/paper-card$/);
  if (paperCardRoute && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid study card payload", requestId); }
    return paperCard(p3Ctx, paperCardRoute[1], body);
  }

  const stCol = path.match(/^\/v1\/projects\/([^/]+)\/studies$/);
  if (stCol && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid study payload", requestId); }
    return createStudy(db, uid, stCol[1], body, requestId);
  }
  if (stCol && request.method === "GET") return listStudies(db, uid, stCol[1], url, requestId);

  const stOne = path.match(/^\/v1\/projects\/([^/]+)\/studies\/([^/]+)$/);
  if (stOne && request.method === "GET") return getStudy(db, uid, stOne[1], stOne[2], requestId);
  if (stOne && (request.method === "PUT" || request.method === "PATCH")) {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid study payload", requestId); }
    return updateStudy(db, uid, stOne[1], stOne[2], body, requestId);
  }
  if (stOne && request.method === "DELETE") {
    let version = Number(url.searchParams.get("version"));
    if (request.body) {
      try {
        const body = await bodyJson(request);
        if (body.version !== undefined) version = body.version;
      } catch { return err(400, "invalid_body", "Invalid study payload", requestId); }
    }
    if (!Number.isFinite(version)) return err(400, "invalid_body", "version must be an integer of at least 1", requestId);
    return deleteStudy(db, uid, stOne[1], stOne[2], version, requestId);
  }

  const runCol = path.match(/^\/v1\/projects\/([^/]+)\/runs$/);
  if (runCol && request.method === "POST") {
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid run payload", requestId); }
    return createRun(db, uid, runCol[1], body, requestId);
  }
  if (runCol && request.method === "GET") return listRuns(db, uid, runCol[1], url, requestId);

  const runOne = path.match(/^\/v1\/projects\/([^/]+)\/runs\/([^/]+)$/);
  if (runOne && request.method === "GET") return getRun(db, uid, runOne[1], runOne[2], requestId);

  const paper = path.match(/^\/v1\/projects\/([^/]+)\/papers$/);
  if (paper && request.method === "POST") return uploadPaper(request, env, db, uid, paper[1], requestId);

  const meta = path.match(/^\/v1\/projects\/([^/]+)\/meta-analyses$/);
  if (meta && request.method === "POST") {
    if (!env.RESEARCH_QUEUE) return err(503, "queue_unavailable", "Research job queue is not provisioned", requestId);
    let body; try { body = await bodyJson(request); } catch { return err(400, "invalid_body", "Invalid analysis payload", requestId); }
    return submitMetaAnalysis(db, env.RESEARCH_QUEUE, uid, meta[1], body, requestId);
  }

  const resultMatch = path.match(/^\/v1\/projects\/([^/]+)\/meta-analyses\/([^/]+)$/);
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

  /* ---- Phase 2 routes (docs/research/contracts/phase-2) ---- */
  const readBody = async () => {
    try { return await bodyJson(request); }
    catch (e) { return null; }
  };

  const protoCol = path.match(/^\/v1\/projects\/([^/]+)\/protocols$/);
  if (protoCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid protocol payload", requestId);
    return createProtocol(db, uid, protoCol[1], body, requestId);
  }
  if (protoCol && request.method === "GET") return listProtocols(db, uid, protoCol[1], url, requestId);
  const protoVer = path.match(/^\/v1\/protocols\/([^/]+)\/versions$/);
  if (protoVer && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid protocol payload", requestId);
    return versionProtocol(db, uid, protoVer[1], body, requestId);
  }
  const protoLock = path.match(/^\/v1\/protocols\/([^/]+)\/lock$/);
  if (protoLock && request.method === "POST") return lockProtocol(request, db, uid, protoLock[1], requestId);
  const protoPros = path.match(/^\/v1\/protocols\/([^/]+)\/prospero$/);
  if (protoPros && request.method === "GET") return prosperoExport(db, uid, protoPros[1], url, requestId);
  const protoOne = path.match(/^\/v1\/protocols\/([^/]+)$/);
  if (protoOne && request.method === "GET") return getProtocol(db, uid, protoOne[1], url, requestId);

  const invCol = path.match(/^\/v1\/projects\/([^/]+)\/invitations$/);
  if (invCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid invitation payload", requestId);
    return createInvitation(db, uid, invCol[1], body, requestId);
  }
  if (invCol && request.method === "GET") return listInvitations(db, uid, invCol[1], url, requestId);
  if (path === "/v1/invitations/accept" && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid invitation payload", requestId);
    return acceptInvitation(db, uid, body, requestId);
  }

  const searchCol = path.match(/^\/v1\/projects\/([^/]+)\/searches$/);
  if (searchCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid search payload", requestId);
    return createSearchRun(env, db, uid, searchCol[1], body, requestId);
  }
  if (searchCol && request.method === "GET") return listSearchRuns(db, uid, searchCol[1], url, requestId);
  const searchOne = path.match(/^\/v1\/searches\/([^/]+)$/);
  if (searchOne && request.method === "GET") return getSearchRun(db, uid, searchOne[1], requestId);

  const importUpload = path.match(/^\/v1\/projects\/([^/]+)\/import-uploads$/);
  if (importUpload && request.method === "POST") return uploadImportFile(request, env, db, uid, importUpload[1], requestId);
  const importCol = path.match(/^\/v1\/projects\/([^/]+)\/imports$/);
  if (importCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid import payload", requestId);
    return createImport(env, db, uid, importCol[1], body, requestId);
  }

  const dedupRun = path.match(/^\/v1\/projects\/([^/]+)\/dedup:run$/);
  if (dedupRun && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid dedup payload", requestId);
    return runDedupRoute(db, uid, dedupRun[1], body, requestId);
  }
  const dedupGroups = path.match(/^\/v1\/projects\/([^/]+)\/dedup-groups$/);
  if (dedupGroups && request.method === "GET") return listDedupGroups(db, uid, dedupGroups[1], url, requestId);

  const reasonCol = path.match(/^\/v1\/projects\/([^/]+)\/exclusion-reasons$/);
  if (reasonCol && request.method === "GET") return listReasons(db, uid, reasonCol[1], requestId);
  if (reasonCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid reason payload", requestId);
    return createReason(db, uid, reasonCol[1], body, requestId);
  }

  const recCol = path.match(/^\/v1\/projects\/([^/]+)\/records$/);
  if (recCol && request.method === "GET") return listRecords(db, uid, recCol[1], url, requestId);
  if (recCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid record payload", requestId);
    return createDirectRecord(db, uid, recCol[1], body, requestId);
  }
  const recDec = path.match(/^\/v1\/records\/([^/]+)\/decisions$/);
  if (recDec && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid decision payload", requestId);
    return createDecision(db, uid, "record", recDec[1], body, requestId);
  }
  if (recDec && request.method === "GET") return listDecisions(db, uid, "record", recDec[1], requestId);
  const recOne = path.match(/^\/v1\/records\/([^/]+)$/);
  if (recOne && request.method === "GET") return getRecord(db, uid, recOne[1], requestId);

  const repCol = path.match(/^\/v1\/projects\/([^/]+)\/reports$/);
  if (repCol && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid report payload", requestId);
    return createReport(db, uid, repCol[1], body, requestId);
  }
  if (repCol && request.method === "GET") return listReports(db, uid, repCol[1], url, requestId);
  const repDec = path.match(/^\/v1\/reports\/([^/]+)\/decisions$/);
  if (repDec && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid decision payload", requestId);
    return createDecision(db, uid, "report", repDec[1], body, requestId);
  }
  if (repDec && request.method === "GET") return listDecisions(db, uid, "report", repDec[1], requestId);
  const repStatus = path.match(/^\/v1\/reports\/([^/]+)\/status$/);
  if (repStatus && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid report payload", requestId);
    return setReportStatus(db, uid, repStatus[1], body, requestId);
  }
  const repOne = path.match(/^\/v1\/reports\/([^/]+)$/);
  if (repOne && request.method === "GET") {
    const resolved = await resolveItemRoute(db, uid, "report", repOne[1], ["owner", "editor", "analyst", "reviewer", "viewer"], requestId);
    if (resolved.status) return err(resolved.status, resolved.code, "Report not found", requestId);
    return json({ report: reportOf(resolved.row) }, 200, { "x-request-id": requestId });
  }

  const confCol = path.match(/^\/v1\/projects\/([^/]+)\/conflicts$/);
  if (confCol && request.method === "GET") return listConflicts(db, uid, confCol[1], url, requestId);
  const confResolve = path.match(/^\/v1\/conflicts\/([^/]+)\/resolve$/);
  if (confResolve && request.method === "POST") {
    const body = await readBody(); if (!body) return err(400, "invalid_body", "Invalid resolution payload", requestId);
    return resolveConflict(db, uid, confResolve[1], body, requestId);
  }

  const prisma = path.match(/^\/v1\/projects\/([^/]+)\/prisma$/);
  if (prisma && request.method === "GET") return prismaRoute(db, uid, prisma[1], requestId);

  return err(404, "not_found", "Unknown Research API endpoint", requestId);
}
