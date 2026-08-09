/* functions/_opd_org.js — OPD organization model + tenant-isolation logic (Phase 3, PURE).
 *
 * The generalized hierarchy Organization → Department → OPD → Room → Queue, with Department/OPD OPTIONAL
 * so a single-doctor clinic is just Organization → Room → Queue. A Room does NOT belong to one doctor:
 * assignment is configurable (primary / multiple / rotating / unassigned). Tenant isolation + membership
 * scope live here as pure predicates so they are unit-tested and enforced identically server-side
 * (never trust the frontend). No EMR/GHIS specifics — org.mode + connectorId is the only EMR coupling.
 */
import { isRole, can } from "./_queue_roles.js";

export const OPD_ORG_VERSION = "1.0";

const s = (v) => (v == null ? "" : String(v));
const orNull = (v) => (v == null || String(v) === "" ? null : String(v));
const arr = (x) => (Array.isArray(x) ? x.map(s).filter(Boolean) : []);
function requireId(o) { if (!o || o.id == null || String(o.id) === "") throw new Error("opd_org: id required"); }
function posInt(v, d) { const n = Math.round(Number(v)); return Number.isFinite(n) && n > 0 ? n : d; }

// ---- room-status thresholds (editable per clinic by admin/doctor) ------------------------------
export function thresholds(t) { t = t || {}; const moderate = posInt(t.moderate, 3); const busy = Math.max(moderate + 1, posInt(t.busy, 6)); return { moderate, busy }; }
export function roomStatus(waiting, inConsult, t) {
  t = thresholds(t); waiting = Math.max(0, Number(waiting) || 0);
  if (waiting >= t.busy) return "busy";
  if (waiting >= t.moderate || (inConsult && waiting > 0)) return "moderate";
  return "normal";
}

// ---- entities ----------------------------------------------------------------------------------
export function org(o = {}) {
  requireId(o);
  return { id: s(o.id), code: s(o.code), name: s(o.name), mode: o.mode === "connect" ? "connect" : "native", connectorId: orNull(o.connectorId), ownerUid: s(o.ownerUid), thresholds: thresholds(o.thresholds), createdAt: Number(o.createdAt) || 0 };
}
// Human StewardMD IDs: short, unambiguous (no 0/O/1/I). Clinics "SMD-XXXXXX", users "SMD-U-XXXXX".
const SMD_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";
export function normalizeSmdId(x) { return String(x || "").toUpperCase().replace(/[^0-9A-Z-]/g, "").trim(); }
export function looksLikeSmdCode(x) { return /^SMD-/.test(normalizeSmdId(x)); }
export function genSmdCode(prefix, n) {   // uses CSPRNG; prefix e.g. "SMD-" or "SMD-U-"
  const bytes = crypto.getRandomValues(new Uint8Array(n || 6));
  let out = ""; for (let i = 0; i < bytes.length; i++) out += SMD_ALPHABET[bytes[i] % SMD_ALPHABET.length];
  return (prefix || "SMD-") + out;
}
export function department(o = {}) { requireId(o); return { id: s(o.id), orgId: s(o.orgId), name: s(o.name), code: s(o.code) }; }
export function opd(o = {}) { requireId(o); return { id: s(o.id), orgId: s(o.orgId), departmentId: orNull(o.departmentId), name: s(o.name) }; }

export const ROOM_ASSIGN_MODES = ["primary", "multiple", "rotating", "unassigned"];
export function room(o = {}) {
  requireId(o);
  const a = o.assignment || {};
  const mode = ROOM_ASSIGN_MODES.indexOf(a.mode) > -1 ? a.mode : "unassigned";
  return {
    id: s(o.id), orgId: s(o.orgId), departmentId: orNull(o.departmentId), opdId: orNull(o.opdId),
    name: s(o.name), number: s(o.number),
    assignment: { mode, doctors: arr(a.doctors), primary: orNull(a.primary) }
  };
}
// The doctor "on" a room right now (pure). Rooms are never permanently one doctor's.
export function resolveRoomDoctor(rm, opts) {
  opts = opts || {}; const a = (rm && rm.assignment) || {}; const docs = a.doctors || [];
  if (a.mode === "unassigned") return null;
  if (a.mode === "rotating" && docs.length) return docs[Math.abs(Number(opts.rotationIndex) || 0) % docs.length];
  return a.primary || docs[0] || null;   // primary / multiple: primary, else first listed
}

// Normalize a doctor identity for matching: drop the auth-provider prefix (fb:/ghis:) + lowercase, so a
// room assigned as "fb:<uid>", the raw "<uid>", or a "ghis:<eid>" all compare equal to the actor's id.
export function normDocId(id) { return String(id == null ? "" : id).toLowerCase().replace(/^(fb:|ghis:)/, ""); }
// Which room is THIS actor manning? Match the actor's identities (id + email) against each room's assigned
// doctor id(s), normalized. Returns the room, or null if none is assigned to them. This is how the doctor's
// app finds the exact room the sister routes into on the console (identity mapping, patient-safety critical).
export function roomForActor(rooms, actor) {
  const cand = new Set();
  const add = (x) => { const n = normDocId(x); if (n) cand.add(n); };
  add(actor && actor.id);
  if (actor && actor.email) add(actor.email);
  for (const rm of (rooms || [])) {
    const a = (rm && rm.assignment) || {};
    if (a.mode === "unassigned") continue;
    const ids = [a.primary].concat(a.doctors || []).filter(Boolean).map(normDocId);
    if (ids.some((id) => cand.has(id))) return rm;
  }
  return null;
}

// ---- membership (org-based access: role + scope) -----------------------------------------------
export function membership(o = {}) {
  requireId(o);
  const role = isRole(o.role) ? o.role : "viewer";
  return {
    id: s(o.id), orgId: s(o.orgId), identity: s(o.identity), role,
    scope: { departments: arr(o.scope && o.scope.departments), opds: arr(o.scope && o.scope.opds), rooms: arr(o.scope && o.scope.rooms) },
    active: o.active !== false, createdAt: Number(o.createdAt) || 0
  };
}

// ---- TENANT ISOLATION (pure predicates — the server enforces these on every org-scoped call) ----
export function isOwnerOfOrg(orgDoc, actorId) { return !!(orgDoc && actorId && orgDoc.ownerUid && String(orgDoc.ownerUid) === String(actorId)); }
// A membership may act in an org only if it is active AND belongs to that exact org.
export function canAccessOrg(m, orgId) { return !!(m && m.active && m.orgId && String(m.orgId) === String(orgId)); }
export function roleInOrg(m, orgId) { return canAccessOrg(m, orgId) ? m.role : null; }
// Scope check: restrict to the most-specific dimension the membership scopes AND the target names.
// Empty scope (e.g. a central nurse) = whole-org access. Admins/owners bypass scope (handled by caller).
export function withinScope(m, target) {
  if (!m) return false; target = target || {}; const sc = m.scope || {};
  if (sc.rooms && sc.rooms.length && target.roomId) return sc.rooms.indexOf(s(target.roomId)) > -1;
  if (sc.opds && sc.opds.length && target.opdId) return sc.opds.indexOf(s(target.opdId)) > -1;
  if (sc.departments && sc.departments.length && target.departmentId) return sc.departments.indexOf(s(target.departmentId)) > -1;
  return true;
}

// THE org-scoped authorization gate (PURE). orgDoc + membershipDoc are pre-fetched by the caller; this
// decides. Owner ⇒ full admin over their own org. Everyone else must be an active member of THAT org
// (cross-org/inactive denied), hold the capability, and be within scope. Server calls this on every
// org-scoped action; the frontend never decides.
export function authorizeOrgAccess(orgDoc, membershipDoc, actorId, orgId, cap, target) {
  if (!orgDoc || String(orgDoc.id) !== String(orgId)) return { ok: false, reason: "org_not_found" };
  if (isOwnerOfOrg(orgDoc, actorId)) return { ok: true, role: "admin", owner: true };
  const m = membershipDoc;
  if (!canAccessOrg(m, orgId)) return { ok: false, reason: "not_a_member" };
  if (cap && !can(m.role, cap)) return { ok: false, reason: "forbidden", role: m.role };
  if (target && !withinScope(m, target)) return { ok: false, reason: "out_of_scope", role: m.role };
  return { ok: true, role: m.role };
}
