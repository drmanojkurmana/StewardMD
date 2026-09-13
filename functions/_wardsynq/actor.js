/* functions/_wardsynq/actor.js — ONE authorization path from a request to a governed clinical actor.
 *
 * The hospital already has a role system: functions/_queue_roles.js, eighteen roles, each a list of
 * capabilities, granted per organisation in q_members and decided server-side by authorizeOrg().
 * The interop platform has a second, smaller one: connect_membership (owner / admin / clinician /
 * auditor). WardSynQ has a ladder (READ / SUGGEST / DRAFT / EXECUTE) that says how far an actor may
 * go, and, since today, a scope that says on what. This file joins them without adding a fourth.
 *
 *   request ──identity──▶ who (Firebase / Access / staff session)
 *           ──tenant────▶ the Connect tenant row (must exist; the record is keyed on it)
 *           ──role──────▶ OPD org role via authorizeOrg()  |  else Connect membership role
 *           ──grant─────▶ tier + read scope + write scope, DERIVED FROM THE ROLE'S CAPABILITIES
 *           ──actor─────▶ makeActor(), which clamps to the kind's ceiling as it always has
 *
 * THE MAPPING IS FROM CAPABILITIES, NOT FROM ROLE NAMES. The owner's non-negotiable in
 * _queue_roles.js is "a nurse may record VITALS but never treatment/prescriptions". That is already
 * encoded as EMR_VITALS without EMR_TREAT. Deriving the grant from those two capabilities means the
 * clinical record cannot disagree with the queue about what a nurse is, and a new role gets the
 * right grant by holding the right capabilities rather than by being added to a table here.
 *
 *   EMR_TREAT             EXECUTE   write every type          read every type       doctor, pg_faculty, pg_hod, admin
 *   EMR_VITALS (no TREAT) EXECUTE   write Observation(+Patient*) read every type (has EMR_VIEW)   nurse, intern, resident, pg_resident
 *   EMR_VIEW only         READ      write nothing (+Patient*)    read every type       supervisor, reception
 *   ORDER_READ only       READ      write nothing             read orders only      cashier, pharmacy
 *   none of these         no clinical actor at all: 403    hr, viewer, oncqis_*, academic_cell
 *
 * *QUEUE_ADD, added 2026-09-06. Its own docstring in _queue_roles.js already says what it is:
 * "register / walk-in a patient". A role that holds it may write a Patient EVEN IF it holds none of
 * the EMR capabilities above — which is exactly reception's case: EMR_VIEW alone would leave her at
 * READ, but registering a patient is a committed administrative fact, the same reasoning EMR_VITALS
 * already established for a nurse's vitals, so QUEUE_ADD raises the tier to EXECUTE and adds
 * "Patient" to the write scope, on top of whatever the EMR capabilities already granted. It changes
 * nothing else: a receptionist still cannot write an Observation or a note.
 *
 * A nurse gets EXECUTE and not DRAFT because a recorded blood pressure is a committed clinical fact,
 * not a proposal awaiting a signature. What keeps her off a prescription is scope, which is a
 * governance denial (SCOPE_DENIED), and what keeps her from signing anything is that she holds no
 * credential. Nothing here changes a clinical rule; the safety engine never sees this file.
 *
 * PRECEDENCE. When the tenant is linked to an OPD organisation and the person is a member of it,
 * the OPD role decides. That is the hospital's staff registry and it is where a nurse or a
 * receptionist exists at all; Connect membership has no such roles. Connect's `clinician` still
 * carries a doctor who uses the app against an integration-mode hospital with no OPD org. Connect's
 * owner / admin / auditor never reach the chart, as before.
 *
 * AI. A write that declares an AI origin, or whose entity says `aiDrafted: true`, is written by an
 * AI-KIND actor `ai:<name>`, capped at DRAFT by its kind, carrying `onBehalfOf` = the human whose
 * session it ran in, and holding no more write scope than that human holds. The doctor whose token
 * made the request is named as the delegate, never as the author.
 */

import { makeActor, KIND, TIER, can as actorCan } from "../../wardsynq/wardsynq-actors.js";
import { CAPS, ROLES, capsFor, isRole } from "../_queue_roles.js";
import { resolveTenant } from "../_connect/identity.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { can as connectCan } from "../_connect/enterprise/rbac.js";

const RESOURCE_TYPES = Object.freeze([
  "Patient", "Encounter", "Condition", "AllergyIntolerance", "Observation",
  "MedicationOrder", "MedicationAdministration", "ServiceRequest", "DiagnosticReport",
  "CarePlan", "ClinicalNote",
]);
const ORDER_TYPES = Object.freeze(["MedicationOrder", "ServiceRequest"]);
/* What EMR_VITALS lets a nurse write: what she records about her own patients. ShiftHandover joined
 * Observation on 2026-09-07 with the nursing flowsheet, and it is a NARROW addition on purpose - a
 * handover is the nurse's own account of a shift, not a clinical document. Putting it in
 * ClinicalNote instead would have required widening this scope to cover every clinical document,
 * which would also have let a nurse author a discharge summary or an assessment. */
/* BreakGlassGrant joined them on 2026-09-07 with emergency access. Declaring an emergency is a
 * write of the DECLARATION, and EMR_VITALS is the lowest capability meaning "this person has
 * clinical business with patients" - which is exactly who may declare one. It grants no clinical
 * write whatsoever: the grant that gets written is read-only in what it confers, and a nurse who
 * breaks glass still cannot prescribe or diagnose. See break-glass.js. */
/* MedicationReconciliation joined them the same day. TAKING a medicines history is ward-staff work -
 * a nurse or a pharmacist sits with the patient and writes down what they take - and that is what
 * this write is. DECIDING what happens to each medicine is prescribing-adjacent and is gated
 * separately at emr.treat on the route, so this grant lets a nurse record the history and not
 * decide its fate. */
/* SpecimenCollection joined on 2026-09-07: taking a sample is nursing work, the same authority as
 * recording a vital. It records that a sample was TAKEN and never what it showed - the result is the
 * laboratory's own authority, so this grants nothing towards one. */
/* DeviceAssociation joined 2026-09-08 (Task 2.2, ICU): scanning a patient's wristband and a
 * monitor's asset tag onto each other is a bedside act, the same authority as recording a vital -
 * not a device-inventory decision, which would belong somewhere administrative instead. */
/* BloodLossRecord joined 2026-09-08 (Task 2.4): weighing swabs and drapes (or estimating, when that
 * is all that's possible) is the midwife's own bedside quantification, the same authority as
 * charting fluid balance - not a diagnosis, and not gated behind emr.treat the way starting the PPH
 * bundle itself is. */
const VITALS_TYPES = Object.freeze(["Observation", "ShiftHandover", "BreakGlassGrant", "MedicationReconciliation", "PatientConsent", "CarePlan", "RiskAssessment", "SpecimenCollection", "WoundAssessment", "ClinicalRead", "DeviceAssociation", "BloodLossRecord",
  // TASK 6.14: PatientTag - assigning/replacing/ending a wristband is the same bedside act as
  // DeviceAssociation, above, and the same capability governs both.
  "PatientTag",
  // FormResponse: a completed hospital form (triage, nursing assessment, checklist) - documentation the
  // nurse records at the bedside, answered against a form the hospital published for their role.
  "FormResponse"]);
const PATIENT_TYPE = "Patient";
// Added 2026-09-06 (the Encounter migration), alongside PATIENT_TYPE and for the identical reason:
// checking a patient in for today's visit is the SAME administrative act QUEUE_ADD already covers
// for registering them at all. See below.
const ENCOUNTER_TYPE = "Encounter";
// The bedside record, granted only by CAPS.MED_ADMINISTER (see grantForCaps).
const ADMINISTRATION_TYPE = "MedicationAdministration";

/**
 * PURE. From a capability list to a clinical grant, or null when the role has no business with the
 * chart. `null` scope means every type; `[]` means none.
 * @returns {{tier: string, read: string[]|null, write: string[]|null, basis: string} | null}
 */
function grantForCaps(caps) {
  const has = (c) => Array.isArray(caps) && caps.includes(c);
  /* Category allow-lists are unioned exactly as the type lists are, and for the same reason: adding
   * a capability must never narrow what a role could already do. A doctor who is also on the lab
   * rota holds EMR_TREAT, whose write scope is unconstrained, and the tail of this function drops
   * every category constraint in that case - an unconstrained scope cannot be partly constrained. */
  const mergeCats = (a, b) => {
    if (!b) return a;
    const out = { ...(a || {}) };
    for (const k of Object.keys(b)) out[k] = [...new Set([...(out[k] || []), ...b[k]])];
    return out;
  };
  let grant = null;
  if (has(CAPS.EMR_TREAT)) grant = { tier: TIER.EXECUTE, read: null, write: null, basis: CAPS.EMR_TREAT };
  else if (has(CAPS.EMR_VITALS)) {
    /* A nurse charts vital signs and fluid. She does not issue laboratory results, and before this
     * constraint existed the type-level scope let her: `Observation` is one resource type carrying
     * four unrelated clinical meanings, and the critical-value loop believes anything categorised
     * `laboratory`. */
    /* "device" joined 2026-09-08 (Task 2.2, ICU): a device reading reaches the chart through
     * migrate-device.js's rehydrated DeviceGateway, called by the SAME nurse action as charting a
     * vital - scanning a wristband and an asset tag onto each other. Without this category a device
     * observation is refused by the exact CATEGORY_DENIED rule this comment already describes. */
    /* "labour" joined 2026-09-08 (Task 2.4): a partogram's raw data - cervical dilation, contraction
     * frequency, fetal heart rate, a stated labour status - is the midwife's own bedside charting,
     * the same authority as a vital sign, through migrate-maternity.js's recordLabourObservation(). */
    /* "neonatal" joined 2026-09-08 (Task 2.5): respiratory-support/device-settings readings on a
     * NICU cot are the same bedside charting act, through migrate-pediatrics.js's
     * recordNeonatalObservation(). */
    grant = {
      tier: TIER.EXECUTE, read: has(CAPS.EMR_VIEW) ? null : [...VITALS_TYPES], write: [...VITALS_TYPES],
      writeCategories: { Observation: ["vital-signs", "fluid-balance", "device", "labour", "neonatal"] },
      basis: CAPS.EMR_VITALS,
    };
  }
  else if (has(CAPS.EMR_VIEW)) grant = { tier: TIER.READ, read: null, write: [], basis: CAPS.EMR_VIEW };
  else if (has(CAPS.ORDER_READ)) grant = { tier: TIER.READ, read: [...ORDER_TYPES], write: [], basis: CAPS.ORDER_READ };

  if (has(CAPS.QUEUE_ADD)) {
    // Registering a patient is a committed identity fact, not a clinical draft — see the module
    // header. Opening the visit record for today's check-in (functions/_wardsynq/migrate-encounter.js)
    // is the SAME kind of fact, added here 2026-09-06 rather than a second reason invented for it.
    // Union, never narrow: this only ever ADDS these two types to whatever write scope the EMR
    // capabilities already produced, and only ever RAISES the tier. Every role holding QUEUE_STATUS
    // (closing a visit) already holds QUEUE_ADD too, so no separate grant is needed for close.
    /* Appointment and PatientLink joined them on 2026-09-07. Booking a patient in, and resolving two
     * records that turned out to be one person, are the SAME administrative act as registering them
     * in the first place - the front desk's work, not a clinical decision. An AppointmentRequest is
     * NOT here: promising that a patient needs to be seen again is clinical, and it is granted by
     * EMR_TREAT, which carries unrestricted write. */
    // Blackout joined 2026-09-09 (TASK 4.5): blocking a clinician's diary or a resource for a period
    // is the SAME administrative scheduling act as booking or cancelling one, not a clinical decision.
    /* RelatedPerson joined 2026-09-13. Recording who to ring is the front desk's work and the same
     * administrative act as registering the patient - it is not a clinical decision and asking a
     * doctor to enter a telephone number is how the field stays empty. It grants nothing clinical:
     * a receptionist still cannot write an observation or a note. */
    const added = [PATIENT_TYPE, ENCOUNTER_TYPE, "Appointment", "PatientLink", "PrescriptionTransmission", "AdmissionRequest", "ResourceBooking", "Blackout", "RelatedPerson"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: null, write: added, basis: CAPS.QUEUE_ADD };
    else grant = {
      tier: TIER.EXECUTE, read: grant.read,
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      // Carried, not dropped. A union branch that rebuilt the grant without this would silently
      // remove the category constraint the earlier branch established - widening by omission.
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.QUEUE_ADD,
    };
  }

  if (has(CAPS.LAB_RESULT)) {
    /* The laboratory, 2026-09-07. It reads the requests it is working from and writes the results:
     * the Observations that carry the values and the DiagnosticReport that releases them.
     *
     * THE RESIDUAL THIS COMMENT USED TO DESCRIBE IS CLOSED. Write scope was by resource TYPE alone,
     * and a laboratory result and a nurse's blood pressure are both Observations, so this grant let
     * a lab actor write a vital sign through the raw record API - which the eMAR then believes when
     * it checks a weight-based dose. The store now takes a per-type category allow-list, and this
     * grant carries one: laboratory, and nothing else. The route stamping category "laboratory" is
     * still asserted by its own test; it is no longer the only thing standing there. */
    /* SpecimenCollection is on both lists as of 2026-09-07: the laboratory is the half of the journey
     * that RECEIVES the sample, and a lab that cannot record "we have it" leaves every tube reading
     * as still in a nurse's pocket. It writes the specimen's arrival, never its collection. */
    /* AllergyIntolerance and ImagingProtocol joined on 2026-09-08 with radiology protocolling.
     * Deciding to give intravenous contrast is the point where an imaging request becomes a drug
     * administration, and it cannot be made safely without seeing a previous contrast reaction - so
     * the read is required for the check to be honest rather than decorative. The write is the
     * protocol itself and nothing else: this grant still reaches no prescription, no administration
     * and no diagnosis. */
    /* Patient joined 2026-09-12, for the bench worklist and for nothing else.
     *
     * The laboratory could read the REQUEST but never who it belonged to, so every row of its own
     * worklist read "opd-pat-smd-demo-00020" - an identifier that cannot be checked against a tube,
     * a form or a wristband, which is the one check the whole specimen subsystem exists to make.
     * The imaging worklist settled this exact question already and is gated emr.view for exactly
     * this reason: "a worklist with no identity on it is worse than no worklist".
     *
     * This is READ on Patient, which is name, identifiers, date of birth and sex. It is emphatically
     * NOT emr.view: that was tried on the lab role first and reverted the same day, because it also
     * opens the discharge summary and the ward's critical-results list, and
     * wardsynq-inpatient-emar.test.mjs rightly asserts 403 on both. The grant below still reaches no
     * Encounter, no Condition, no MedicationOrder, no note and no diagnosis. A laboratory still
     * cannot read the chart; it can now name the sample in front of it. */
    /* CriticalResultLoop joined 2026-09-14, and it is a SAFETY FIX. Releasing a result now opens the
     * critical-result loop straight away on the server, and the laboratory is who releases results - but
     * this grant could not write a CriticalResultLoop, so a potassium of 7.2 released by the lab was saved,
     * the loop was refused, and no critical alert opened. The lab may now write the loop its own result
     * opens, and read it back to avoid opening it twice. This does NOT open the ward's critical-results
     * LIST to the laboratory: that route is gated by capability at the door, which is unchanged. */
    const canRead = ["Patient", "ServiceRequest", "Observation", "DiagnosticReport", "SpecimenCollection", "AllergyIntolerance", "ImagingProtocol", "CriticalResultLoop"];
    const canWrite = ["Observation", "DiagnosticReport", "SpecimenCollection", "ImagingProtocol", "CriticalResultLoop"];
    const cats = { Observation: ["laboratory"] };
    if (!grant) grant = { tier: TIER.EXECUTE, read: canRead, write: canWrite, writeCategories: cats, basis: CAPS.LAB_RESULT };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...canRead])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...canWrite])],
      writeCategories: mergeCats(grant.writeCategories, cats),
      basis: grant.basis + "+" + CAPS.LAB_RESULT,
    };
  }

  if (has(CAPS.ORDER_VERIFY)) {
    /* Pharmacy verification, 2026-09-07. The narrow grant this file's own comment (and the note in
     * api/queue/[[path]].js) said the problem wanted, rather than the two wrong answers available
     * before it existed:
     *
     *   - MED_ADMINISTER would have let pharmacy write MedicationAdministration, and a role that can
     *     write that can post a fabricated "administered" row through the raw record API without
     *     ever going near a bedside.
     *   - EMR_VIEW would have handed the pharmacy role the WHOLE chart to solve a problem that needs
     *     four resource types.
     *
     * So: read exactly what verifying a medicine against a patient requires - the orders, the
     * allergies, the observations that carry renal function and drug levels, and the problem list
     * that says why - and write ONLY the verification itself. It is a union, so it can never narrow
     * what a role already had. */
    // MedicationVerification is on BOTH lists: a verifier who cannot read back what was already
    // verified cannot see their own queue, and would re-check every order on every shift.
    /* MedicationDispense joined the write list on 2026-09-07, and MedicationAdministration
     * deliberately did NOT. Issuing stock to a ward is the pharmacy's own act and gets its own
     * resource; recording that a patient was given a dose is the nurse's, at a bedside. A role that
     * could write both could post a fabricated administration through the raw record API without
     * going near a patient. */
    const canRead = ["MedicationOrder", "ServiceRequest", "AllergyIntolerance", "Observation", "Condition", "MedicationAdministration", "CriticalResultLoop", "MedicationVerification", "MedicationDispense"];
    const canWrite = ["MedicationVerification", "MedicationDispense"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: canRead, write: canWrite, basis: CAPS.ORDER_VERIFY };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...canRead])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...canWrite])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.ORDER_VERIFY,
    };
  }

  if (has(CAPS.ORDER_DISPENSE)) {
    /* Stock control, 2026-09-08. Its own capability - "hand medicines to the patient + mark the
     * order dispensed" - rather than folded into ORDER_VERIFY, because counting the shelf is the
     * dispensing side of pharmacy and not the checking side, and a site that separates the two
     * should be able to.
     *
     * ONE TYPE, AND IT IS NOT CLINICAL. A StockMovement says a box arrived, was destroyed or was
     * recounted. It names no patient and this grant confers nothing towards one: MedicationDispense
     * is granted by ORDER_VERIFY above and is a supply fact against an ORDER, which is a different
     * thing that a different check governs. Reading MedicationDispense is how the level subtracts
     * what was issued, and pharmacy already holds that read. */
    const added = ["StockMovement"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: added, write: added, basis: CAPS.ORDER_DISPENSE };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...added])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.ORDER_DISPENSE,
    };
  }

  if (has(CAPS.MED_ADMINISTER)) {
    /* The bedside authority, added 2026-09-07 with the inpatient eMAR, in the same union shape as
     * QUEUE_ADD above and for the same reason: it only ever ADDS one type and only ever RAISES the
     * tier, so it cannot quietly widen or narrow what a role could already do.
     *
     * It grants MedicationAdministration and nothing else. That is the whole separation: a nurse
     * holding this can record that a dose was given, and still cannot write the MedicationOrder it
     * was given against - that needs EMR_TREAT. Order and administration stay two resources written
     * by two authorities, which is what makes "someone ordered it" and "someone gave it" different
     * claims in the record. */
    /* InfusionRate joins the bedside authority: charting what a pump is doing is the same act as
     * recording that a dose was given, by the same nurse, at the same bedside. It grants nothing
     * towards the ORDER - changing a rate is not re-prescribing. */
    const added = [ADMINISTRATION_TYPE, "InfusionRate"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: [...ORDER_TYPES, ADMINISTRATION_TYPE], write: added, basis: CAPS.MED_ADMINISTER };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...ORDER_TYPES, ADMINISTRATION_TYPE])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.MED_ADMINISTER,
    };
  }
  if (has(CAPS.BILLING_CHARGE) || has(CAPS.BILLING_VIEW)) {
    /* Billing, 2026-09-08. The grant IS the safety property that wardsynq-billing.js is built on.
     *
     * Its central rule is that the clinical record is the source and billing never writes to it -
     * a charge whose diagnosis appears nowhere in the chart is refused, because the cheapest way to
     * clear a queried code is to add the diagnosis. That rule is worth nothing as a promise in a
     * module header. Here it is structural: a coder holding BILLING_CHARGE and no EMR capability may
     * write Claim and PreAuthorisation and NOTHING ELSE, so the record service refuses the write
     * that would justify the charge. Removing the boundary means deliberately widening this list.
     *
     * READ IS THE PROBLEM LIST AND NOTHING MORE. Coding asks one question - is this diagnosis
     * written down - and answering it does not need the notes, the results or the drug chart. A
     * coder handed EMR_VIEW to solve this would have been given the whole chart for one question,
     * which is the same mistake ORDER_VERIFY above exists to avoid.
     *
     * BILLING_VIEW reads and writes nothing: the cashier sees the claims, and cannot code one. */
    /* CHARGE CAPTURE (2026-09-08) adds four types to the READ list and NOTHING to the write list,
     * which is the whole point. Billing what happened requires knowing what happened: the doses
     * given, the reports released, the samples taken and the medicine issued. Billing from ORDERS
     * instead would need none of this and would bill for doses the patient refused and tests nobody
     * performed - the patient receives that bill and has to argue with it.
     *
     * It is a real widening and is named as one: MedicationAdministration tells a coder every drug
     * a patient received. It is what charge capture IS, it is what a coder in any hospital sees, and
     * the containment is that the write scope below did not move. A site wanting tighter separation
     * should hold BILLING_CHARGE for coders and leave the cashier on BILLING_VIEW. */
    const CAPTURE_TYPES = ["MedicationAdministration", "DiagnosticReport", "SpecimenCollection", "MedicationDispense"];
    // Invoice joined 2026-09-09 (TASK 4.6): the ledger charge-capture.js's priced proposal becomes
    // once a person raises it. Read for BOTH billing.view and billing.charge - a cashier reading a
    // balance is not a coding act, it is the whole reason billing.view exists (see the Cashier task
    // this grant is written to anticipate, TASK 4.7). Write is billing.charge only: raising an
    // invoice and posting a payment against it is the SAME financial-record authority as coding a
    // claim, not a clinical one.
    const canRead = has(CAPS.BILLING_CHARGE)
      ? ["Condition", "Claim", "PreAuthorisation", "Invoice", ...CAPTURE_TYPES]
      : ["Claim", "PreAuthorisation", "Invoice"];
    const canWrite = has(CAPS.BILLING_CHARGE) ? ["Claim", "PreAuthorisation", "Invoice"] : [];
    if (!grant) grant = { tier: canWrite.length ? TIER.EXECUTE : TIER.READ, read: canRead, write: canWrite, basis: has(CAPS.BILLING_CHARGE) ? CAPS.BILLING_CHARGE : CAPS.BILLING_VIEW };
    else grant = {
      // Raised, never lowered - the same union rule as every branch above. A cashier who also holds
      // EMR_VIEW lands on TIER.READ, and leaving her there would have given her a write scope she
      // could not use: the list would read as a grant and behave as a refusal.
      tier: canWrite.length ? TIER.EXECUTE : grant.tier,
      read: grant.read === null ? null : [...new Set([...grant.read, ...canRead])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...canWrite])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + (has(CAPS.BILLING_CHARGE) ? CAPS.BILLING_CHARGE : CAPS.BILLING_VIEW),
    };
  }

  /* TASK 4.9 (HIM/ROI), 2026-09-09, NARROWED by TASK 4.13, 2026-09-09. staff.admin was considered
   * and rejected then, for the same reason it is still rejected: `hr` holds staff.admin and this
   * file's own test suite guarantees "HR: a hospital member with no business on the chart" -
   * widening staff.admin here would silently break that guarantee for a capability whose job is
   * staff->role management, not records custody. HIM_ROI is a NEW, narrow capability instead,
   * granted to nobody by default and to the new `him` role alone (functions/_queue_roles.js) - `hr`
   * does not hold it and gains nothing from this branch.
   *
   * WRITE IS ROIRequest ONLY. A HIM officer decides and records a release; this grant confers no
   * power to write a clinical note, an order or anything else - releasing a record is not treating
   * a patient. READ comes from the SAME role also holding EMR_VIEW (see the `him` role definition) -
   * this branch does not itself widen read, because "may release records" and "may read the chart
   * to decide what to release" are two different authorities the role composes explicitly, not one
   * this branch assumes. The route-level gate (functions/api/queue/[[path]].js) still requires
   * staff.admin OR him.roi as an alternative org-authorization check, so both layers must agree. */
  if (has(CAPS.HIM_ROI)) {
    const added = ["ROIRequest"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: added, write: added, basis: CAPS.HIM_ROI };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...added])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.HIM_ROI,
    };
  }

  /* TASK 4.13. migrate-transfusion.js's own header states this exact gap: "role separation between
   * blood-bank crossmatch/issue authority and ward-side bedside/administration authority is NOT
   * implemented... every route is gated on the same emr.treat capability every other clinical-
   * commitment resource uses." TRANSFUSION_ISSUE is that separation - a narrow authority over
   * TransfusionEpisode alone, plus enough read (Patient, Encounter) to identify whose episode it is,
   * granted to the new `blood_bank` role. EMR_TREAT still reaches TransfusionEpisode too (it is
   * unrestricted, unchanged) - this is an ALTERNATIVE authority for a role that should hold nothing
   * else clinical, never a narrowing of what a doctor can already do. */
  if (has(CAPS.TRANSFUSION_ISSUE)) {
    const added = ["TransfusionEpisode"];
    const canRead = [...added, "Patient", "Encounter"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: canRead, write: added, basis: CAPS.TRANSFUSION_ISSUE };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...canRead])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.TRANSFUSION_ISSUE,
    };
  }

  /* TASK 4.15. Declaring/deactivating EmergencyActivation is its own narrow authority - see
   * emergency-mode.js's own header for why this grants nothing beyond the declaration record
   * itself: EMERGENCY_DECLARE is a governance capability, not a clinical one, and reading/writing
   * this ONE type is all it ever confers. Admin already holds EMR_TREAT (unrestricted) so this adds
   * nothing new for that role in practice - it exists for a site that wants to grant emergency
   * declaration WITHOUT full clinical treat authority, the same reasoning TRANSFUSION_ISSUE/HIM_ROI
   * already establish. */
  if (has(CAPS.EMERGENCY_DECLARE)) {
    const added = ["EmergencyActivation"];
    if (!grant) grant = { tier: TIER.EXECUTE, read: added, write: added, basis: CAPS.EMERGENCY_DECLARE };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...added])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + CAPS.EMERGENCY_DECLARE,
    };
  }

  /* TASK 5.14. Filing (INCIDENT_REPORT) and investigating (INCIDENT_INVESTIGATE) are DISTINCT
   * capabilities in _queue_roles.js - see incidents.js's own header for why - but both resolve to
   * the SAME resource-type scope here: which lifecycle action a request may actually perform
   * (report vs triage/RCA/CAPA/close) is enforced at the route, exactly as EMERGENCY_DECLARE's
   * declare/deactivate both resolve to one EmergencyActivation scope above. A role holding either
   * capability can read and write IncidentReport; a role holding neither cannot reach it at all. */
  if (has(CAPS.INCIDENT_REPORT) || has(CAPS.INCIDENT_INVESTIGATE)) {
    const added = ["IncidentReport"];
    const basis = has(CAPS.INCIDENT_INVESTIGATE) ? CAPS.INCIDENT_INVESTIGATE : CAPS.INCIDENT_REPORT;
    if (!grant) grant = { tier: TIER.EXECUTE, read: added, write: added, basis };
    else grant = {
      tier: TIER.EXECUTE,
      read: grant.read === null ? null : [...new Set([...grant.read, ...added])],
      write: grant.write === null ? null : [...new Set([...grant.write, ...added])],
      writeCategories: grant.writeCategories,
      basis: grant.basis + "+" + basis,
    };
  }

  /* An unconstrained write scope cannot be partly constrained. A role that ends up with `write: null`
   * may write every type, and leaving a category allow-list attached to that would refuse the one
   * type it names while permitting every other - a rule that reads as tighter and behaves as
   * nonsense. This is the doctor who is also on the lab rota. */
  // Always present, so a caller reading the grant never has to tell "no constraint" from "this
  // branch forgot to set the field".
  if (grant) grant = { ...grant, writeCategories: grant.write === null ? null : (grant.writeCategories || null) };
  return grant;
}

/** PURE. The grant for one of the eighteen operational roles. */
function grantForRole(role) {
  if (!isRole(role)) return null;
  return grantForCaps(capsFor(role));
}

/** The whole mapping, for a console or a test to print. */
function roleMapping() {
  const out = {};
  for (const role of ROLES) out[role] = grantForRole(role);
  return out;
}

/**
 * PURE. Builds the human actor for an OPD role. `claims` are the verified Firebase custom claims;
 * `regNo` is the prescriber registration the prescription route already relies on, and it is the
 * only source of a signing credential. A staff PIN session carries none, so a doctor who signed in
 * with a PIN can write and cannot sign, and the record will say so.
 */
function actorFromOpdRole({ identity, role, claims, memberRegNo }) {
  claims = claims || {};
  if (!identity || !identity.id) return null;
  const grant = grantForRole(role);
  if (!grant) return null;
  /* TWO SOURCES, AND THE RECORD KEEPS WHICH. The platform's verified claim is the stronger one and
   * wins whenever it is present. Failing that, the hospital's own staff registry (q_members.regNo,
   * settable only by an admin) - because a doctor signing in the way hospital staff actually sign
   * in carries no claims at all, and before this could write the chart but never sign a single
   * prescription, note or discharge summary. Neither: no credential, and the store refuses the
   * signature exactly as it always did. */
  const platform = claims.regNo ? String(claims.regNo) : "";
  const hospital = memberRegNo ? String(memberRegNo) : "";
  const credential = platform || hospital || null;
  return makeActor({
    id: identity.id, kind: KIND.HUMAN, tier: grant.tier,
    display: claims.name || identity.name || identity.email || identity.id,
    credential,
    credentialSource: credential ? (platform ? "platform-verified" : "hospital-asserted") : null,
    scope: { read: grant.read, write: grant.write, writeCategories: grant.writeCategories || null },
  });
}

/**
 * PURE. The Connect membership roles, unchanged from the first cut of the service: clinician is a
 * doctor, super-admin may look and not write, everybody else gets no chart.
 */
function actorFromConnectRole({ identity, role, claims }) {
  claims = claims || {};
  if (!identity || !identity.id) return null;
  const display = claims.name || identity.name || identity.email || identity.id;
  if (role === "clinician") {
    return makeActor({ id: identity.id, kind: KIND.HUMAN, tier: TIER.EXECUTE, display, credential: claims.regNo ? String(claims.regNo) : null });
  }
  if (role === "superadmin") {
    return makeActor({ id: identity.id, kind: KIND.HUMAN, tier: TIER.READ, display, scope: { read: null, write: [] } });
  }
  return null;
}

/**
 * PURE. The AI actor for a draft made in a human's session. Its kind caps it at DRAFT whatever is
 * asked; its write scope is the human's, never wider; and it names the human as the delegate.
 * A human who may write nothing delegates nothing: the AI gets an empty write scope and every
 * write it attempts is SCOPE_DENIED, recorded as such.
 */
function aiActorFor(human, origin) {
  origin = origin || {};
  if (!human || human.kind !== KIND.HUMAN) throw new PermissionError("an AI draft needs a human session to act in");
  const name = String(origin.id || origin.name || "maik").replace(/[^A-Za-z0-9._:-]/g, "").slice(0, 64) || "maik";
  return makeActor({
    id: `ai:${name}`, kind: KIND.AI, tier: TIER.DRAFT,
    display: origin.display || `${name} (AI, drafting for ${human.display})`,
    /* The category constraint is inherited with the rest. Copying only the type lists would have
     * made the AI WIDER than the human it drafts for - drafting a laboratory result for a nurse who
     * may not write one. "No wider than the human" is the whole rule this scope exists to keep. */
    scope: {
      read: human.scope.read,
      write: actorCan(human, TIER.DRAFT) ? human.scope.write : [],
      writeCategories: actorCan(human, TIER.DRAFT) ? human.scope.writeCategories : null,
    },
    onBehalfOf: human.id,
  });
}

/** True when a write should be attributed to an AI rather than to the session's human. */
function isAiOrigin(entity, origin) {
  if (origin && typeof origin === "object" && origin.kind === "ai") return true;
  return !!(entity && entity.aiDrafted === true);
}

/* ------------------------------------------------------------------ identity */

const staffEnabled = (env) => !!(env && env.QUEUE_STAFF_ENABLED === "1");

/**
 * Who is calling. Firebase / Cloudflare Access first (the doctor app, a hospital PC behind Access),
 * then a StewardMD-native staff session (the nurse's or receptionist's email+PIN login, minted
 * org-bound by _opd_auth.js) when the deployment has staff sign-in on. A session proves identity
 * only; authority is decided below, from membership, as everywhere else in the product.
 */
/* TASK 4.14: a session reference for the audit trail - never the raw token, a short hash of it,
 * so two requests on the same staff login correlate without the audit event ever holding a bearer
 * credential. Firebase identities have no per-session token surfaced this far in, so sessionRef is
 * null for them - stated honestly as "not available", never fabricated. */
async function sessionRefOf(tok) {
  if (!tok || !crypto.subtle) return null;
  const bytes = new TextEncoder().encode(tok);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function resolveIdentity(request, env, deps) {
  const who = await deps.identifyFn(request, env);
  if (who && !who.guest && who.id) {
    return { kind: "firebase", id: who.id, email: who.email ? String(who.email).toLowerCase() : null, name: who.name || null, orgId: null, sessionRef: null };
  }
  if (staffEnabled(env) && deps.staffSession) {
    const tok = request.headers.get("X-Staff-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (tok) {
      const ss = await deps.staffSession(env, tok, Date.now());
      if (ss && ss.identity && ss.orgId) return { kind: "staff", id: String(ss.identity), email: null, name: String(ss.identity), orgId: String(ss.orgId), sessionRef: await sessionRefOf(tok) };
    }
  }
  throw new AuthError("authenticated actor required");
}

/* TASK 4.14 (Audit/Financial Integrity): the plan's own minimum-audit list names "correlation ID"
 * and "source/device/session" as required fields; this codebase's audit event (service.js's
 * _audit()) already fully covers actor/action/object/before-after/timestamp/tenant - these three
 * did not exist anywhere. Computed ONCE per request, here, at the one place every write and read
 * already passes through - not threaded through the twenty-odd per-file open() helpers, which would
 * have meant editing every bridge file for three fields three of them do not otherwise need to know
 * about. Folded into the audit event's existing free-form `scope` blob in service.js's _audit()
 * (see there) rather than a new column - `connect_audit_event` is a live, shared table with ABDM,
 * and a schema migration for three optional fields is a bigger, riskier change than this task's own
 * "smallest set of new code" instruction, when the existing scope blob already carries exactly this
 * kind of metadata for free. */
function requestContextOf(request, identity) {
  return {
    correlationId: request.headers.get("X-Correlation-Id") || (crypto.randomUUID ? crypto.randomUUID() : null),
    deviceId: request.headers.get("X-Device-Id") || null,
    sessionId: (identity && identity.sessionRef) || null,
  };
}

/**
 * The path. Returns { identity, tenant, role, source, grant, actor } or throws AuthError /
 * PermissionError. `need` is "record:read" | "record:write" and applies to the Connect branch, where
 * the RBAC matrix is the capability list; on the OPD branch the capabilities are the role's own.
 *
 * deps: { db, identifyFn, claimsFn?, staffSession?, orgForTenant, authorizeOrg }
 */
async function resolveClinicalActor(request, env, tenantId, need, deps) {
  deps = deps || {};
  if (!deps.db) throw new PermissionError("record service is not provisioned");
  const identity = await resolveIdentity(request, env, deps);
  const claims = deps.claimsFn && identity.kind === "firebase" ? (await deps.claimsFn(request, env)) || {} : {};

  // The tenant row is the record's key and must exist, whoever is asking.
  const tenant = await deps.db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(String(tenantId)).first();
  if (!tenant) throw new PermissionError("tenant not found");

  // 1. The hospital's own staff registry, when this tenant has one.
  const org = deps.orgForTenant ? await deps.orgForTenant(env, tenant) : null;
  if (org) {
    // A staff session is org-bound; authorizeOrg refuses a mismatch itself, but a session for
    // another organisation must not even be looked up against this one.
    if (identity.kind === "staff" && identity.orgId !== String(org.id)) throw new PermissionError("staff session is for another organisation");
    const az = await deps.authorizeOrg(env, { kind: identity.kind, id: identity.id, email: identity.email, orgId: identity.orgId }, org.id, null);
    if (az && az.ok) {
      const grant = grantForRole(az.role);
      if (!grant) throw new PermissionError(`role '${az.role}' has no clinical actor`);
      const actor = actorFromOpdRole({ identity, role: az.role, claims, memberRegNo: az.regNo });
      if (need === "record:write" && !actorCan(actor, TIER.DRAFT)) throw new PermissionError(`role '${az.role}' may not write the clinical record`);
      // actorFromOpdRole's object is frozen, like every actor this file hands out - a new object
      // carries the request context rather than mutating a frozen one.
      return { identity, tenant, role: az.role, source: "opd", org: { id: org.id, name: org.name || null }, grant, actor: { ...actor, requestContext: requestContextOf(request, identity) } };
    }
    // Not a member of the linked organisation. Fall through: a Connect clinician may still be one.
  }
  if (identity.kind === "staff") throw new PermissionError("staff session is not a member of this organisation");

  // 2. Connect membership (or the platform super-admin allow-list), as before.
  let membership;
  try { membership = await resolveTenant(deps.db, { id: identity.id, email: identity.email }, tenantId, env); }
  catch (e) { if (e instanceof PermissionError) throw new PermissionError("not a member of this tenant"); throw e; }
  if (!connectCan(membership.role, need)) throw new PermissionError(`role '${membership.role}' may not perform '${need}'`);
  const actor = actorFromConnectRole({ identity, role: membership.role, claims });
  if (!actor) throw new PermissionError(`role '${membership.role}' has no clinical actor`);
  const actorWithContext = { ...actor, requestContext: requestContextOf(request, identity) };
  return { identity, tenant: membership.tenant, role: membership.role, source: "connect", org: null, grant: { tier: actor.tier, read: actor.scope.read, write: actor.scope.write, basis: "connect:" + membership.role }, actor: actorWithContext };
}

export {
  RESOURCE_TYPES, ORDER_TYPES, VITALS_TYPES,
  grantForCaps, grantForRole, roleMapping,
  actorFromOpdRole, actorFromConnectRole, aiActorFor, isAiOrigin,
  resolveIdentity, resolveClinicalActor,
  sessionRefOf, requestContextOf,
};
