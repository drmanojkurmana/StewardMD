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
import { genSalt, hashSecret } from "./_opd_auth.js";

const now = () => Date.now();
function newId() { return crypto.randomUUID().replace(/-/g, ""); }
function sanitize(x) { return String(x == null ? "" : x).replace(/[^A-Za-z0-9_-]/g, "-").slice(0, 80); }
const withId = (id, f) => Object.assign({ id }, f || {});
const audit = (env, orgId, actor, action, meta) => qAudit(env, { hospitalId: orgId, ticketId: "", actor: actor || "", action, meta: meta || "" });

// ---- organizations -----------------------------------------------------------------------------
async function uniqueOrgCode(env) {
  for (let i = 0; i < 6; i++) { const c = M.genSmdCode("SMD-", 6); if (!(await getOrgByCode(env, c))) return c; }
  return M.genSmdCode("SMD-", 8);   // wider space fallback (collisions astronomically unlikely)
}
export async function createOrg(env, body, ownerUid) {
  body = body || {};
  const id = body.id ? sanitize(body.id) : newId();
  const code = await uniqueOrgCode(env);
  const f = M.org({ id, code, name: body.name, mode: body.mode, connectorId: body.connectorId, ownerUid, thresholds: body.thresholds, createdAt: now() });
  await fsCommit(env, [wCreate(env, "q_orgs/" + id, f)]);
  await audit(env, id, ownerUid, "org:create", f.mode + " " + code);
  return f;
}
export async function getOrg(env, orgId) {
  const d = await fsGet(env, "q_orgs/" + sanitize(orgId)); if (!d) return null;
  const o = M.org(withId(sanitize(orgId), d.fields));
  if (!o.code) {   // lazy-assign a StewardMD ID to a legacy org on first load
    o.code = await uniqueOrgCode(env);
    try { await fsCommit(env, [wUpdate(env, "q_orgs/" + sanitize(orgId), { code: o.code })]); } catch (e) {}
  }
  return o;
}
// Resolve a clinic StewardMD code (SMD-XXXXXX) OR a raw orgId to the orgId.
export async function getOrgByCode(env, code) {
  const c = M.normalizeSmdId(code); if (!c) return null;
  const r = await fsQuery(env, "q_orgs", { where: { field: "code", value: c }, limit: 1 });
  return r && r[0] ? M.org(withId(r[0].id, r[0].fields)) : null;
}
export async function resolveOrgId(env, codeOrId) {
  if (M.looksLikeSmdCode(codeOrId)) { const o = await getOrgByCode(env, codeOrId); return o ? o.id : ""; }
  return String(codeOrId || "");
}
// Stable StewardMD ID per Google account (uid) — get-or-create.
export async function userSmdId(env, uid, email) {
  const id = sanitize(uid); if (!id) return "";
  const d = await fsGet(env, "q_users/" + id);
  if (d && d.fields && d.fields.smdId) return d.fields.smdId;
  const smdId = M.genSmdCode("SMD-U-", 5);
  try { await fsCommit(env, [wUpdate(env, "q_users/" + id, { smdId, email: String(email || "").toLowerCase(), createdAt: now() })]); } catch (e) {}
  return smdId;
}
export async function listOrgsForOwner(env, ownerUid) {
  const r = await fsQuery(env, "q_orgs", { where: { field: "ownerUid", value: String(ownerUid) }, limit: 100 });
  return r.filter((x) => !(x.fields && x.fields.deleted)).map((x) => M.org(withId(x.id, x.fields)));
}
export async function deleteOrg(env, orgId, actorId) {
  await fsCommit(env, [wUpdate(env, "q_orgs/" + sanitize(orgId), { deleted: true, deletedAt: now() })]);   // soft-delete
  await audit(env, orgId, actorId, "org:delete", "");
  return { ok: true };
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
// Public projection — NEVER leak secret hashes to the client. `email`/`hasPin` are safe hints.
function publicMember(id, f) {
  const m = M.membership(withId(id, f));
  return { id: m.id, orgId: m.orgId, identity: m.identity, role: m.role, scope: m.scope, active: m.active, email: (f && f.email) || "", hasPin: !!(f && f.pinHash), createdAt: m.createdAt };
}
export async function listMembers(env, orgId) {
  const r = await fsQuery(env, "q_members", { where: { field: "orgId", value: sanitize(orgId) }, limit: 300 });
  return r.map((x) => publicMember(x.id, x.fields));   // includes disabled so admin can restore; active flag shown
}
// Lifecycle. disable/remove -> active:false blocks OPD access IMMEDIATELY (authorizeOrg checks active).
export async function setMemberActive(env, orgId, identity, active, actorId) {
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { active: !!active, updatedAt: now() })]);
  await audit(env, orgId, actorId, active ? "member:restore" : "member:disable", identity); return { ok: true };
}
export async function removeMembership(env, orgId, identity, actorId) { return setMemberActive(env, orgId, identity, false, actorId); }

// ---- staff credentials (email + PIN) — hashed at rest, owner-managed ----------------------------
export async function setMemberPin(env, orgId, identity, pin, actorId) {
  const salt = genSalt(); const pinHash = await hashSecret(String(pin), salt);
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { pinSalt: salt, pinHash: pinHash, pinAttempts: 0, pinLockedUntil: 0, updatedAt: now() })]);
  await audit(env, orgId, actorId, "member:set_pin", identity); return { ok: true };
}
export async function setMemberPassword(env, orgId, identity, email, password, actorId) {
  const salt = genSalt(); const passHash = await hashSecret(String(password), salt);
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { email: String(email || "").toLowerCase(), passSalt: salt, passHash: passHash, updatedAt: now() })]);
  await audit(env, orgId, actorId, "member:set_password", identity); return { ok: true };
}
export async function resetMemberAccess(env, orgId, identity, actorId) {
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { pinHash: "", pinSalt: "", passHash: "", passSalt: "", pinAttempts: 0, pinLockedUntil: 0, updatedAt: now() })]);
  await audit(env, orgId, actorId, "member:reset_access", identity); return { ok: true };
}
// Raw auth record for the login path (NEVER returned to a client).
export async function getMemberAuth(env, orgId, identity) {
  const d = await fsGet(env, "q_members/" + memberId(orgId, identity));
  if (!d) return null;
  const f = d.fields || {};
  return { orgId: sanitize(orgId), identity: String(identity), active: f.active !== false, role: f.role || "viewer", email: f.email || "", pinSalt: f.pinSalt || "", pinHash: f.pinHash || "", passSalt: f.passSalt || "", passHash: f.passHash || "", pinAttempts: f.pinAttempts || 0, pinLockedUntil: f.pinLockedUntil || 0 };
}
export async function recordMemberPinAttempt(env, orgId, identity, patch) {
  await fsCommit(env, [wUpdate(env, "q_members/" + memberId(orgId, identity), { pinAttempts: patch.pinAttempts, pinLockedUntil: patch.pinLockedUntil, updatedAt: now() })]);
}
export async function findMemberByEmail(env, email) {
  const r = await fsQuery(env, "q_members", { where: { field: "email", value: String(email || "").toLowerCase() }, limit: 5 });
  const row = r.find((x) => x.fields && x.fields.active !== false) || r[0];
  if (!row) return null;
  const f = row.fields || {};
  return { orgId: f.orgId || "", identity: f.identity || "", active: f.active !== false, email: f.email || "", passSalt: f.passSalt || "", passHash: f.passHash || "" };
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
