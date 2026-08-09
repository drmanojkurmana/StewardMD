/* functions/_opd_org_store.js — Firestore I/O for OPD orgs/departments/OPDs/rooms/members (Phase 3).
 *
 * Thin CRUD over the PURE model in _opd_org.js; every DECISION (validation, isolation, scope) is that
 * pure, unit-tested layer. Tenant isolation is enforced by authorizeOrg() (below) BEFORE any read/write —
 * the frontend never decides. All create/update/delete are audited via the queue engine's qAudit.
 *
 * Backward-compatible + additive: legacy doctor-sessions keep working untouched; backfillOrg() is an
 * idempotent, non-destructive migration that materialises a q_orgs doc for a legacy hospitalId.
 */
import { fsGet, fsQuery, fsCommit, wCreate, wUpdate } from "./_fbfirestore.js";
import { qAudit } from "./_queue_engine.js";
import * as M from "./_opd_org.js";

const now = () => Date.now();
function newId() { return crypto.randomUUID().replace(/-/g, ""); }
function sanitize(x) { return String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80); }
const withId = (id, f) => Object.assign({ id }, f || {});
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: meta || "" });

// ---- organizations -----------------------------------------------------------------------------
export async function createOrg(env, body, ownerUid) {
  body = body || {};
  const id = body.id ? sanitize(body.id) : newId();
  const f = M.org({ id, name: body.name, mode: body.mode, connectorId: body.connectorId, ownerUid, thresholds: body.thresholds, createdAt: now() });
  await fsCommit(env, [wCreate(env, "q_orgs/" + id, f)]);
  await audit(env, id, ownerUid, "org:create", f.mode);
  return f;
}
export async function getOrg(env, orgId) { const d = await fsGet(env, "q_orgs/" + sanitize(orgId)); return d ? M.org(withId(sanitize(orgId), d.fields)) : null; }
export async function listOrgsForOwner(env, ownerUid) {
  const r = await fsQuery(env, "q_orgs", { where: { field: "ownerUid", value: String(ownerUid) }, limit: 100 });
  return r.map((x) => M.org(withId(x.id, x.fields)));
}
export async function updateOrg(env, orgId, patch, actorId) {
  const cur = await getOrg(env, orgId); if (!cur) return null;
  const f = M.org(Object.assign({}, cur, patch || {}, { id: cur.id, ownerUid: cur.ownerUid, createdAt: cur.createdAt })); // ownerUid immutable
  await fsCommit(env, [wUpdate(env, "q_orgs/" + sanitize(orgId), f)]);
  await audit(env, orgId, actorId, "org:update", "");
  return f;
}

// ---- departments / OPDs (optional layers) ------------------------------------------------------
export async function createDepartment(env, orgId, body, actorId) {
  const id = newId(); const f = M.department({ id, orgId, name: (body || {}).name, code: (body || {}).code });
  await fsCommit(env, [wCreate(env, "q_departments/" + id, f)]);
  await audit(env, orgId, actorId, "dept:create", f.name); return f;
}
export async function listDepartments(env, orgId) {
  const r = await fsQuery(env, "q_departments", { where: { field: "orgId", value: sanitize(orgId) }, limit: 200 });
  return r.map((x) => M.department(withId(x.id, x.fields)));
}
export async function createOpd(env, orgId, body, actorId) {
  const id = newId(); const f = M.opd({ id, orgId, departmentId: (body || {}).departmentId, name: (body || {}).name });
  await fsCommit(env, [wCreate(env, "q_opds/" + id, f)]);
  await audit(env, orgId, actorId, "opd:create", f.name); return f;
}

// ---- rooms (room != doctor: configurable assignment) -------------------------------------------
export async function createRoom(env, orgId, body, actorId) {
  const id = newId();
  const f = M.room({ id, orgId, departmentId: (body || {}).departmentId, opdId: (body || {}).opdId, name: (body || {}).name, number: (body || {}).number, assignment: (body || {}).assignment });
  await fsCommit(env, [wCreate(env, "q_rooms/" + id, f)]);
  await audit(env, orgId, actorId, "room:create", f.name); return f;
}
export async function getRoom(env, roomId) { const d = await fsGet(env, "q_rooms/" + sanitize(roomId)); return d ? M.room(withId(sanitize(roomId), d.fields)) : null; }
export async function listRooms(env, orgId) {
  const r = await fsQuery(env, "q_rooms", { where: { field: "orgId", value: sanitize(orgId) }, limit: 200 });
  return r.map((x) => M.room(withId(x.id, x.fields)));
}
export async function updateRoom(env, roomId, patch, actorId) {
  const cur = await getRoom(env, roomId); if (!cur) return null;
  const f = M.room(Object.assign({}, cur, patch || {}, { id: cur.id, orgId: cur.orgId }));   // orgId immutable
  await fsCommit(env, [wUpdate(env, "q_rooms/" + sanitize(roomId), f)]);
  await audit(env, cur.orgId, actorId, "room:update", (patch && patch.assignment) ? "assignment" : ""); return f;
}

// ---- membership (org-based access: role + scope) -----------------------------------------------
function memberId(orgId, identity) { return sanitize(orgId) + "__" + sanitize(identity); }
export async function setMembership(env, orgId, identity, body, actorId) {
  const id = memberId(orgId, identity);
  const f = M.membership({ id, orgId, identity, role: (body || {}).role, scope: (body || {}).scope, active: (body || {}).active !== false, createdAt: now() });
  await fsCommit(env, [wUpdate(env, "q_members/" + id, f)]);
  await audit(env, orgId, actorId, "member:set", identity + ":" + f.role); return f;
}
export async function getMembership(env, orgId, identity) {
  const d = await fsGet(env, "q_members/" + memberId(orgId, identity));
  return d ? M.membership(withId(memberId(orgId, identity), d.fields)) : null;
}
export async function listMembers(env, orgId) {
  const r = await fsQuery(env, "q_members", { where: { field: "orgId", value: sanitize(orgId) }, limit: 300 });
  return r.map((x) => M.membership(withId(x.id, x.fields))).filter((m) => m.active);
}
export async function removeMembership(env, orgId, identity, actorId) {
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { active: false, updatedAt: now() })]);
  await audit(env, orgId, actorId, "member:remove", identity); return { ok: true };
}

// ---- THE isolation gate (I/O wrapper over the pure authorizeOrgAccess) --------------------------
// Fetches the org + the actor's membership, then lets the pure layer decide. Returns { ok, role, ... }.
export async function authorizeOrg(env, actor, orgId, cap, target) {
  const orgDoc = await getOrg(env, orgId);
  if (!orgDoc) return { ok: false, reason: "org_not_found" };
  const actorId = actor && actor.id ? actor.id : "";
  if (M.isOwnerOfOrg(orgDoc, actorId)) return M.authorizeOrgAccess(orgDoc, null, actorId, orgId, cap, target);
  const m = await getMembership(env, orgId, actorId);
  return M.authorizeOrgAccess(orgDoc, m, actorId, orgId, cap, target);
}

// ---- migration: idempotent, non-destructive backfill of a legacy hospitalId into a q_orgs doc ---
export async function backfillOrg(env, hospitalId, ownerUid, mode, connectorId) {
  const existing = await getOrg(env, hospitalId);
  if (existing) return existing;
  return createOrg(env, { id: hospitalId, name: hospitalId, mode: mode || "native", connectorId: connectorId || null }, ownerUid || "");
}
