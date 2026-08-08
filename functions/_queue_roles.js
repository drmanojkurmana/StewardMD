/* functions/_queue_roles.js — OPD staff roles + server-side RBAC (capability matrix).
 *
 * PURE + dependency-free (like _queue_eta.js) so it is fully unit-tested and reused identically on
 * every interface (staff web, doctor app, patient link). Least-privilege by default: an unmapped login
 * is a read-only "viewer", never a queue controller. The owner grants nurse/supervisor/etc. explicitly
 * (q_staff mapping, employeeId -> role). Frontend hiding is cosmetic ONLY — every mutation MUST be
 * gated by can()/requireCap() on the server.
 *
 * Vision (owner, 2026-08-09): nurses/OPD staff log in with their EMPLOYEE ID, control the queue
 * (reorder sick/elderly patients, assign patients to one of the 5 doctors), and EVERY action is
 * audited. A nurse may record VITALS but never treatment/prescriptions — that is doctor-only.
 */

// ---- capabilities (the atomic permissions the server checks) --------------------------------
export const CAPS = {
  QUEUE_VIEW: "queue.view",         // see a queue
  QUEUE_ADD: "queue.add",           // register / walk-in a patient
  QUEUE_REORDER: "queue.reorder",   // move up/down/to-#1 (ALWAYS needs a reason — enforced in engine)
  QUEUE_STATUS: "queue.status",     // arrived/waiting/called/in_consultation/completed/skipped/no_show
  QUEUE_PRIORITY: "queue.priority", // set the priority flag
  QUEUE_ASSIGN: "queue.assign",     // assign / transfer a patient to a doctor
  QUEUE_REMOVE: "queue.remove",     // cancel / remove a ticket
  EMR_VITALS: "emr.vitals",         // record vitals / temperature ONLY (nurse)
  EMR_TREAT: "emr.treat",           // order investigations / prescribe / full assessment (DOCTOR ONLY)
  EMR_VIEW: "emr.view",             // open the EMR patient profile (labs/meds/history)
  SESSION_MANAGE: "session.manage", // pause / emergency / session status
  ANALYTICS_VIEW: "analytics.view", // operational analytics
  STAFF_ADMIN: "staff.admin"        // manage the staff->role mapping (owner/admin only)
};

// ---- roles -> the capabilities they hold (least privilege; extend, don't widen casually) -----
// Order matters only for readability. A role absent from ROLE_CAPS resolves to [] (deny-all but view
// is still withheld) — callers should map unknown roles to "viewer".
const C = CAPS;
export const ROLE_CAPS = {
  // Owner / system admin: everything.
  admin: Object.values(CAPS),
  // Doctor: own clinical workflow + full EMR. Manages their own queue; can assign/transfer.
  doctor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN, C.QUEUE_REORDER,
           C.EMR_VITALS, C.EMR_TREAT, C.EMR_VIEW, C.SESSION_MANAGE, C.ANALYTICS_VIEW],
  // OPD supervisor: full queue control + analytics, but NO EMR treatment.
  supervisor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY,
               C.QUEUE_ASSIGN, C.QUEUE_REMOVE, C.ANALYTICS_VIEW],
  // Nurse ("sister"): runs the queue at the desk — add/reorder/assign/status/priority — AND may record
  // vitals/temperature. Explicitly NO emr.treat (no orders/prescriptions). This is the owner's core ask.
  nurse: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN,
          C.EMR_VITALS],
  // Intern / resident: clinical trainees — see the queue, advance status, record vitals, view EMR. No
  // reorder/assign/treat.
  intern: [C.QUEUE_VIEW, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW],
  resident: [C.QUEUE_VIEW, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW],
  // Reception / front desk: register walk-ins, mark arrived, assign to a doctor. No reorder/priority/EMR.
  reception: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_ASSIGN],
  // Default for a recognised-but-unmapped login: read-only.
  viewer: [C.QUEUE_VIEW]
};

export const ROLES = Object.keys(ROLE_CAPS);
export function isRole(r) { return ROLES.indexOf(String(r || "")) > -1; }

// Capabilities held by a role (empty array for unknown roles).
export function capsFor(role) { return ROLE_CAPS[String(role || "")] || []; }

// The one check every mutation runs. PURE, boolean.
export function can(role, cap) { return capsFor(role).indexOf(cap) > -1; }

// Resolve the effective role for an actor. Owner (Firebase owner email) always wins as admin; otherwise
// use the staff record's role if it is a known role; otherwise least-privilege viewer. Never trusts a
// client-supplied role.
export function roleForActor(actor, staffRecord, isOwner) {
  if (isOwner) return "admin";
  if (actor && actor.role && isRole(actor.role)) return actor.role;   // a doctor session may carry role
  if (staffRecord && isRole(staffRecord.role)) return staffRecord.role;
  return "viewer";
}

// Throw a 403-shaped error when a capability is missing (mirrors the engine's {status} error convention).
export function requireCap(role, cap) {
  if (!can(role, cap)) {
    throw Object.assign(new Error("forbidden"), { status: 403, detail: cap, role: role });
  }
  return true;
}
