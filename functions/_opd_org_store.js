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
  const f = M.org({ id, code, name: body.name, kind: body.kind, mode: body.mode, connectorId: body.connectorId, ownerUid, thresholds: body.thresholds, createdAt: now() });
  await fsCommit(env, [wCreate(env, "q_orgs/" + id, f)]);
  await audit(env, id, ownerUid, "org:create", f.mode + " " + code);
  return f;
}
export async function getOrg(env, orgId) {
  let id = sanitize(orgId);
  let d = await fsGet(env, "q_orgs/" + id);
  /* Document ids are lower-case hex, and clients have upper-cased them: the pglog setup screen
   * applied .toUpperCase() to every handle a user typed, which is correct for an SMD-XXXXXX code
   * and fatal for a pasted org id. Retry once folded so those devices resolve instead of 404ing. */
  if (!d && /^[0-9A-F]{32}$/.test(id)) { id = id.toLowerCase(); d = await fsGet(env, "q_orgs/" + id); }
  if (!d) return null;
  const o = M.org(withId(id, d.fields));
  if (!o.code) {   // lazy-assign a StewardMD ID to a legacy org on first load
    o.code = await uniqueOrgCode(env);
    try { await fsCommit(env, [wUpdate(env, "q_orgs/" + id, { code: o.code })]); } catch (e) {}
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
// Every institution, for the PLATFORM owner's tenant console only (never an org-scoped caller).
// Decoding goes through M.org/withId like every other read in this file, so the shape cannot drift.
export async function listAllOrgs(env, limit) {
  const r = await fsQuery(env, "q_orgs", { limit: limit || 300 });
  return r.map((x) => M.org(withId(x.id, x.fields)));
}
export async function listOrgsForOwner(env, ownerUid) {
  const r = await fsQuery(env, "q_orgs", { where: { field: "ownerUid", value: String(ownerUid) }, limit: 100 });
  return r.filter((x) => !(x.fields && x.fields.deleted)).map((x) => M.org(withId(x.id, x.fields)));
}
// Orgs where `identities` (uid and/or email) hold an ACTIVE q_members row, for a doctor invited to
// a hospital they don't own. Multiple identities can name the same org (uid AND email both enrolled,
// or the same org via two identities) so dedupe by org id; the FIRST identity's membership wins, and
// the caller (GET /api/queue/orgs) passes [uid, email] in that priority order.
export async function listOrgsForMember(env, identities) {
  const ids = Array.from(new Set((identities || []).map((x) => String(x || "").trim()).filter(Boolean)));
  const seen = new Set(); const out = [];
  for (const id of ids) {
    const rows = await fsQuery(env, "q_members", { where: { field: "identity", value: id }, limit: 100 });
    for (const row of rows) {
      const f = row.fields || {};
      if (f.active === false) continue;
      const orgId = f.orgId; if (!orgId || seen.has(orgId)) continue;
      seen.add(orgId);
      const d = await fsGet(env, "q_orgs/" + sanitize(orgId));
      if (!d || (d.fields && d.fields.deleted)) continue;   // dropped/missing org: no dangling membership shown
      out.push(Object.assign({}, M.org(withId(sanitize(orgId), d.fields)), { memberRole: f.role || "viewer" }));
    }
  }
  return out;
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
  const b = body || {};
  const id = newId(); const f = M.department({ id, orgId, name: b.name, code: b.code, type: b.type, active: b.active });
  await fsCommit(env, [wCreate(env, "q_departments/" + id, f)]);
  await audit(env, orgId, actorId, "dept:create", f.name); return f;
}
export async function listDepartments(env, orgId) {
  const r = await fsQuery(env, "q_departments", { where: { field: "orgId", value: sanitize(orgId) }, limit: 200 });
  return r.map((x) => M.department(withId(x.id, x.fields)));
}
export async function createOpd(env, orgId, body, actorId) {
  const b = body || {};
  const id = newId(); const f = M.opd({ id, orgId, departmentId: b.departmentId, name: b.name, active: b.active });
  await fsCommit(env, [wCreate(env, "q_opds/" + id, f)]);
  await audit(env, orgId, actorId, "opd:create", f.name); return f;
}

// ---- rooms (room != doctor: configurable assignment) -------------------------------------------
export async function createRoom(env, orgId, body, actorId) {
  const b = body || {};
  const id = newId();
  const f = M.room({ id, orgId, departmentId: b.departmentId, opdId: b.opdId, name: b.name, number: b.number, assignment: b.assignment, active: b.active });
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

// ---- wards / beds (TASK 4.1: Enterprise -> ... -> Ward -> Bed) ----------------------------------
export async function createWard(env, orgId, body, actorId) {
  const b = body || {};
  const id = newId(); const f = M.ward({ id, orgId, departmentId: b.departmentId, name: b.name, code: b.code, type: b.type, active: b.active });
  await fsCommit(env, [wCreate(env, "q_wards/" + id, f)]);
  await audit(env, orgId, actorId, "ward:create", f.name); return f;
}
export async function getWard(env, wardId) { const d = await fsGet(env, "q_wards/" + sanitize(wardId)); return d ? M.ward(withId(sanitize(wardId), d.fields)) : null; }
export async function listWards(env, orgId) {
  const r = await fsQuery(env, "q_wards", { where: { field: "orgId", value: sanitize(orgId) }, limit: 200 });
  return r.map((x) => M.ward(withId(x.id, x.fields)));
}
export async function updateWard(env, wardId, patch, actorId) {
  const cur = await getWard(env, wardId); if (!cur) return null;
  const f = M.ward(Object.assign({}, cur, patch || {}, { id: cur.id, orgId: cur.orgId }));   // orgId immutable
  await fsCommit(env, [wUpdate(env, "q_wards/" + sanitize(wardId), f)]);
  await audit(env, cur.orgId, actorId, "ward:update", patch && patch.active === false ? "deactivated" : ""); return f;
}
export async function createBed(env, orgId, body, actorId) {
  const b = body || {};
  const id = newId(); const f = M.bed({ id, orgId, wardId: b.wardId, name: b.name, state: b.state, genderRestriction: b.genderRestriction, isolation: b.isolation, active: b.active });
  await fsCommit(env, [wCreate(env, "q_beds/" + id, f)]);
  await audit(env, orgId, actorId, "bed:create", f.name); return f;
}
export async function getBed(env, bedId) { const d = await fsGet(env, "q_beds/" + sanitize(bedId)); return d ? M.bed(withId(sanitize(bedId), d.fields)) : null; }
export async function listBeds(env, orgId, wardId) {
  const r = await fsQuery(env, "q_beds", { where: { field: "orgId", value: sanitize(orgId) }, limit: 500 });
  const beds = r.map((x) => M.bed(withId(x.id, x.fields)));
  return wardId ? beds.filter((b) => b.wardId === sanitize(wardId)) : beds;
}
// Name-based lookups: ADT (migrate-inpatient.js) works with the free-text ward/bed NAMES a caller
// types, never with a master record's own id - the same reason getOrgByCode() exists alongside
// getOrg(). Case-insensitive, matching sameBed()'s own comparator in migrate-inpatient.js.
export async function getWardByName(env, orgId, name) {
  const want = String(name || "").trim().toLowerCase(); if (!want) return null;
  const wards = await listWards(env, orgId);
  return wards.find((w) => w.name.trim().toLowerCase() === want) || null;
}
export async function getBedByName(env, orgId, wardId, name) {
  const want = String(name || "").trim().toLowerCase(); if (!want) return null;
  const beds = await listBeds(env, orgId, wardId);
  return beds.find((b) => b.name.trim().toLowerCase() === want) || null;
}
// TASK 4.3: SERVER-SIDE CONCURRENCY, NOT TRUST IN THE CLIENT. Two staff assigning/releasing/
// blocking the same bed at once is exactly the race a read-modify-write with no version check
// allows - the second write wins silently and the first caller's premise (the state they read) is
// now false with nobody told. Guarded here with the SAME optimistic-concurrency primitive
// (wUpdate's opts.updateTime, _fbfirestore.js) every single-use activation record in this codebase
// already relies on - not a new locking system. A genuine conflict throws `bed_changed` instead of
// silently overwriting; the caller (functions/api/queue/[[path]].js's bed/update route) turns that
// into a 409 for the client to refetch and retry.
export async function updateBed(env, bedId, patch, actorId) {
  const id = sanitize(bedId);
  const raw = await fsGet(env, "q_beds/" + id); if (!raw) return null;
  const cur = M.bed(withId(id, raw.fields));
  const f = M.bed(Object.assign({}, cur, patch || {}, { id: cur.id, orgId: cur.orgId, wardId: cur.wardId }));   // orgId/wardId immutable - move a bed by retiring and recreating it, never by relabeling it into a different ward's history
  try {
    await fsCommit(env, [wUpdate(env, "q_beds/" + id, f, { updateTime: raw.updateTime })]);
  } catch (e) {
    if (e && e.code === "precondition") throw Object.assign(new Error("bed_changed"), { code: "bed_changed" });
    throw e;
  }
  await audit(env, cur.orgId, actorId, "bed:update", patch && patch.state ? "state:" + patch.state : ""); return f;
}

// ---- membership (org-based access: role + scope) -----------------------------------------------
function memberId(orgId, identity) { return sanitize(orgId) + "__" + sanitize(identity); }
export async function setMembership(env, orgId, identity, body, actorId) {
  const id = memberId(orgId, identity);
  /* MERGE, do not overwrite. M.membership() fills an omitted scope with {departments:[],opds:[],
   * rooms:[]}, and an EMPTY scope means whole-org (see withinScope in _opd_org.js). wUpdate's mask
   * covers every key present, so a caller that sends no scope - /api/pglog/enrol never does -
   * silently promoted an HoD scoped to one department into institution-wide access, and flipped
   * `active` back to true. Re-enrolling someone to fix a typo must not widen what they can see. */
  const prev = (await getMembership(env, orgId, identity)) || null;
  const b = body || {};

  /* ROLE FALLS BACK TO THE EXISTING ROLE, exactly as scope and active do below.
   *
   * It did not, and M.membership defaults a missing role to "viewer" - which holds queue.view and
   * nothing else. So re-saving a member to change their scope, or to flip them active again, wiped
   * a nurse to read-only. The only symptom is that check-in starts answering 403 forbidden, with
   * nothing on screen connecting that to an edit nobody thought was about roles.
   *
   * A member created with no role at all cannot do the one job the staff console exists for, so
   * that is refused rather than quietly written as a viewer. Never defaulted UPWARDS - guessing
   * "nurse" would hand out queue control nobody granted. */
  const role = String(b.role || (prev && prev.role) || "").trim();
  if (!role) return { ok: false, error: "role_required", message: "Choose a role for this person - a member with no role can only watch the queue." };

  const f = M.membership({
    id, orgId, identity,
    role: role,
    scope: b.scope !== undefined ? b.scope : (prev && prev.scope),
    active: b.active !== undefined ? b.active !== false : (prev ? prev.active !== false : true),
    createdAt: (prev && prev.createdAt) || now(),
  });
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
  // Staff PIN sessions are minted org-bound (the signed token carries orgId). Pin them: a "reception"
  // session for org A must never authorize against org B - identity strings ("reception", "nurse1")
  // are not globally unique, so without this a colliding username could inherit another clinic's role.
  // GHIS/employee actors carry no token orgId; their q_members membership legitimately spans orgs.
  if (actor && actor.kind === "staff" && actor.orgId && String(actor.orgId) !== String(orgId)) {
    return { ok: false, reason: "org_mismatch" };
  }
  const orgDoc = await getOrg(env, orgId);
  if (!orgDoc) return { ok: false, reason: "org_not_found" };
  const actorId = actor && actor.id ? actor.id : "";
  if (M.isOwnerOfOrg(orgDoc, actorId)) return M.authorizeOrgAccess(orgDoc, null, actorId, orgId, cap, target);
  let m = await getMembership(env, orgId, actorId);
  // An invited doctor/staffer is added by EMAIL or login name (the console's member form), but a
  // Firebase sign-in presents the account UID as actor.id - so the uid lookup misses and the person is
  // "not a member" in the phone app while the SAME account works on the console (a staff session
  // carries the identity as its id). Fall back to the email before deciding they have no membership.
  // Owners never reach here: isOwnerOfOrg short-circuits above, which is why this only ever bit the
  // second doctor in a clinic.
  if (!m && actor && actor.email) m = await getMembership(env, orgId, actor.email);
  return M.authorizeOrgAccess(orgDoc, m, actorId, orgId, cap, target);
}

// ---- migration: idempotent, non-destructive backfill of a legacy hospitalId into a q_orgs doc ---
export async function backfillOrg(env, hospitalId, ownerUid, mode, connectorId) {
  const existing = await getOrg(env, hospitalId);
  if (existing) return existing;
  return createOrg(env, { id: hospitalId, name: hospitalId, mode: mode || "native", connectorId: connectorId || null }, ownerUid || "");
}
