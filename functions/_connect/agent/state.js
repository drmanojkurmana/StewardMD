// functions/_connect/agent/state.js — the three DISTINCT state machines of the Connect Hospital agent,
// their transition tables, and the per-transition authorization gate.
//
// The brief lists ONE vocabulary of persisted states. Three different things move through it and they must
// not be conflated:
//   * SESSION lifecycle  — the doctor's browser context (does a live authenticated browser exist?)
//   * JOB state          — one onboarding run attached to that session (where is discovery/compile up to?)
//   * ADAPTER lifecycle  — the hospital-wide immutable adapter version (is it executable?)
// A reauthentication suspends the SESSION and the JOB; it does NOT deactivate a hospital-wide ADAPTER.
//
// EVERY transition goes through assertTransition (legal edge) + the caller's ownership/consent/role checks.
// Fail-closed: an unknown machine, unknown state, or unknown edge is a refusal, never a pass-through.
import { requireCan } from "../enterprise/guard.js";
import { PermissionError } from "../permission.js";
import { OnboardError } from "../onboard/errors.js";

// The exact vocabulary from the brief (section 5). Every machine below draws from this set only.
export const STATES = Object.freeze([
  "CREATED", "AWAITING_LOGIN", "AUTHENTICATED", "DISCOVERING", "COMPILING", "VALIDATING",
  "AWAITING_APPROVAL", "ACTIVE", "NEEDS_REAUTH", "NEEDS_REPAIR", "FAILED", "CANCELLED", "EXPIRED", "REVOKED",
]);

const T = (o) => Object.freeze(Object.fromEntries(Object.entries(o).map(([k, v]) => [k, Object.freeze(v)])));

// --- SESSION lifecycle -------------------------------------------------------------------------------
export const SESSION_STATES = Object.freeze(["CREATED", "AWAITING_LOGIN", "AUTHENTICATED", "NEEDS_REAUTH", "CANCELLED", "EXPIRED"]);
export const SESSION_TRANSITIONS = T({
  CREATED: ["AWAITING_LOGIN", "CANCELLED", "EXPIRED"],
  AWAITING_LOGIN: ["AUTHENTICATED", "NEEDS_REAUTH", "CANCELLED", "EXPIRED"],
  AUTHENTICATED: ["NEEDS_REAUTH", "CANCELLED", "EXPIRED"],
  NEEDS_REAUTH: ["AWAITING_LOGIN", "AUTHENTICATED", "CANCELLED", "EXPIRED"],
  CANCELLED: [], EXPIRED: [],
});
// The states in which a session is still usable, so a reconnecting app RESUMES instead of silently
// provisioning a second browser context for the same doctor + deployment.
export const SESSION_LIVE = Object.freeze(["CREATED", "AWAITING_LOGIN", "AUTHENTICATED", "NEEDS_REAUTH"]);

// --- JOB state ---------------------------------------------------------------------------------------
export const JOB_STATES = Object.freeze([
  "CREATED", "AWAITING_LOGIN", "AUTHENTICATED", "DISCOVERING", "COMPILING", "VALIDATING",
  "AWAITING_APPROVAL", "ACTIVE", "NEEDS_REAUTH", "FAILED", "CANCELLED", "EXPIRED",
]);
export const JOB_TRANSITIONS = T({
  CREATED: ["AWAITING_LOGIN", "NEEDS_REAUTH", "FAILED", "CANCELLED", "EXPIRED"],
  AWAITING_LOGIN: ["AUTHENTICATED", "NEEDS_REAUTH", "FAILED", "CANCELLED", "EXPIRED"],
  AUTHENTICATED: ["DISCOVERING", "NEEDS_REAUTH", "FAILED", "CANCELLED", "EXPIRED"],
  DISCOVERING: ["COMPILING", "NEEDS_REAUTH", "FAILED", "CANCELLED", "EXPIRED"],
  COMPILING: ["VALIDATING", "FAILED", "CANCELLED", "EXPIRED"],
  VALIDATING: ["AWAITING_APPROVAL", "ACTIVE", "FAILED", "CANCELLED", "EXPIRED"],
  AWAITING_APPROVAL: ["ACTIVE", "FAILED", "CANCELLED", "EXPIRED"],
  NEEDS_REAUTH: ["AWAITING_LOGIN", "FAILED", "CANCELLED", "EXPIRED"],
  ACTIVE: [], FAILED: [], CANCELLED: [], EXPIRED: [],
});
export const JOB_TERMINAL = Object.freeze(["ACTIVE", "FAILED", "CANCELLED", "EXPIRED"]);
// States a runner may lease. The runner then HOLDS the lease across the stages it drives, renewing it,
// so DISCOVERING/COMPILING/VALIDATING are not independently leasable (only reclaimable after lease loss).
export const JOB_LEASABLE = Object.freeze(["CREATED", "AUTHENTICATED"]);
// States whose in-flight lease is reclaimable by ANOTHER runner once it lapses (recovery after runner loss).
export const JOB_RECLAIMABLE = Object.freeze(["CREATED", "AWAITING_LOGIN", "AUTHENTICATED", "DISCOVERING", "COMPILING", "VALIDATING"]);

// --- ADAPTER lifecycle -------------------------------------------------------------------------------
// A version starts CREATED (a candidate). REVOKED covers both "withdrawn" and "rolled back off active":
// either way it is not executable, which is the only property the runtime cares about.
export const ADAPTER_STATES = Object.freeze(["CREATED", "VALIDATING", "AWAITING_APPROVAL", "ACTIVE", "NEEDS_REPAIR", "FAILED", "REVOKED"]);
export const ADAPTER_TRANSITIONS = T({
  CREATED: ["VALIDATING", "FAILED", "REVOKED"],
  VALIDATING: ["AWAITING_APPROVAL", "NEEDS_REPAIR", "FAILED", "REVOKED"],
  AWAITING_APPROVAL: ["ACTIVE", "NEEDS_REPAIR", "FAILED", "REVOKED"],
  ACTIVE: ["NEEDS_REPAIR", "REVOKED"],
  NEEDS_REPAIR: ["VALIDATING", "REVOKED"],
  FAILED: [], REVOKED: [],
});

const MACHINES = Object.freeze({ session: SESSION_TRANSITIONS, job: JOB_TRANSITIONS, adapter: ADAPTER_TRANSITIONS });

export function canTransition(machine, from, to) {
  try {
    if (typeof machine !== "string" || typeof from !== "string" || typeof to !== "string") return false;
    if (!Object.prototype.hasOwnProperty.call(MACHINES, machine)) return false;   // own-property only
    const table = MACHINES[machine];
    if (!Object.prototype.hasOwnProperty.call(table, from)) return false;
    return table[from].indexOf(to) !== -1;
  } catch (e) {
    return false;                                                                 // fail-closed
  }
}

export function assertTransition(machine, from, to) {
  if (!canTransition(machine, from, to)) throw new OnboardError("conflict", "illegal " + machine + " transition");
  return to;
}

// --- authorization -----------------------------------------------------------------------------------
// The agent surface needs three permission tiers. They are NOT added to functions/_connect/enterprise/
// rbac.js: that matrix is asserted element-by-element by test/connect/rbac.test.mjs and is owned by the
// enterprise track, so adding actions there from this track would break an unrelated, security-critical
// test. Instead the base membership + authentication check reuses requireCan(..., "tenant:read") — which
// every tenant role holds, and which is the SAME fail-closed guard (server-derived identity, membership,
// super-admin handling) as the rest of Connect — and this explicit deny-by-default matrix then decides
// the agent tier. // VERIFY: fold these into rbac.js as "agent:read"/"agent:session"/"agent:activate"
// when the enterprise track next revises the matrix; the semantics below are the intended entries.
// "approve" (added for the phone-runner broker's POST /versions/:id/approve|reject -- CONTRACT.md calls
// it out as canAgent(role, "approve") in functions/_connect/permission.js, but that file holds only the
// shared error classes + enforceScope; the agent role tiers live HERE, same place "activate" already
// does, so this follows the existing convention rather than the literal file name) is deliberately its
// OWN tier, not folded into "activate": "activate" (unused by the phone route; kept for the Camofox path)
// and "approve" carry the same owner/admin/superadmin-only shape today, but a future split (e.g. a
// reviewer role that may approve a phone-discovered candidate without holding full Camofox activation
// rights) should not have to touch every existing "activate" call site to get there.
export const AGENT_NEEDS = Object.freeze(["read", "session", "activate", "approve"]);
export const AGENT_MATRIX = Object.freeze({
  owner: Object.freeze(["read", "session", "activate", "approve"]),
  admin: Object.freeze(["read", "session", "activate", "approve"]),
  clinician: Object.freeze(["read", "session"]),      // a doctor onboards their own hospital; cannot activate
  auditor: Object.freeze(["read"]),                   // read-only oversight, never a browser session
  superadmin: Object.freeze(["read", "session", "activate", "approve"]),
});

export function canAgent(role, need) {
  try {
    if (typeof role !== "string" || typeof need !== "string") return false;
    if (!Object.prototype.hasOwnProperty.call(AGENT_MATRIX, role)) return false;
    return AGENT_MATRIX[role].indexOf(need) !== -1;
  } catch (e) {
    return false;                                                                 // fail-closed
  }
}

// requireAgent — authenticate, resolve tenant membership, then apply the agent tier. Throws AuthError
// (401) / PermissionError (403) exactly like every other Connect surface.
export async function requireAgent(deps, request, env, tenantId, need) {
  const { actor, tenant, role } = await requireCan(deps, request, env, tenantId, "tenant:read");
  if (!canAgent(role, need)) throw new PermissionError("role '" + role + "' may not perform agent '" + need + "'");
  return { actor, tenant, role };
}

// assertOwnership — a session/job row belongs to THIS actor in THIS tenant. A cross-tenant or cross-actor
// id is reported as not-found, never as forbidden: a 403 would confirm the id exists somewhere.
export function assertOwnership(row, tenantId, actorId) {
  if (!row || String(row.tenant_id) !== String(tenantId) || String(row.actor_id) !== String(actorId)) {
    throw new OnboardError("not-found", "session not found");
  }
  return row;
}

export { OnboardError, PermissionError };
