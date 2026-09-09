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
  // ---- inpatient eMAR (2026-09-07) ------------------------------------------------------------
  // Giving a dose at the bedside is its OWN authority, deliberately not folded into EMR_VITALS or
  // EMR_TREAT. A nurse must be able to administer without gaining the right to prescribe, and a
  // doctor holding EMR_TREAT should not silently inherit the bedside role either — so this is
  // granted explicitly to the roles that give medicines, and to nobody else.
  MED_ADMINISTER: "med.administer", // scan + give a dose and record the administration (ward nurse)
  /* Pharmacy verification, 2026-09-07. Its OWN authority, and narrow on purpose.
   *
   * A pharmacist checking an order against the patient's allergies, renal function and the rest of
   * their medicines is a distinct clinical safety step from a nurse giving the dose, and folding it
   * into MED_ADMINISTER (which is what the eMAR did) would have meant granting pharmacy write access
   * to MedicationAdministration - and a role that can write that could post a fabricated
   * "administered" row through the raw record API without going near a bedside. So verification
   * writes its own resource and reads only what a verification actually needs. */
  ORDER_VERIFY: "order.verify",     // check an order against the chart before the ward gives it (pharmacy)
  /* Resulting a test, 2026-09-07. Its own authority, like verification: a laboratory releasing a
   * result is not a clinician treating a patient, and the two must not borrow each other's powers.
   * See _wardsynq/lab-result.js for what it grants and the one residual it does not close. */
  LAB_RESULT: "lab.result",         // release a result against an ordered test (laboratory)
  // ---- TASK 4.13 (Enterprise RBAC/ABAC): two more record-custody/clinical-commitment authorities
  // that this codebase folded into emr.treat/staff.admin, narrowed here for the same reason
  // ORDER_VERIFY/LAB_RESULT/ORDER_DISPENSE were each split out - a distinct role must not have to
  // borrow a broader one's power to do its own job. Least privilege, per the plan's own text.
  HIM_ROI: "him.roi",               // decide and record a release-of-information request (HIM)
  TRANSFUSION_ISSUE: "transfusion.issue", // crossmatch/issue/administer a transfusion (blood bank)
  // TASK 4.15 (Emergency Command Mode): declaring/deactivating a hospital-wide emergency is a
  // governance act, not a clinical one - its own capability, held only by admin/owner, never
  // folded into emr.treat (a doctor treating a patient is not the same authority as a hospital
  // declaring mass-casualty mode).
  EMERGENCY_DECLARE: "emergency.declare",
  // ---- WardSynQ TASK 5.14 (Clinical Incident Management) ------------------------------------
  // Filing is broad on purpose - wardsynq-incidents.js's own header names the failure mode as
  // silence, not a bad severity matrix, and every capability check between "something happened"
  // and "it got filed" is friction that loses the minor and near-miss reports first. Anyone
  // clinical may report. Triage/RCA/CAPA/close is a DISTINCT, narrower authority: the
  // investigation's own conclusions are never anonymous and never held by whoever happened to
  // report, the same separation ONCQIS/PGLOG hold between authoring and sign-off.
  INCIDENT_REPORT: "incident.report",
  INCIDENT_INVESTIGATE: "incident.investigate",
  // ---- ONCQIS (oncology protocol governance) caps -------------------------------------------
  // Strict role separation: authoring, clinical review, and institutional approval are DISTINCT
  // caps held by DISTINCT roles. Doctor/Nurse never hold any of these (they consume ACTIVE
  // protocols, they do not author/approve them). System admin is technical-config only and is
  // NOT granted any of the three (see ADMIN role below).
  ONCQIS_PROTOCOL_AUTHOR: "oncqis.protocol.author",           // create/edit a DRAFT + upload evidence
  ONCQIS_CLINICAL_REVIEWER: "oncqis.clinical.reviewer",       // R1 accept/reject + resolve VERIFY (platform CLINICAL APPROVAL)
  ONCQIS_INSTITUTIONAL_APPROVER: "oncqis.institutional.approver", // hospital approve + activate (HOSPITAL APPROVAL)
  // ---- NMC PG Logbook (pglog) caps -----------------------------------------------------------
  // The same separation ONCQIS uses, for the same reason: a PG logbook entry is a document a
  // University examiner relies on, and PGMER-2023 9.2(c) penalises the NAMED faculty/HoD/Dean who
  // submits a false record. So the person who LOGS never holds the cap to VERIFY, and technical
  // admin is not clinical sign-off. (pg_resident below holds no verify/assess/attest cap at all;
  // pglog-model.js additionally THROWS on a self-verify, so there are two independent locks.)
  PGLOG_LOG_OWN: "pglog.log.own",                   // create/edit own draft entries
  PGLOG_SUBMIT_OWN: "pglog.submit.own",             // submit own entries for verification
  PGLOG_VIEW_OWN: "pglog.view.own",                 // read own logbook + progress + feedback
  PGLOG_VIEW_ASSIGNED: "pglog.view.assigned",       // read the logbooks of assigned residents
  PGLOG_VERIFY: "pglog.verify",                     // verify / return an entry (PGMER-2023 5.2(vi))
  PGLOG_ASSESS: "pglog.assess",                     // record a formative assessment + feedback
  PGLOG_ATTEST: "pglog.attest",                     // the MONTHLY guide authentication (5.2(vi))
  PGLOG_VIEW_DEPT: "pglog.view.dept",               // department-wide oversight (HOD)
  PGLOG_VIEW_INSTITUTION: "pglog.view.institution", // institution-wide oversight (Academic Cell, 5.2(iii))
  PGLOG_CONFIGURE: "pglog.configure",               // programmes, rotations, curriculum overrides
  PGLOG_AUDIT: "pglog.audit"                        // read the audit trail / revision history
};

// The PG-logbook sign-off caps. Like the ONCQIS three, these are NOT granted to the technical admin
// role: signing a resident's training record is clinical supervision, not system administration.
export const PGLOG_SIGNOFF_CAPS = [
  CAPS.PGLOG_VERIFY, CAPS.PGLOG_ASSESS, CAPS.PGLOG_ATTEST
];

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
  admin: Object.values(CAPS).filter((c) => ONCQIS_CAPS.indexOf(c) < 0 && PGLOG_SIGNOFF_CAPS.indexOf(c) < 0),
  // Doctor: own clinical workflow + full EMR. Manages their own queue; can assign/transfer.
  doctor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN, C.QUEUE_REORDER,
           C.EMR_VITALS, C.EMR_TREAT, C.EMR_VIEW, C.SESSION_MANAGE, C.ANALYTICS_VIEW, C.ORDER_CREATE, C.ORDER_READ,
           C.INCIDENT_REPORT],
  // OPD supervisor: full queue control + analytics + READ clinical notes/history. NO EMR treatment.
  supervisor: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY,
               C.QUEUE_ASSIGN, C.QUEUE_REMOVE, C.ANALYTICS_VIEW, C.EMR_VIEW, C.INCIDENT_REPORT],
  // Nurse ("sister"): runs the queue at the desk — add/reorder/assign/status/priority — may record
  // vitals/temperature, and may READ a patient's clinical notes/history (view-only, e.g. from the
  // console). Explicitly NO emr.treat (no orders/prescriptions/edits). This is the owner's core ask.
  // MED_ADMINISTER added 2026-09-07 with the inpatient eMAR: giving a dose at the bedside is the
  // nurse's job and nobody else's here. It grants the administration record ONLY - still no
  // emr.treat, so a nurse who can give a dose still cannot write the order for it.
  nurse: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_REORDER, C.QUEUE_STATUS, C.QUEUE_PRIORITY, C.QUEUE_ASSIGN,
          C.EMR_VITALS, C.EMR_VIEW, C.MED_ADMINISTER, C.INCIDENT_REPORT],
  // Intern / resident: clinical trainees — see the queue, register a walk-in, advance status, record
  // vitals, view EMR. QUEUE_ADD added 2026-08-24: an intern is often the person handed a walk-in, and
  // withholding it meant they could move patients through consultation but not enter them. Reorder and
  // assign stay OFF - deciding who is seen next is the nurse's authority, not a trainee's.
  intern: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW, C.INCIDENT_REPORT],
  resident: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW, C.INCIDENT_REPORT],
  // Reception / front desk: register walk-ins, mark arrived, assign to a doctor, and READ clinical
  // notes/history (view-only). No reorder/priority, no vitals, no treat/edit.
  reception: [C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.QUEUE_ASSIGN, C.EMR_VIEW],
  // Cashier / billing desk: see the billing queue + tariff, read a patient's orders, and generate +
  // settle invoices. No queue reorder, no vitals, no treatment. (Pharmacy/lab roles extend this pattern.)
  cashier: [C.QUEUE_VIEW, C.ORDER_READ, C.BILLING_VIEW, C.BILLING_CHARGE],
  // Pharmacy: reads the patient's medication orders and marks them dispensed once paid. Deliberately
  // NOT given EMR_VIEW - dispensing needs the order, not the consultation notes - and never
  // BILLING_CHARGE, so the person handing over medicines is not the person taking the money.
  pharmacy: [C.QUEUE_VIEW, C.ORDER_READ, C.ORDER_DISPENSE, C.ORDER_VERIFY],
  /* Laboratory: sees the tests that were ordered and releases results against them. Deliberately NO
   * EMR_VIEW - resulting a potassium needs the request, not the consultation notes - and no
   * ordering, dispensing or billing capability of any kind. */
  /* No ORDER_READ, deliberately. It would have been the obvious thing to include - the comment on
   * that capability even anticipates a lab - but it grants MedicationOrder as well as
   * ServiceRequest, and a laboratory has no need to know what the patient is being prescribed.
   * LAB_RESULT already carries the investigation requests, which is the only order a lab works from.
   * Caught by the role-mapping test, which is what it is for. */
  lab: [C.QUEUE_VIEW, C.LAB_RESULT],
  // HR / practice manager: runs the staff list and reads operational analytics. NO queue control, NO
  // vitals, NO EMR, NO billing. Exists so onboarding a nurse does not require handing someone full
  // admin (which carries every clinical and billing capability in the system).
  hr: [C.QUEUE_VIEW, C.STAFF_ADMIN, C.ANALYTICS_VIEW],
  // ---- TASK 4.13 (Enterprise RBAC/ABAC) -----------------------------------------------------
  // Billing (distinct from Cashier): reads charges/invoices/claims. No BILLING_CHARGE - a billing
  // clerk who codes and reviews does not also collect payment; a site that separates the two desks
  // now can. Composed entirely from existing caps - no new capability was needed for this one.
  billing: [C.QUEUE_VIEW, C.ORDER_READ, C.BILLING_VIEW],
  // HIM (Health Information Management): reads the chart to decide what may be released, and
  // records the release decision itself via HIM_ROI. No EMR_TREAT, no billing, no queue control
  // beyond viewing. See actor.js's HIM_ROI branch for exactly what this writes.
  him: [C.QUEUE_VIEW, C.EMR_VIEW, C.HIM_ROI],
  // Blood Bank: crossmatches, issues and administers a transfusion. No EMR_VIEW, no EMR_VITALS, no
  // EMR_TREAT - see actor.js's TRANSFUSION_ISSUE branch for the narrow TransfusionEpisode-only
  // scope this composes to, the separation migrate-transfusion.js's own header names as deferred.
  blood_bank: [C.QUEUE_VIEW, C.TRANSFUSION_ISSUE],
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
  // ---- NMC PG Logbook roles (see NMC_PG_LOGBOOK_REQUIREMENTS.md section 7) --------------------
  // PG resident: creates and submits their OWN records and reads their own progress and feedback.
  // Holds NO verify/assess/attest cap - "cannot approve own official records" is enforced by the
  // ABSENCE of the capability here, and independently by a throw in pglog-model.verify().
  // Also carries the trainee's clinical caps (a PG resident is a working resident), matching the
  // existing `resident` role above so a PG does not need two logins.
  pg_resident: [C.PGLOG_LOG_OWN, C.PGLOG_SUBMIT_OWN, C.PGLOG_VIEW_OWN,
                C.QUEUE_VIEW, C.QUEUE_ADD, C.QUEUE_STATUS, C.EMR_VITALS, C.EMR_VIEW],
  // PG guide / faculty: reviews, assesses, verifies or returns, and gives the MONTHLY authentication
  // PGMER-2023 5.2(vi) requires. May keep their own logbook (many are also trainees elsewhere).
  pg_faculty: [C.PGLOG_VIEW_ASSIGNED, C.PGLOG_VERIFY, C.PGLOG_ASSESS, C.PGLOG_ATTEST,
               C.PGLOG_LOG_OWN, C.PGLOG_SUBMIT_OWN, C.PGLOG_VIEW_OWN,
               C.QUEUE_VIEW, C.EMR_VIEW, C.EMR_TREAT],
  // Head of Department: everything faculty hold, plus department-wide oversight, the audit trail and
  // the final HoD signature + proficiency certificate the curricula require.
  pg_hod: [C.PGLOG_VIEW_ASSIGNED, C.PGLOG_VERIFY, C.PGLOG_ASSESS, C.PGLOG_ATTEST,
           C.PGLOG_VIEW_DEPT, C.PGLOG_AUDIT, C.PGLOG_VIEW_OWN,
           C.QUEUE_VIEW, C.EMR_VIEW, C.EMR_TREAT, C.ANALYTICS_VIEW],
  // Academic Cell (PGMER-2023 5.2(iii): "shall ensure and monitor the implementation of training
  // programmes in each specialities"). Institution-wide oversight, curriculum configuration and audit
  // access - but explicitly NOT verify/assess/attest: monitoring implementation is not signing a
  // trainee's clinical record.
  academic_cell: [C.PGLOG_VIEW_INSTITUTION, C.PGLOG_VIEW_DEPT, C.PGLOG_VIEW_ASSIGNED,
                  C.PGLOG_CONFIGURE, C.PGLOG_AUDIT, C.ANALYTICS_VIEW],
  // WardSynQ TASK 5.14/23: Clinical Safety Officer. Named explicitly in the plan's own
  // authorization section as the role that "reviews/approves governed safety content" - triages,
  // investigates and closes incidents. Deliberately NOT full admin: a safety officer can hold
  // this without also gaining staff/billing/technical administration, and a technical admin
  // holding INCIDENT_INVESTIGATE via the `admin` role above is that site's own choice, not this
  // role's default. EMR_VIEW so an investigation can read the chart an incident references.
  safety_officer: [C.QUEUE_VIEW, C.EMR_VIEW, C.INCIDENT_REPORT, C.INCIDENT_INVESTIGATE],
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
