/* ResearchMD Phase 6.5 institution workspaces (ES module, server side).
 * Contract: docs/research/contracts/phase-6/institutions.md. Migration 0005
 * adds seats, member roles, project institution_id and the onboarding store.
 * Phase 3 institution tables and the token-only /v1/admin/institutions*
 * routes (_credits.js) are untouched.
 *
 * adminAuth (exported, shared with 6.1 / 6.3 / 5C incidents) accepts EITHER
 * existing admin credential: the Phase 3 research admin token
 * (x-research-admin-token, constant-time) OR a Firebase ID token whose
 * VERIFIED email is an owner (the app's existing admin claim, _adminauth.js).
 * Institution membership alone never grants a project role: project access
 * stays governed by research_members (plan section 11 tenant isolation).
 */
import { verifyFirebaseClaims, verifiedEmailOf } from "../../_fbauth.js";
import { ownerEmails } from "../../_adminauth.js";

const INST_ROLES = ["admin", "member"];
const MANUAL_ONBOARDING = ["pilot_agreement_signed", "training_completed"];
const ONBOARDING_LABELS = {
  workspace_created: "Workspace created",
  members_added: "Members added",
  credits_granted: "Credits granted",
  first_project: "First project created",
  first_review: "First analysis run saved",
  pilot_agreement_signed: "Pilot agreement signed",
  training_completed: "Team training completed",
};

export async function adminAuth(ctx) {
  const { request, env, api } = ctx;
  if (env.RESEARCH_ADMIN_TOKEN &&
      api.safeEqual(request.headers.get("x-research-admin-token") || "", env.RESEARCH_ADMIN_TOKEN))
    return { ok: true, via: "research-admin-token", uid: "admin" };
  const token = (request.headers.get("authorization") || "").replace(/^Bearer\s+/i, "").trim();
  const claims = token ? await verifyFirebaseClaims(token, env) : null;
  if (claims && claims.sub) {
    const email = verifiedEmailOf(claims);
    if (email && ownerEmails(env).indexOf(email) >= 0)
      return { ok: true, via: "owner-claim", uid: claims.sub, claims };
    return { ok: false, status: 403, code: "admin_only" };
  }
  return { ok: false, status: 401, code: "unauthorized" };
}
export function adminErr(ctx, auth) {
  return ctx.api.err(auth.status, auth.code,
    auth.code === "admin_only" ? "This route needs a platform admin" : "Sign in as an admin to use this route",
    ctx.requestId);
}

function instOf(row) {
  return { id: row.id, name: row.name, seats: row.seats, createdTs: row.created_ts };
}
async function getInstitution(db, id) {
  return db.prepare("SELECT * FROM research_institutions WHERE id=?").bind(id).first();
}
async function instMember(db, id, uid) {
  return db.prepare("SELECT * FROM research_institution_members WHERE institution_id=? AND uid=?")
    .bind(id, uid).first();
}
/* Outsider gate: unknown institution or non-member -> 404 (house pattern). */
async function instGate(db, id, uid) {
  const inst = await getInstitution(db, id);
  if (!inst) return { status: 404, code: "institution_not_found" };
  const me = await instMember(db, id, uid);
  if (!me) return { status: 404, code: "institution_not_found" };
  return { inst, role: me.role };
}
/* Institution admin OR platform admin (adminAuth). Returns {ok, uid} or the
 * error fields; callers turn the latter into a response with adminErr/err. */
async function instAdminAuth(ctx, id) {
  const { db, uid } = ctx;
  const me = await instMember(db, id, uid);
  if (me && me.role === "admin") return { ok: true, uid };
  const platform = await adminAuth(ctx);
  if (platform.ok) return { ok: true, uid: platform.uid };
  if (me) return { ok: false, status: 403, code: "inst_admin_only" };
  return { ok: false, status: 404, code: "institution_not_found" };
}
async function seatCount(db, id) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM research_institution_members WHERE institution_id=?")
    .bind(id).first();
  return (row && row.n) || 0;
}
async function adminCount(db, id) {
  const row = await db.prepare("SELECT COUNT(*) AS n FROM research_institution_members WHERE institution_id=? AND role='admin'")
    .bind(id).first();
  return (row && row.n) || 0;
}

/* ---- POST /v1/institutions (adminAuth) ------------------------------------ */
export async function createInstitution(ctx, body) {
  const { env, db, requestId, api } = ctx;
  const { json, err, uuid } = api;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const name = typeof body.name === "string" ? body.name.trim() : "";
  if (!name || name.length > 120) return err(400, "invalid_body", "name must be 1-120 characters", requestId);
  const seats = body.seats === undefined ? 10 : body.seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > 500)
    return err(400, "invalid_body", "seats must be an integer of 1-500", requestId);
  const id = uuid("inst_"), now = Date.now();
  await db.prepare("INSERT INTO research_institutions (id,name,created_by,created_ts,seats) VALUES (?,?,?,?,?)")
    .bind(id, name, auth.uid, now, seats).run();
  const row = await getInstitution(db, id);
  return json({ institution: instOf(row) }, 201, { "x-request-id": requestId });
}

/* ---- GET /v1/admin/institutions (adminAuth) ------------------------------- */
export async function listAllInstitutions(ctx) {
  const { db, requestId, api } = ctx;
  const auth = await adminAuth(ctx);
  if (!auth.ok) return adminErr(ctx, auth);
  const rows = (await db.prepare("SELECT * FROM research_institutions ORDER BY created_ts DESC LIMIT 100").all()).results || [];
  const institutions = [];
  for (const r of rows) institutions.push(Object.assign(instOf(r), { usedSeats: await seatCount(db, r.id) }));
  return api.json({ institutions }, 200, { "x-request-id": requestId });
}

/* ---- GET /v1/institutions (the caller's memberships) ---------------------- */
export async function myInstitutions(ctx) {
  const { db, uid, requestId, api } = ctx;
  const rows = (await db.prepare(
    "SELECT i.*, m.role AS my_role FROM research_institution_members m JOIN research_institutions i ON i.id=m.institution_id WHERE m.uid=? ORDER BY m.created_ts ASC")
    .bind(uid).all()).results || [];
  return api.json({ institutions: rows.map((r) => Object.assign(instOf(r), { role: r.my_role })) },
    200, { "x-request-id": requestId });
}

/* ---- GET /v1/institutions/{id} / seats ------------------------------------ */
export async function getInstitutionRoute(ctx, id) {
  const { db, uid, requestId, api } = ctx;
  const gate = await instGate(db, id, uid);
  if (gate.status) return api.err(gate.status, gate.code, "Institution not found", requestId);
  return api.json({ institution: Object.assign(instOf(gate.inst), { role: gate.role }) },
    200, { "x-request-id": requestId });
}
export async function institutionSeats(ctx, id) {
  const { db, uid, requestId, api } = ctx;
  const gate = await instGate(db, id, uid);
  if (gate.status) return api.err(gate.status, gate.code, "Institution not found", requestId);
  const rows = (await db.prepare("SELECT uid,role,created_ts FROM research_institution_members WHERE institution_id=? ORDER BY created_ts ASC")
    .bind(id).all()).results || [];
  return api.json({ seats: gate.inst.seats, used: rows.length,
    members: rows.map((r) => ({ uid: r.uid, role: r.role, createdTs: r.created_ts })) },
    200, { "x-request-id": requestId });
}

/* ---- Members: add / update role / remove (inst admin or platform admin) --- */
export async function addInstitutionMember(ctx, id, body) {
  const { db, requestId, api } = ctx;
  const { json, err, uuid } = api;
  const inst = await getInstitution(db, id);
  if (!inst) return err(404, "institution_not_found", "Institution not found", requestId);
  const auth = await instAdminAuth(ctx, id);
  if (!auth.ok) return err(auth.status, auth.code,
    auth.code === "inst_admin_only" ? "Managing members needs an institution admin" : "Institution not found", requestId);
  const newUid = typeof body.uid === "string" ? body.uid.trim() : "";
  if (!newUid || newUid.length > 128) return err(400, "invalid_body", "uid must be 1-128 characters", requestId);
  const role = body.role === undefined ? "member" : body.role;
  if (INST_ROLES.indexOf(role) < 0) return err(400, "invalid_body", "role must be admin or member", requestId);
  const existing = await instMember(db, id, newUid);
  const now = Date.now();
  if (existing) {
    if (existing.role === "admin" && role !== "admin" && (await adminCount(db, id)) <= 1)
      return err(409, "last_admin", "An institution needs at least one admin", requestId);
    await db.prepare("UPDATE research_institution_members SET role=? WHERE institution_id=? AND uid=?")
      .bind(role, id, newUid).run();
    return json({ member: { institutionId: id, uid: newUid, role, createdTs: existing.created_ts } },
      200, { "x-request-id": requestId });
  }
  if ((await seatCount(db, id)) >= inst.seats)
    return err(409, "seats_full", "All institution seats are in use. Raise the seat count or remove a member.", requestId);
  await db.prepare("INSERT INTO research_institution_members (institution_id,uid,created_ts,role) VALUES (?,?,?,?)")
    .bind(id, newUid, now, role).run();
  return json({ member: { institutionId: id, uid: newUid, role, createdTs: now } },
    201, { "x-request-id": requestId });
}
export async function updateInstitutionMember(ctx, id, memberUid, body) {
  const { db, requestId, api } = ctx;
  const inst = await getInstitution(db, id);
  if (!inst) return api.err(404, "institution_not_found", "Institution not found", requestId);
  const auth = await instAdminAuth(ctx, id);
  if (!auth.ok) return api.err(auth.status, auth.code,
    auth.code === "inst_admin_only" ? "Managing members needs an institution admin" : "Institution not found", requestId);
  const role = body.role;
  if (INST_ROLES.indexOf(role) < 0) return api.err(400, "invalid_body", "role must be admin or member", requestId);
  const existing = await instMember(db, id, memberUid);
  if (!existing) return api.err(404, "member_not_found", "Member not found", requestId);
  if (existing.role === "admin" && role !== "admin" && (await adminCount(db, id)) <= 1)
    return api.err(409, "last_admin", "An institution needs at least one admin", requestId);
  await db.prepare("UPDATE research_institution_members SET role=? WHERE institution_id=? AND uid=?")
    .bind(role, id, memberUid).run();
  return api.json({ member: { institutionId: id, uid: memberUid, role, createdTs: existing.created_ts } },
    200, { "x-request-id": requestId });
}
export async function removeInstitutionMember(ctx, id, memberUid) {
  const { db, requestId, api } = ctx;
  const inst = await getInstitution(db, id);
  if (!inst) return api.err(404, "institution_not_found", "Institution not found", requestId);
  const auth = await instAdminAuth(ctx, id);
  if (!auth.ok) return api.err(auth.status, auth.code,
    auth.code === "inst_admin_only" ? "Managing members needs an institution admin" : "Institution not found", requestId);
  const existing = await instMember(db, id, memberUid);
  if (!existing) return api.err(404, "member_not_found", "Member not found", requestId);
  if (existing.role === "admin" && (await adminCount(db, id)) <= 1)
    return api.err(409, "last_admin", "An institution needs at least one admin", requestId);
  await db.prepare("DELETE FROM research_institution_members WHERE institution_id=? AND uid=?")
    .bind(id, memberUid).run();
  return api.json({ ok: true }, 200, { "x-request-id": requestId });
}

/* ---- Institution-owned projects ------------------------------------------- */
export async function listInstitutionProjects(ctx, id) {
  const { db, uid, requestId, api } = ctx;
  const gate = await instGate(db, id, uid);
  if (gate.status) return api.err(gate.status, gate.code, "Institution not found", requestId);
  const rows = (await db.prepare("SELECT * FROM research_projects WHERE institution_id=? AND status!='deleted' ORDER BY updated_ts DESC LIMIT 100")
    .bind(id).all()).results || [];
  return api.json({ projects: rows.map((r) => ({ id: r.id, title: r.title, institutionId: r.institution_id,
    studyType: r.study_type || "", ownerUid: r.owner_uid, updatedAt: r.updated_ts })) },
    200, { "x-request-id": requestId });
}
export async function createInstitutionProject(ctx, id, body) {
  const { db, uid, requestId, api } = ctx;
  const { json, err, uuid, audit } = api;
  const gate = await instGate(db, id, uid);
  if (gate.status) return err(gate.status, gate.code, "Institution not found", requestId);
  const title = typeof body.title === "string" ? body.title.trim() : "";
  if (!title || title.length > 180) return err(400, "invalid_project", "title must be 1-180 characters", requestId);
  const discipline = String(body.discipline || "medicine").slice(0, 40);
  const specialty = String(body.specialty || "").slice(0, 80);
  const studyType = String(body.studyType || "").slice(0, 80);
  const question = String(body.researchQuestion || "").slice(0, 2000);
  const projectId = uuid("prj_"), now = Date.now();
  await db.batch([
    db.prepare("INSERT INTO research_projects (id,owner_uid,title,discipline,specialty,study_type,research_question,status,created_ts,updated_ts,institution_id) VALUES (?,?,?,?,?,?,?,'active',?,?,?)")
      .bind(projectId, uid, title, discipline, specialty, studyType, question, now, now, id),
    db.prepare("INSERT INTO research_members (project_id,uid,role,created_ts) VALUES (?,?, 'owner', ?)")
      .bind(projectId, uid, now),
    db.prepare("INSERT INTO research_audit_events (id,project_id,actor_uid,event_type,resource_id,metadata_json,created_ts) VALUES (?,?,?,'project.created',?,?,?)")
      .bind(uuid("aud_"), projectId, uid, projectId, JSON.stringify({ institutionId: id }), now),
  ]);
  return json({ project: { id: projectId, title, institutionId: id, role: "owner", createdAt: now } },
    201, { "x-request-id": requestId });
}

/* ---- Pilot onboarding checklist ------------------------------------------- */
export async function institutionOnboarding(ctx, id) {
  const { db, uid, requestId, api } = ctx;
  const gate = await instGate(db, id, uid);
  if (gate.status) return api.err(gate.status, gate.code, "Institution not found", requestId);
  const stored = await db.prepare("SELECT * FROM research_institution_onboarding WHERE institution_id=?")
    .bind(id).first();
  const manual = stored ? JSON.parse(stored.items_json || "{}") : {};
  const members = await seatCount(db, id);
  const grants = await db.prepare("SELECT COALESCE(SUM(delta),0) AS n FROM research_credit_ledger WHERE owner_type='institution' AND owner_id=? AND reason='grant'")
    .bind(id).first();
  const projects = await db.prepare("SELECT COUNT(*) AS n FROM research_projects WHERE institution_id=? AND status!='deleted'")
    .bind(id).first();
  const runs = await db.prepare("SELECT COUNT(*) AS n FROM research_runs r JOIN research_projects p ON p.id=r.project_id WHERE p.institution_id=?")
    .bind(id).first();
  const computed = {
    workspace_created: true,
    members_added: members > 0,
    credits_granted: ((grants && grants.n) || 0) > 0,
    first_project: ((projects && projects.n) || 0) > 0,
    first_review: ((runs && runs.n) || 0) > 0,
  };
  const items = Object.keys(ONBOARDING_LABELS).map((key) => ({
    key, label: ONBOARDING_LABELS[key],
    done: key in computed ? computed[key] : manual[key] === true,
    source: key in computed ? "computed" : "manual",
  }));
  return api.json({ items, updatedTs: stored ? stored.updated_ts : null },
    200, { "x-request-id": requestId });
}
export async function putInstitutionOnboarding(ctx, id, body) {
  const { db, requestId, api } = ctx;
  const { json, err } = api;
  const inst = await getInstitution(db, id);
  if (!inst) return err(404, "institution_not_found", "Institution not found", requestId);
  const auth = await instAdminAuth(ctx, id);
  if (!auth.ok) return err(auth.status, auth.code,
    auth.code === "inst_admin_only" ? "Onboarding needs an institution admin" : "Institution not found", requestId);
  const items = body.items;
  if (!items || typeof items !== "object" || Array.isArray(items))
    return err(400, "invalid_body", "items must be an object", requestId);
  for (const k of Object.keys(items)) {
    if (MANUAL_ONBOARDING.indexOf(k) < 0)
      return err(400, "invalid_body", "Only manual checklist items can be set: " + MANUAL_ONBOARDING.join(", "), requestId);
    if (typeof items[k] !== "boolean") return err(400, "invalid_body", "items." + k + " must be a boolean", requestId);
  }
  const stored = await db.prepare("SELECT items_json FROM research_institution_onboarding WHERE institution_id=?")
    .bind(id).first();
  const merged = Object.assign(stored ? JSON.parse(stored.items_json || "{}") : {}, items);
  const now = Date.now();
  await db.prepare("INSERT INTO research_institution_onboarding (institution_id,items_json,updated_by,updated_ts) VALUES (?,?,?,?) ON CONFLICT(institution_id) DO UPDATE SET items_json=excluded.items_json,updated_by=excluded.updated_by,updated_ts=excluded.updated_ts")
    .bind(id, JSON.stringify(merged), auth.uid, now).run();
  return json({ ok: true, items: merged, updatedTs: now }, 200, { "x-request-id": requestId });
}
