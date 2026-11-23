/* ResearchMD Phase 5B.5 reviewer-response workspace (ES module, server side).
 * Contract: docs/research/contracts/phase-6/responses.md. Migration 0005.
 * Comments are immutable reviewer input; every response carries the mandatory
 * manuscript-version + section-change link (a validated pointer to the Phase
 * 5A version; the 5A D1 store lands later). Responses use the house
 * optimistic-concurrency version (stale -> 409 with the current row).
 */

const WRITE_ROLES = ["owner", "editor", "analyst"];
const ALL_ROLES = ["owner", "editor", "analyst", "reviewer", "viewer"];

function commentOf(row) {
  return { id: row.id, projectId: row.project_id, round: row.round,
    reviewerLabel: row.reviewer_label, text: row.text, sectionRef: row.section_ref || "",
    createdBy: row.created_by, createdTs: row.created_ts };
}
function responseOf(row) {
  return { id: row.id, projectId: row.project_id, commentId: row.comment_id,
    text: row.text, manuscriptVersionId: row.manuscript_version_id,
    sectionId: row.section_id, changeNote: row.change_note, status: row.status,
    version: row.version, createdBy: row.created_by, createdTs: row.created_ts, updatedAt: row.updated_ts };
}
function isInt(n) { return typeof n === "number" && Number.isInteger(n); }
function boundedString(v, max) { return typeof v === "string" && v.trim() && v.length <= max; }

/* ---- comments ---------------------------------------------------------------- */
export async function createComment(ctx, projectId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid, projectGate, gateErr } = api;
  const gate = await projectGate(db, projectId, uid, WRITE_ROLES);
  if (gate.status) return gateErr(gate, "Reviewer comments need an owner, editor or analyst role", requestId);
  const round = body.round === undefined ? 1 : body.round;
  if (!isInt(round) || round < 1 || round > 100)
    return err(400, "invalid_comment", "round must be an integer of 1-100", requestId);
  if (!boundedString(body.reviewerLabel, 80))
    return err(400, "invalid_comment", "reviewerLabel must be 1-80 characters", requestId);
  if (!boundedString(body.text, 8000))
    return err(400, "invalid_comment", "text must be 1-8000 characters", requestId);
  const sectionRef = body.sectionRef === undefined ? "" : String(body.sectionRef);
  if (sectionRef.length > 200) return err(400, "invalid_comment", "sectionRef must be at most 200 characters", requestId);
  const id = uuid("rc_"), now = Date.now();
  await db.prepare("INSERT INTO research_reviewer_comments (id,project_id,round,reviewer_label,text,section_ref,created_by,created_ts) VALUES (?,?,?,?,?,?,?,?)")
    .bind(id, projectId, round, body.reviewerLabel.trim(), body.text, sectionRef, uid, now).run();
  await audit(db, projectId, uid, "reviewer_comment_added", id, { round });
  const row = await db.prepare("SELECT * FROM research_reviewer_comments WHERE id=?").bind(id).first();
  return json({ comment: commentOf(row) }, 201, { "x-request-id": requestId });
}
export async function listComments(ctx, projectId, url) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return api.gateErr(gate, "Project access denied", requestId);
  const roundRaw = url.searchParams.get("round");
  let rows;
  if (roundRaw !== null && roundRaw !== "") {
    const round = Number(roundRaw);
    if (!isInt(round) || round < 1) return api.err(400, "invalid_body", "round must be a positive integer", requestId);
    rows = (await db.prepare("SELECT * FROM research_reviewer_comments WHERE project_id=? AND round=? ORDER BY created_ts ASC, id ASC LIMIT 200")
      .bind(projectId, round).all()).results || [];
  } else {
    rows = (await db.prepare("SELECT * FROM research_reviewer_comments WHERE project_id=? ORDER BY round ASC, created_ts ASC, id ASC LIMIT 200")
      .bind(projectId).all()).results || [];
  }
  return api.json({ comments: rows.map(commentOf) }, 200, { "x-request-id": requestId });
}
async function resolveComment(db, uid, commentId, roles) {
  const row = await db.prepare("SELECT * FROM research_reviewer_comments WHERE id=?").bind(commentId).first();
  if (!row) return { status: 404, code: "comment_not_found" };
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  if (!me || roles.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
      .bind(row.project_id, uid).first();
    return any ? { status: 403, code: "not_member" } : { status: 404, code: "comment_not_found" };
  }
  return { row, projectId: row.project_id, role: me.role };
}

/* ---- responses ----------------------------------------------------------------- */
export async function createResponse(ctx, commentId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit, uuid } = api;
  const resolved = await resolveComment(db, uid, commentId, WRITE_ROLES);
  if (resolved.status)
    return err(resolved.status, resolved.code,
      resolved.code === "not_member" ? "Responses need an owner, editor or analyst role" : "Comment not found", requestId);
  if (!boundedString(body.text, 8000))
    return err(400, "invalid_response", "text must be 1-8000 characters", requestId);
  /* Mandatory link: manuscript version + section change (plan 5B.5). */
  if (!boundedString(body.manuscriptVersionId, 120))
    return err(400, "invalid_response", "manuscriptVersionId is required (1-120 characters)", requestId);
  if (!boundedString(body.sectionId, 120))
    return err(400, "invalid_response", "sectionId is required (1-120 characters)", requestId);
  if (!boundedString(body.changeNote, 2000))
    return err(400, "invalid_response", "changeNote is required (1-2000 characters)", requestId);
  const id = uuid("rr_"), now = Date.now();
  await db.prepare("INSERT INTO research_reviewer_responses (id,project_id,comment_id,text,manuscript_version_id,section_id,change_note,status,version,created_by,created_ts,updated_ts) VALUES (?,?,?,?,?,?,?,'draft',1,?,?,?)")
    .bind(id, resolved.projectId, commentId, body.text, body.manuscriptVersionId.trim(),
      body.sectionId.trim(), body.changeNote, uid, now, now).run();
  await audit(db, resolved.projectId, uid, "reviewer_response_added", id, { commentId, sectionId: body.sectionId });
  const row = await db.prepare("SELECT * FROM research_reviewer_responses WHERE id=?").bind(id).first();
  return json({ response: responseOf(row) }, 201, { "x-request-id": requestId });
}
export async function listResponses(ctx, commentId) {
  const { db, uid, requestId, api } = ctx;
  const resolved = await resolveComment(db, uid, commentId, ALL_ROLES);
  if (resolved.status) return api.err(resolved.status, resolved.code, "Comment not found", requestId);
  const rows = (await db.prepare("SELECT * FROM research_reviewer_responses WHERE comment_id=? ORDER BY created_ts ASC, id ASC")
    .bind(commentId).all()).results || [];
  return api.json({ responses: rows.map(responseOf) }, 200, { "x-request-id": requestId });
}
export async function listProjectResponses(ctx, projectId) {
  const { db, uid, requestId, api } = ctx;
  const gate = await api.projectGate(db, projectId, uid, ALL_ROLES);
  if (gate.status) return api.gateErr(gate, "Project access denied", requestId);
  const rows = (await db.prepare("SELECT * FROM research_reviewer_responses WHERE project_id=? ORDER BY created_ts DESC, id DESC LIMIT 200")
    .bind(projectId).all()).results || [];
  return api.json({ responses: rows.map(responseOf) }, 200, { "x-request-id": requestId });
}
export async function updateResponse(ctx, responseId, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, audit } = api;
  const row = await db.prepare("SELECT * FROM research_reviewer_responses WHERE id=?").bind(responseId).first();
  if (!row) return err(404, "response_not_found", "Response not found", requestId);
  const me = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
    .bind(row.project_id, uid).first();
  if (!me || WRITE_ROLES.indexOf(me.role) < 0) {
    const any = await db.prepare("SELECT role FROM research_members WHERE project_id=? AND uid=?")
      .bind(row.project_id, uid).first();
    return any ? err(403, "not_member", "Responses need an owner, editor or analyst role", requestId)
      : err(404, "response_not_found", "Response not found", requestId);
  }
  if (!isInt(body.version) || body.version < 1)
    return err(400, "invalid_body", "version must be an integer of at least 1", requestId);
  if (body.version !== row.version)
    return json({ error: { code: "stale_version", message: "Response changed on the server", requestId },
      current: { response: responseOf(row) } }, 409, { "x-request-id": requestId });
  const patch = {};
  if (body.text !== undefined) {
    if (!boundedString(body.text, 8000)) return err(400, "invalid_response", "text must be 1-8000 characters", requestId);
    patch.text = body.text;
  }
  if (body.manuscriptVersionId !== undefined) {
    if (!boundedString(body.manuscriptVersionId, 120)) return err(400, "invalid_response", "manuscriptVersionId must be 1-120 characters", requestId);
    patch.manuscript_version_id = body.manuscriptVersionId.trim();
  }
  if (body.sectionId !== undefined) {
    if (!boundedString(body.sectionId, 120)) return err(400, "invalid_response", "sectionId must be 1-120 characters", requestId);
    patch.section_id = body.sectionId.trim();
  }
  if (body.changeNote !== undefined) {
    if (!boundedString(body.changeNote, 2000)) return err(400, "invalid_response", "changeNote must be 1-2000 characters", requestId);
    patch.change_note = body.changeNote;
  }
  if (body.status !== undefined) {
    if (body.status !== "draft" && body.status !== "final")
      return err(400, "invalid_response", "status must be draft or final", requestId);
    patch.status = body.status;
  }
  if (!Object.keys(patch).length) return err(400, "invalid_response", "Nothing to update", requestId);
  const now = Date.now();
  await db.prepare("UPDATE research_reviewer_responses SET text=COALESCE(?,text),manuscript_version_id=COALESCE(?,manuscript_version_id),section_id=COALESCE(?,section_id),change_note=COALESCE(?,change_note),status=COALESCE(?,status),version=version+1,updated_ts=? WHERE id=? AND version=?")
    .bind(patch.text !== undefined ? patch.text : null,
      patch.manuscript_version_id !== undefined ? patch.manuscript_version_id : null,
      patch.section_id !== undefined ? patch.section_id : null,
      patch.change_note !== undefined ? patch.change_note : null,
      patch.status !== undefined ? patch.status : null, now, responseId, body.version).run();
  await audit(db, row.project_id, uid, "reviewer_response_updated", responseId,
    { version: row.version + 1, fields: Object.keys(patch) });
  const fresh = await db.prepare("SELECT * FROM research_reviewer_responses WHERE id=?").bind(responseId).first();
  return json({ response: responseOf(fresh) }, 200, { "x-request-id": requestId });
}
