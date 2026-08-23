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
  STAFF_ADMIN: "staff.admin",       // manage the staff->role mapping (owner/admin only)
  // ---- clinic operations: orders + billing station (flag smd_opd_billing) -------------------
  ORDER_CREATE: "order.create",     // create a first-class investigation/medication order (doctor)
  ORDER_READ: "order.read",         // read a patient's orders (cashier / later pharmacy / lab)
  BILLING_VIEW: "billing.view",     // see the billing station queue + tariff catalog
  BILLING_CHARGE: "billing.charge", // generate an invoice + record payment (cashier)
  ORDER_DISPENSE: "order.dispense", // hand medicines to the patient + mark the order dispensed (pharmacy)
  // ---- ONCQIS (oncology protocol governance) caps -------------------------------------------
  // Strict role separation: authoring, clinical review, and institutional approval are DISTINCT
  // caps held by DISTINCT roles. Doctor/Nurse never hold any of these (they consume ACTIVE
  // protocols, they do not author/approve them). System admin is technical-config only and is
  // NOT granted any of the three (see ADMIN role below).
  ONCQIS_PROTOCOL_AUTHOR: "oncqis.protocol.author",           // create/edit a DRAFT + upload evidence
  ONCQIS_CLINICAL_REVIEWER: "oncqis.clinical.reviewer",       // R1 accept/reject + resolve VERIFY (platform CLINICAL APPROVAL)
  ONCQIS_INSTITUTIONAL_APPROVER: "oncqis.institutional.approver" // hospital approve + activate (HOSPITAL APPROVAL)
};

// The ONCQIS governance caps. System admin (technical config only) is explicitly NOT granted any of
// these - clinical/hospital approval is never a technical-admin power (spec role separation).
export const ONCQIS_CAPS = [
  CAPS.ONCQIS_PROTOCOL_AUTHOR, CAPS.ONCQIS_CLINICAL_REVIEWER, CAPS.ONCQIS_INSTITUTIONAL_APPROVER
];

// ---- roles -> the capabilities they hold (least privilege; extend, don't widen casually) -----
// Order matters only for readability. A role absent from ROLE_CAPS resolves to [] (deny-all but view
// is still withheld) — callers should map unknown roles to "viewer".
const C = CAPS;
export const ROLE_CAPS = {
  // Owner / system admin: every OPERATIONAL/technical cap, but explicitly NOT the ONCQIS clinical or
  // hospital approval caps. Protocol authoring, clinical review, and institutional approval are clinical
  // governance, never a technical-admin power - a system admin must not be able to approve/activate a
  // protocol (spec role separation, non-negotiable).
  admin: Object.values(CAPS).filter((c) => ONCQIS_CAPS.indexOf(c) < 0),
  // Doctor: own clinical workflow + full EMR. Manages their own queue; can assign/transfer.
  doctor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN, C.QUEUE_REORDER,
           C.EMR_VITALS, C.EMR_TREAT, C.EMR_VIEW, C.SESSION_MANAGE, C.ANALYTICS_VIEW, C.ORDER_CREATE, C.ORDER_READ],
  // OPD supervisor: full queue control + analytics + READ clinical notes/history. NO EMR treatment.
  supervisor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY,
               C.QUEUE_ASSIGN, C.QUEUE_REMOVE, C.ANALYTICS_VIEW, C.EMR_VIEW],
  // Nurse ("sister"): runs the queue at the desk — add/reorder/assign/status/priority — may record
  // vitals/temperature, and may READ a patient's clinical notes/history (view-only, e.g. from the
  // console). Explicitly NO emr.treat (no orders/prescriptions/edits). This is the owner's core ask.
  nurse: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN,
          C.EMR_VITALS, C.EMR_VIEW],
  // Intern / resident: clinical trainees — see the queue, register a walk-in, advance status, record
  // vitals, view EMR. QUEUE_ADD added 2026-08-24: an intern is often the person handed a walk-in, and
  // withholding it meant they could move patients through consultation but not enter them. Reorder and
  // assign stay OFF - deciding who is seen next is the nurse's authority, not a trainee's.
  intern: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW],
  resident: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW],
  // Reception / front desk: register walk-ins, mark arrived, assign to a doctor, and READ clinical
  // notes/history (view-only). No reorder/priority, no vitals, no treat/edit.
  reception: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_ASSIGN, C.EMR_VIEW],
  // Cashier / billing desk: see the billing queue + tariff, read a patient's orders, and generate +
  // settle invoices. No queue reorder, no vitals, no treatment. (Pharmacy/lab roles extend this pattern.)
  cashier: [C.QUEUE_VIEW, C.ORDER_READ, C.BILLING_VIEW, C.BILLING_CHARGE],
  // Pharmacy: reads the patient's medication orders and marks them dispensed once paid. Deliberately
  // NOT given EMR_VIEW - dispensing needs the order, not the consultation notes - and never
  // BILLING_CHARGE, so the person handing over medicines is not the person taking the money.
  pharmacy: [C.QUEUE_VIEW, C.ORDER_READ, C.ORDER_DISPENSE],
  // HR / practice manager: runs the staff list and reads operational analytics. NO queue control, NO
  // vitals, NO EMR, NO billing. Exists so onboarding a nurse does not require handing someone full
  // admin (which carries every clinical and billing capability in the system).
  hr: [C.QUEUE_VIEW, C.STAFF_ADMIN, C.ANALYTICS_VIEW],
  // ---- ONCQIS governance roles (oncology protocol lifecycle) --------------------------------
  // Protocol Author: create/edit DRAFT protocols + upload evidence. NO review, NO approval, NO
  // activation. Not a clinical or hospital approver.
  oncqis_protocol_author: [C.ONCQIS_PROTOCOL_AUTHOR],
  // Clinical Reviewer: platform R1 clinical review - accept/reject a submitted DRAFT and resolve
  // VERIFY (CLINICAL APPROVAL). Cannot author drafts, cannot give hospital approval/activation.
  oncqis_clinical_reviewer: [C.ONCQIS_CLINICAL_REVIEWER],
  // Institutional Approver: HOSPITAL APPROVAL + activation of a hospital implementation. Cannot
  // author or clinically review.
  oncqis_institutional_approver: [C.ONCQIS_INSTITUTIONAL_APPROVER],
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
