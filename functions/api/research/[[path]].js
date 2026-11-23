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
 */
import { verifyFirebaseClaims } from "../../_fbauth.js";
import { run as engineRun, version as ENGINE_VERSION } from "./_engine.js";

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

export async function onRequest({ request, env, params }) {
  const requestId = request.headers.get("x-request-id") || uuid("req_");
  const parts = Array.isArray(params.path) ? params.path : (params.path ? [params.path] : []);
  const path = "/" + parts.join("/");
  if (!env.RESEARCH_DB) return err(503, "database_unavailable", "Research database is not provisioned", requestId);
  const db = env.RESEARCH_DB;

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
  return err(404, "not_found", "Unknown Research API endpoint", requestId);
}
