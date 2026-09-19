// functions/_connect/enterprise/rbac.js — Track D RBAC: deny-by-default role matrix (spec §3.1, ADR-D2)
// SECURITY-CRITICAL (DUAL-ADVERSARIAL). can(role, action) returns true ONLY for an explicit matrix
// entry; unknown role/action, a non-string input, a mutated matrix, or ANY thrown error => DENY.
// The house KV fail-OPEN default is deliberately NOT copied here.
//
// // VERIFY (owner ratifies, spec §11.3): PHI actions (context:load, maik:attach) are CLINICIAN-ONLY —
// owner/admin are org-administration roles and get NO PHI by default; egress:baa (the switch that lets
// real PHI reach the LLM) is OWNER-ONLY; a clinician does not administer the org.

// "superadmin" is the PLATFORM operator (a small owner-EMAIL allow-list, functions/_adminauth.js
// ownerEmails), NOT a tenant role. It is never stored in a connect_membership row and is never
// grantable via invite()/setRole() (see TENANT_ROLES below, which members.js uses instead of ROLES
// for grant validation) — it is conferred ONLY by identity.js's isSuperAdmin() check against the
// caller's VERIFIED identify() email. functions/_connect/identity.js resolveTenant() additionally
// refuses to honor a connect_membership row whose role literally reads "superadmin" (defense-in-depth
// against a forged/corrupt row), so this role has exactly one path to being granted.
export const ROLES = Object.freeze(["owner", "admin", "clinician", "auditor", "superadmin"]);

// The roles that make sense as a per-tenant connect_membership grant (i.e. everything except the
// platform-only "superadmin"). members.js's invite()/setRole() validate against THIS, not ROLES.
export const TENANT_ROLES = Object.freeze(["owner", "admin", "clinician", "auditor"]);

export const ACTIONS = Object.freeze([
  "tenant:read", "tenant:write",
  "member:read", "member:invite", "member:role", "member:remove",
  "connector:read", "connector:write", "connector:validate",
  "context:load", "maik:attach",          // PHI — clinician only
  "ratelimit:write", "audit:read", "observability:read",
  "egress:baa",                            // owner only — flips egressBaaOk
  // WardSynQ Clinical Record Service (functions/api/wardsynq). PHI: the clinical record itself.
  // Clinician-only, like context:load; the actor CEILING in wardsynq-actors.js then decides what the
  // clinician may commit. superadmin holds both here (every ACTION, per the matrix rule) but is
  // built as a READ-tier actor by functions/_wardsynq/service.js, so a platform operator can look
  // for support and cannot write a clinical record.
  "record:read", "record:write",
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
    "record:read", "record:write",
  ]),
  auditor: Object.freeze([
    "tenant:read", "member:read", "connector:read",
    "audit:read", "observability:read",
  ]),
  // Platform super-admin (see ROLES comment above). Enumerated explicitly like every other role — NO
  // "all" wildcard — so a future ACTIONS addition must be a deliberate edit here too, not an implicit
  // grant. GUARDRAIL: "egress:baa" here is still just the RBAC *permission* — it does NOT itself flip
  // the real per-tenant egressBaaOk / open PHI-to-LLM egress. That remains a separate, app-owner +
  // tenant-flag gated action (see the owner-role comment + maik-context.js R7); this matrix entry only
  // means a super-admin is never RBAC-denied the action, same as it never carries an implicit "PHI is
  // fine" meaning for context:load/maik:attach — an actual PHI-egress route must still apply its own
  // real-world gates.
  superadmin: Object.freeze([
    "tenant:read", "tenant:write",
    "member:read", "member:invite", "member:role", "member:remove",
    "connector:read", "connector:write", "connector:validate",
    "context:load", "maik:attach",
    "ratelimit:write", "audit:read", "observability:read",
    "egress:baa",
    "record:read", "record:write",
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
