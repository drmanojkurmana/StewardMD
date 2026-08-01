// functions/_connect/enterprise/rbac.js — Track D RBAC: deny-by-default role matrix (spec §3.1, ADR-D2)
// SECURITY-CRITICAL (DUAL-ADVERSARIAL). can(role, action) returns true ONLY for an explicit matrix
// entry; unknown role/action, a non-string input, a mutated matrix, or ANY thrown error => DENY.
// The house KV fail-OPEN default is deliberately NOT copied here.
//
// // VERIFY (owner ratifies, spec §11.3): PHI actions (context:load, maik:attach) are CLINICIAN-ONLY —
// owner/admin are org-administration roles and get NO PHI by default; egress:baa (the switch that lets
// real PHI reach the LLM) is OWNER-ONLY; a clinician does not administer the org.

export const ROLES = Object.freeze(["owner", "admin", "clinician", "auditor"]);

export const ACTIONS = Object.freeze([
  "tenant:read", "tenant:write",
  "member:read", "member:invite", "member:role", "member:remove",
  "connector:read", "connector:write", "connector:validate",
  "context:load", "maik:attach",          // PHI — clinician only
  "ratelimit:write", "audit:read", "observability:read",
  "egress:baa",                            // owner only — flips egressBaaOk
]);

// Owner is enumerated explicitly (NO implicit "owner => all" wildcard that could mask a bug).
export const ROLE_MATRIX = Object.freeze({
  owner: Object.freeze([
    "tenant:read", "tenant:write",
    "member:read", "member:invite", "member:role", "member:remove",
    "connector:read", "connector:write", "connector:validate",
    "ratelimit:write", "audit:read", "observability:read",
    // GUARDRAIL: egress:baa here is the RBAC *owner ROLE*, which is NOT the app-owner allow-list. No route
    // consumes egress:baa today. Any future BAA-flip route MUST additionally require ownerOK(app-owner) — never
    // this RBAC role alone — or a tenant-scoped "owner" could open real-PHI LLM egress. (See maik-context.js R7.)
    "egress:baa",
  ]),
  admin: Object.freeze([
    "tenant:read", "tenant:write",
    "member:read", "member:invite", "member:role", "member:remove",
    "connector:read", "connector:write", "connector:validate",
    "ratelimit:write", "audit:read", "observability:read",
  ]),
  clinician: Object.freeze([
    "tenant:read", "connector:read",
    "context:load", "maik:attach",
  ]),
  auditor: Object.freeze([
    "tenant:read", "member:read", "connector:read",
    "audit:read", "observability:read",
  ]),
});

export function can(role, action) {
  try {
    if (typeof role !== "string" || typeof action !== "string") return false;
    // Own-property lookup only — never walk the prototype chain (blocks __proto__/constructor probes).
    if (!Object.prototype.hasOwnProperty.call(ROLE_MATRIX, role)) return false;
    const allowed = ROLE_MATRIX[role];
    if (!Array.isArray(allowed)) return false;
    return allowed.indexOf(action) !== -1;
  } catch (e) {
    return false;                          // fail-closed: any error => deny
  }
}
