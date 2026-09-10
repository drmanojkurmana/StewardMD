/* functions/_wardsynq/service.js — the WardSynQ Clinical Record Service.
 *
 * This is the authoritative clinical record when WardSynQ is a hospital's EMR. It is the SAME
 * ClinicalStore and the SAME GovernedStore that run in the browser today, instantiated here on the
 * server per request, over a persistence port instead of IndexedDB. No clinical logic is
 * re-implemented in this file: versioning, append-only history, provenance stamping and the actor
 * ceilings all come from wardsynq/ unchanged. What this file adds is exactly what a device-local
 * store cannot have:
 *
 *   TENANCY       every read and write is scoped to one hospital, decided from membership, never
 *                 from the request body
 *   IDENTITY      the actor is derived from the verified token and the membership role; a client's
 *                 claim about who it is does not survive the door
 *   CONCURRENCY   a write states the version it was derived from; a stale one is refused with the
 *                 current record, never merged silently. The repository's unique key backs this up
 *                 for the race the check cannot see.
 *   IDEMPOTENCY   a retried write replays its original outcome instead of producing version N+2
 *   AUDIT         every read and write of clinical content leaves a PHI-free row in the existing
 *                 Connect audit trail, in the same atomic batch as the write it describes
 *   AUTHORITY     in integration mode an external EMR owns what it owns: a record whose latest
 *                 version came from another system is not overwritten through the native door
 *
 * TWO MODES, ONE CONTRACT. A tenant runs as SYSTEM-OF-RECORD (WardSynQ owns the record) or in
 * INTEGRATION (an external EMR is authoritative for the data it owns and reaches WardSynQ through
 * the connectors). Both modes use this service, this model and this store. The mode only changes
 * which writes the native door accepts; it does not change what a record is.
 *
 * STATUS: IMPLEMENTED. Not clinically validated, not clinically approved, and the deployment modes
 * other than Cloudflare D1 are a port contract, not an implementation.
 */

import { ClinicalStore } from "../../wardsynq/wardsynq-store.js";
import { GovernedStore, GovernanceError, canRead } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError, assertRepository } from "./repository.js";
import { patientIdentifierKeys } from "./identity-key.js";
import { actorFromConnectRole, aiActorFor, isAiOrigin } from "./actor.js";

/** The canonical resource types. Mirrors wardsynq-model.js; a type not listed here is refused. */
const RESOURCE_TYPES = Object.freeze([
  "Patient", "Encounter", "Condition", "AllergyIntolerance", "Observation",
  "MedicationOrder", "MedicationAdministration", "ServiceRequest", "DiagnosticReport",
  "CarePlan", "ClinicalNote",
  /* The critical-result loop. NOT a clinical finding and deliberately not modelled as one: there is
   * no FHIR type for "a named human must look at this", and dressing a workflow fact up as a
   * clinical resource would put a process artefact where a reader expects a diagnosis. It lives
   * here so it is versioned and append-only like everything else, which is what makes an
   * acknowledgement impossible to edit away afterwards.
   *
   * No grant change accompanies this: EMR_TREAT already carries unrestricted write and EMR_VIEW
   * unrestricted read, so a doctor can acknowledge and a nurse can see the list, which is the
   * policy wanted. A nurse's write scope is enumerated and does not include this type. */
  "CriticalResultLoop",
  /* The shift handover. Also not a clinical finding, and deliberately not a ClinicalNote: that is a
   * clinical DOCUMENT, and a nurse's write scope rightly excludes one. Widening that scope so a
   * handover could be written would have let a nurse author a discharge summary too. Its own type,
   * granted narrowly by EMR_VITALS - what the nurse records about their own patients. */
  "ShiftHandover",
  /* Pharmacy verification of an ORDER. Emphatically not a MedicationAdministration: granting
   * pharmacy write on that would let the role post a fabricated "administered" row through the raw
   * record API without going near a bedside. Its own type, granted only by ORDER_VERIFY. */
  "MedicationVerification",
  /* A break-glass declaration. The record OF an emergency access, not a clinical fact - and it is
   * stored here precisely so it is append-only: a break-glass grant somebody could delete afterwards
   * would defeat the entire mechanism, whose only value is being legible later. */
  "BreakGlassGrant",
  /* TASK 4.15: a hospital-wide emergency declaration - mass casualty, disaster, evacuation, surge,
   * network outage. The same reasoning as BreakGlassGrant, at hospital scale: the record OF the
   * declaration, append-only, never the source of any capability itself. Nothing in actor.js's
   * grant logic reads this type; declaring one widens no role's read/write scope automatically -
   * see emergency-mode.js's own header for why "do not create an unrestricted admin bypass" means
   * this file grants nothing by existing. */
  "EmergencyActivation",
  /* Medicines reconciliation. A record of DECISIONS about medicines taken before admission - not a
   * prescription and deliberately not modelled as one: deciding to continue a home medicine records
   * the decision, and the inpatient order is still written through the ordering path with its own
   * authority and its own safety checks. */
  "MedicationReconciliation",
  /* A patient identity link. A merge is a CLAIM that two records are one person, and it is stored
   * as its own record precisely so it moves nothing: the two Patient records and every clinical row
   * under them stay exactly as they are, which is what makes the claim retractable. */
  "PatientLink",
  /* A recorded CDSS override. The safety engine always required a reason to clear a warning and then
   * discarded it, so nothing could answer which rules were being clicked through. Stored so a rule
   * pack can be told; never aggregated by clinician. */
  "SafetyOverride",
  /* Which overridable rules fired on one order evaluation. The DENOMINATOR: an override count with
   * no firing count is a fact about how busy the ward was, not about the rule. Kept as its own
   * append-only fact rather than a counter, because a counter loses one of two concurrent orders and
   * a lost firing silently lowers a rule's override rate - the direction that hides a bad rule. */
  "SafetyFiring",
  /* The pharmacy issued stock against an order. A SUPPLY fact and never a clinical one: it says
   * medicine left the pharmacy, not that a patient received anything. Kept apart from
   * MedicationAdministration on purpose - a system where "dispensed" can drift into "given" puts
   * doses on charts that nobody administered. */
  "MedicationDispense",
  /* A sample somebody actually took, between the order and the result. Without it an order nobody
   * collected looks exactly like one awaiting a result - both are "requested, no result yet" - and
   * only one of them has a nurse who still has to go and do something. */
  "SpecimenCollection",
  /* A patient promised a bed. A waiting-list entry and NEVER a bed reservation: reserving a bed for
   * somebody who is not in it makes the board show full while beds stand empty, and a ward that
   * cannot trust the board stops reading it. */
  "AdmissionRequest",
  /* A wound, assessed over time. Its worst stage is carried forward and never lowered, and where it
   * came from is set at the first assessment - a system that let either fall is one where a hospital
   * stops having pressure ulcers. */
  "WoundAssessment",
  /* A room, a theatre or a scanner, booked. Unlike a clinician's diary this one CANNOT be
   * overbooked: two patients do not fit inside one CT scanner, and a diary that says they do is
   * worse than no diary because the ward acts on it. */
  "ResourceBooking",
  /* A change in an infusion's rate. The VOLUME is integrated from these and never stored, because a
   * stored total stops being true the moment the pump changes - and an infusion that stops being
   * charted is uncharted, not stopped. */
  "InfusionRate",
  /* That a value was DECISIVE for a named person at a time. Not a view log: a page rendering a
   * hundred numbers has not shown a clinician a hundred numbers. It exists so that when a figure is
   * later found to be wrong there is a list of people to tell - HAZ-FLUID-01's missing half. */
  "ClinicalRead",
  /* A record that an order set was applied, and exactly what landed and what did not. NOT the orders
   * themselves - those go through the ordinary path and are ordinary orders. This is what makes a
   * partial application visible, and what finds the patients a bad set touched. */
  "OrderSetApplication",
  /* What the patient agreed to, and what they REFUSED - which is a clinical fact, not an absent
   * consent. Append-only so a withdrawal keeps the original grant: "they consented and later
   * withdrew" and "they never consented" are different histories and only one is true. */
  "PatientConsent",
  /* The diary. An Appointment holds a slot; an AppointmentRequest is a follow-up somebody PROMISED
   * and which stays visibly outstanding until a human books it - auto-booking would make the
   * promise look kept when nobody had spoken to the patient. */
  "Appointment", "AppointmentRequest",
  // TASK 4.5: a clinician/resource is deliberately unavailable for a whole period (leave, a theatre
  // closure) - a REFUSAL, never an override, unlike an appointment clash which a human may
  // deliberately overbook. See blackout.js's own header for why this is never the same record as
  // an Appointment/ResourceBooking clash.
  "Blackout",
  /* A scored nursing risk assessment. The score selects the ACTIONS, which are the only part that
   * changes anything for the patient - so the actions and what was done about them live on the
   * record beside the number. */
  "RiskAssessment",
  /* Sending a prescription somewhere, and knowing whether it arrived. A DELIVERY fact, never a
   * clinical one: nothing here touches the MedicationOrder, because "we sent this" is a statement
   * about a message, not about the treatment. */
  "PrescriptionTransmission",
  /* A coded claim. Stored here for one reason: append-only. The whole safety property of
   * wardsynq-billing.js is that a claim's coding history survives - "we found more documentation"
   * after a denial is the commonest shape of real upcoding, and a claim whose earlier coding could
   * be edited away would make it invisible. It is a financial record and never a clinical one:
   * nothing reads a Claim to decide anything about a patient. */
  "Claim",
  /* A payer's funding decision. Its own type precisely so it can never be mistaken for a clinical
   * one - a refused pre-auth means the payer will not pay, and it does not mean the treatment is
   * not indicated. Kept apart from the chart so nothing clinical can ever read it as an answer. */
  "PreAuthorisation",
  /* TASK 4.6: the charge-to-reconciliation ledger. Every discount/deposit/payment/refund/
   * adjustment/write-off is an append to the SAME invoice record, never a mutation of its charge
   * lines - "what was billed" and "what happened to the bill since" are different facts. A
   * financial record, like Claim/PreAuthorisation, and never read to decide anything clinical. */
  "Invoice",
  /* TASK 4.9: a third-party request for a copy of a patient's record (HIM/ROI), distinct from the
   * patient's own copy (PatientCopy is a receipt of a bedside handout; this is a tracked
   * authorization + disclosure log for an attorney/other-provider/insurer/government-agency
   * request). Append-only, one version per phase transition, the disclosure log counts what was
   * sent and never re-stores the values. */
  "ROIRequest",
  /* That a patient was given their own copy of the record, by a named clinician, at a time. A
   * RECEIPT and never a copy: it holds which results went and how many diagnoses, and none of their
   * values - a frozen second copy of clinical data that no correction ever reaches is a liability,
   * not a record. Append-only, because "you were given this" is exactly the claim that has to
   * survive somebody wishing it had not been. */
  "PatientRecordRelease",
  /* That a backup run finished, and what sequence it covered. A RECEIPT written by the caller, never
   * inferred from the export pages: a caller that stopped halfway holds a file that verifies and is
   * short, and only the caller knows whether it actually stored the last page. Kept in the record
   * itself so the recovery point is answerable from the same store a restore would rebuild. */
  "BackupRun",
  /* A pharmacy stock movement. The LEVEL is summed from these and never stored as a counter, because
   * a counter loses one of two concurrent updates and the direction it loses in is the one that says
   * there is more stock than there is. Issues are deliberately NOT movements: the quantity that left
   * the pharmacy is already a MedicationDispense, and two entries for one event can disagree. */
  "StockMovement",
  /* A patient's own access to their own record: who enrolled them, how they were identified, and the
   * DIGESTS of the code and session token - never the secrets themselves, because a grant readable
   * by staff must not be a way to become the patient. Append-only so a revocation cannot be deleted
   * afterwards, which is the only thing that makes revocation mean anything. */
  "PatientAccessGrant",
  /* A message a patient sent to their care team. It carries the warning they were shown at the
   * moment they sent it, stamped on the row: anybody reading this later - a clinician, an
   * investigator - needs to know what the patient had been told about the channel. Nothing
   * auto-replies to one, and a reply is written by a clinician's own actor. */
  "PatientMessage",
  /* What will actually be done in the scanner. Its own type because protocolling is the point where
   * an imaging REQUEST becomes a drug administration - the contrast decision - and that decision has
   * a different author, a different moment and different evidence from the request itself. Kept
   * against the request VERSION, so a later change to the request cannot make it look as though the
   * protocol was decided for a study nobody protocolled. */
  "ImagingProtocol",
  /* TASK 7.7: that a study EXISTS in a PACS, and what it is. Metadata only and deliberately so -
   * there is no url, no instance list and no pixel data on the row, because a field holding a
   * retrieve URL becomes the thing every viewer, cache and log copies a patient's images through.
   * What the chart needs is that the scan happened, when, of what, and the accession number that
   * finds it in the viewer the radiologist already has. Its value is the ORDER LINK: matched to the
   * ServiceRequest sharing its accession number, so a request and its scan stop being two unrelated
   * rows. Before this, imaging studies reaching the SCCM adapter were counted and DROPPED. */
  "ImagingStudy",
  /* Something another system sent that WardSynQ would not write silently: a patient who might be
   * one of two people here, a probable duplicate, a record that would overwrite one this hospital
   * authored, a resource type nothing maps. Held HERE, with the payload, rather than dropped or
   * guessed at - because the failure mode of every interface is the message that vanished and the
   * clinician who never knew it had been sent. Append-only, and resolved by a person. */
  "ExchangeException",
  "ExchangeMessage",
  /* A person's decision that a patient in ANOTHER system is (or is not) a patient here. Recorded
   * once, by name, and consulted before any probabilistic matching on every later message from that
   * system for that patient - so the same look-alike is not held and decided again, and so the
   * decision is on the record if it turns out to be wrong. Never made by software. */
  "ExchangeIdentityDecision",
  /* A SMART on FHIR grant: an authorization code, an access token, or a presented assertion id -
   * each as a DIGEST, never the secret. Looked up by the digest of what the client presents, so a
   * stolen table cannot be replayed as a token. Expiry is the record's, revocation is a new version
   * that cannot be deleted, and every one names the person or system it acts as. */
  "SmartGrant",
  /* A time-critical resuscitation bundle (Code Sepsis / Code Blue / Code STEMI), the persisted state
   * of wardsynq-emergency.js's EmergencyBundle. Its own type, not a CarePlan: a CarePlan is a plan a
   * clinician wrote, and a bundle's elements, targets and time zero are the hospital's SEEDED,
   * UNAPPROVED protocol content, never invented by a clinician on the screen. No grant change
   * accompanies this: EMR_TREAT's unrestricted write already covers starting/marking a bundle (a
   * "clinical commitment", per that file's own words - never started by a screen result alone), and
   * EMR_VIEW's unrestricted read covers seeing one running. */
  "ResusBundle",
  /* A patient-device binding (HAZ-DEV-01, Task 2.2), the persisted state of wardsynq-iomt.js's
   * DeviceGateway - keyed by deviceId, one open association at a time. Its own type, not folded
   * into Observation: the association is the CLAIM that a monitor belongs to a patient, and the
   * device readings it authorises are Observations in their own right, written separately, exactly
   * like ResusBundle's elements are distinct from the bundle that governs them. Granted by
   * EMR_VITALS (VITALS_TYPES in actor.js) - scanning a wristband and a device tag onto a patient is
   * the nurse's own bedside act, the same authority as charting a vital. */
  "DeviceAssociation",
  /* The WHO Surgical Safety Checklist gate, the persisted state of wardsynq-surgical.js's
   * SurgicalCase (Task 2.3). Its own type, not a CarePlan or a ClinicalNote: the checklist state,
   * signatures and laterality chain are a safety-gate ledger, not a plan or a document. No grant
   * change accompanies this: EMR_TREAT's unrestricted write already covers booking/checklisting a
   * case (the same "clinical commitment" reasoning ResusBundle's own comment gives), and EMR_VIEW's
   * unrestricted read covers seeing one. */
  "SurgicalCase",
  /* An anaesthesia record for one surgical case: induction/maintenance/emergence and the drugs
   * actually given. Not a MedicationAdministration - those are for ordered ward medicines going
   * through the five-rights eMAR; an anaesthetic is given directly by the anaesthetist inside a
   * theatre already gated by the checklist above, a different authority and a different record. */
  "AnesthesiaRecord",
  /* Implant/prosthesis traceability (device, lot, serial, site) - explicitly absent before Task 2.3
   * (wardsynq-surgical.js's own header names it as not modelled). A recall notice is only actionable
   * against a hospital that can answer "which patients got lot X", so this is append-only and keyed
   * to the case it was placed in. */
  "ImplantRecord",
  /* Antenatal history and gestation (Task 2.4): gravida, para, LMP/EDD, risk factors. One current
   * episode per patient, versioned like everything else - a delivery is the fact that changes para,
   * recorded through migrate-maternity.js's recordDelivery(), never edited by hand elsewhere. */
  "PregnancyEpisode",
  /* What actually happened at delivery: mode, when, complications. Its own type, not a ClinicalNote -
   * a delivery is a discrete clinical EVENT with a machine-readable mode, not free prose, and it is
   * what maternityView() reads to resolve the real wardsynq-obstetrics.js obstetricState() (the
   * postpartum/puerperium window) from the actual record rather than a caller's claim. */
  "DeliveryRecord",
  /* Blood loss, obstetric. Its own type because pphThresholdReached()'s quantitative-vs-visual
   * distinction (wardsynq-obstetrics.js) is load-bearing: an Observation of value+unit alone loses
   * the "how was this established" fact a PPH threshold decision refuses to answer without. */
  "BloodLossRecord",
  /* A clinical relationship between two DIFFERENT patients - mother and newborn, first user (Task
   * 2.4). Never PatientLink: that type asserts "these two records are one person", which is exactly
   * the wrong claim for two people. No grant change accompanies any of the four types above:
   * EMR_TREAT's unrestricted write already covers them (the same "clinical commitment" reasoning
   * ResusBundle and SurgicalCase's own comments already give), and EMR_VIEW's unrestricted read
   * covers seeing one. */
  "FamilyLink",
  /* A line, catheter or drain: site, type, when placed, when removed (Task 2.5). A placement log,
   * not a protocol - it carries no judgement about when a line is indicated or how to care for it,
   * the same restraint migrate-surgery.js's ImplantRecord already keeps for a prosthesis. No grant
   * change accompanies this: EMR_TREAT's unrestricted write already covers it, matching
   * ImplantRecord's own precedent - placing a line is a clinical commitment, not routine charting. */
  "LineRecord",
  /* The ONCqis bridge (Task 2.6). ONCqis (onco-*.js, functions/_onco_store.js) is a separate,
   * owner-approved production oncology product with its own plan/cycle store, scoped only by
   * hospitalId + a bare ghisPatientId - never linked to a canonical WardSynQ patient before this.
   * OncologyLink names that join; it duplicates none of ONCqis's own staging/dosing/protocol
   * content, only the identifying facts needed to resolve one system's plan against this record's
   * patient. No grant change accompanies any of the three types below: EMR_TREAT's unrestricted
   * write already covers them, the same "clinical commitment" reasoning ResusBundle/SurgicalCase/
   * DeliveryRecord already establish - and deliberately NOT the oncqis_* roles, which
   * functions/_wardsynq/actor.js still fences from every clinical capability; see that file's own
   * comment on this task before changing it. */
  "OncologyLink",
  /* A CTCAE-graded adverse event. The grade is asserted here, never computed - onco-ctcae.js's own
   * catalog and grading logic remain the sole authority for what a grade means. */
  "AdverseEventRecord",
  /* One cycle's chemotherapy administration, documented with the fields the audit for this task
   * found nowhere else carries: dose lineage (BSA), premedication sequence, a structured
   * extravasation field. It does not re-run wardsynq-meds.js's five-rights state machine - that
   * machine is reused unchanged, through the existing /ward/mar door, for the bedside act itself. */
  "ChemoAdministrationRecord",
  /* The KardiQ X bridge (Task 2.7). KardiQ X (kardiox*.js) is an AI ECG-photo interpreter -
   * self-declared "clinically unvalidated, regulatory-pending" (docs/ecg-engine-roadmap.md), unlike
   * ONCqis's owner-approved production status. Its ECG records are local-only, encrypted, with no
   * patientId and no server-side store at all - a genuinely disconnected record, the same failure
   * mode OncologyLink closes for ONCqis. CardiologyLink names the join; it asserts no clinical
   * identity beyond the caller-supplied identifying facts. No grant change: EMR_TREAT's unrestricted
   * write covers it, the same precedent as OncologyLink. */
  "CardiologyLink",
  /* A resolved ECG: the AI verdict/HEART-TIMI score KardiQ X already computed, referenced here, not
   * recomputed. Recorded with an explicit unvalidated:true provenance flag reflecting KardiQ X's own
   * regulatory status - never presented as a validated clinical finding. */
  "ECGReference",
  /* TASK 3.5: the blood-bank bridge into wardsynq-transfusion.js (HAZ-BLD-01, safety-case verified).
   * That module already implements ABO/RhD compatibility, crossmatch binding, and the two-person
   * bedside check - it has no persistence of its own. Every phase transition
   * (request/crossmatch/issue/bedside-check/start/observe/reaction/complete) is one version of ONE
   * TransfusionEpisode record, the same append-only shape test/wardsynq-transfusion.test.mjs already
   * proves against a bare store. No grant change: EMR_TREAT's unrestricted write covers it, the SAME
   * precedent as ResusBundle/SurgicalCase/DeliveryRecord - role separation between blood-bank
   * crossmatch/issue authority and ward-side bedside/administration authority is a real
   * authorization decision this task states explicitly rather than making unilaterally, the same
   * restraint migrate-oncology.js's header keeps about the oncqis_* role fence. */
  "TransfusionEpisode",
  /* TASK 5.14: a clinical incident, the persisted state of wardsynq-incidents.js's report/triage/
   * RCA/CAPA/close lifecycle. Its own type: an incident is a report ABOUT the system, not a
   * clinical fact about the patient it may name, and folding it into ClinicalNote would let a
   * role with note-write silently author or edit an investigation's own conclusions. Its own
   * capabilities (INCIDENT_REPORT to file, INCIDENT_INVESTIGATE to triage/RCA/CAPA/close) rather
   * than EMR_TREAT, so filing a report never requires - or implies - clinical treatment
   * authority, matching the "own authority" precedent ORDER_VERIFY/LAB_RESULT/TRANSFUSION_ISSUE
   * already set. Append-only, one version per lifecycle transition, so an investigation's earlier
   * conclusions cannot be edited away after the fact - the same property Claim's coding history
   * and TransfusionEpisode's traceability already depend on. */
  "IncidentReport",
  /* TASK 6.14: a wristband/QR/NFC tag's own lifecycle - the persisted state of
   * wardsynq-identity-tag.js's assign/verify/replace/deactivate/lost engine. Its own type, not a
   * field mutation on Patient: wristbandBarcode has been comparable since early in this build, but a
   * comparator that trusts whatever code is currently on the field is only as safe as the process
   * that put it there. Multiple records ACCUMULATE per patient (one per tag ever issued), never
   * overwritten - "which code named this patient, when, and what happened to the last one" is
   * exactly the chain a wrong-patient investigation needs and a mutated field cannot answer.
   * Granted by EMR_VITALS (VITALS_TYPES in actor.js), the same capability DeviceAssociation already
   * uses - scanning a wristband onto a patient is the same kind of bedside act. */
  "PatientTag",
  /* TASK 7 STEP 1: a durable, admin-issued authorization saying "actor X may push data claiming to
   * be source system Y". Closes a real vulnerability where any clinician holding emr.treat could
   * declare an X-Source-System header naming ANY registered partner and every downstream
   * ownership/provenance/MPI decision would believe it. Its own type, append-only like everything
   * else - who may claim which external identity is exactly the kind of fact that must never be
   * silently edited away. Granted no scope of its own: only `admin`'s pre-existing unrestricted
   * write reaches it, so issuing a grant stays an administrative act by construction, not by a
   * capability that could be widened by accident. See fhir-inbound.js's own header for the full
   * design. */
  "SourceSystemGrant",
  /* TASK 7.4: where this hospital may send, and what it has sent. Two types, both append-only.
   * OutboundDestination is the ALLOWLIST ITSELF - the only way a URL can be posted to is that an
   * administrator wrote it down here, so no request can ever talk this server into exfiltrating a
   * chart to an address of the caller's choosing. OutboundDelivery is the QUEUE: a delivery must
   * outlive the isolate that created it, or an outage loses a discharge summary, and its history of
   * attempts is the only honest answer to "did the other hospital actually receive it". Neither is
   * granted a clinical scope: like SourceSystemGrant, only `admin`'s unrestricted write reaches
   * them, so deciding where patient data leaves the building stays an administrative act by
   * construction. See fhir-outbound.js's header. */
  "OutboundDestination",
  "OutboundDelivery",
  /* TASK 8: one AI action, written down. Its own governed type because it is a fact ABOUT the record
   * rather than a clinical finding in it - what a model was asked, which model answered, which row
   * versions it was shown, what it said, and what a clinician then decided. A log line would have
   * needed tenant isolation, an append-only history, an audit row and the patient compartment all
   * inventing again; a record inherits them. Readable by exactly the people who may read the patient
   * it is about, which is why patientId is on it. See maik-interaction.js. */
  "MaiKInteraction",
  /* TASK 10.17: the same governed-AI-action discipline as MaiKInteraction, for a question about the
   * HOSPITAL rather than one patient's chart - no patientId, because there is no one patient. Readable
   * under the same hospital-wide EMR_VIEW capability every other operational aggregate already uses
   * (EMR_VIEW grants read:null, every type), never patient-compartmented since it carries no patient.
   * See twin-copilot.js. */
  "TwinInteraction",
]);

const MODE = Object.freeze({ SYSTEM_OF_RECORD: "system-of-record", INTEGRATION: "integration" });

/** Provenance value the model stamps on records WardSynQ itself originated. */
const NATIVE_SYSTEM = "wardsynq-native";

/**
 * PURE. Whether a record was imported from another system (a feed, a connector, an exchange partner)
 * rather than authored here. THE ONE QUESTION every ward workflow must ask before acting on a row:
 * a dose another hospital gave is not one this hospital bills, an order another hospital placed is
 * not one this ward's phlebotomist collects, a result matched to a stranger's order is a wrong chart.
 */
function isExternalRecord(record) {
  const sys = record && record.meta && record.meta.source && record.meta.source.system;
  return !!sys && sys !== NATIVE_SYSTEM;
}

class AuthorityError extends Error {
  constructor(message, code, detail) {
    super(message);
    this.name = "AuthorityError";
    this.code = code || "EXTERNAL_AUTHORITY";
    this.detail = detail || null;
  }
}

class RecordRequestError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "RecordRequestError";
    this.code = code || "BAD_REQUEST";
  }
}

/**
 * An idempotency key offered for a record it did not commit.
 *
 * A SUBCLASS OF VersionConflictError ON PURPOSE, and this is the whole reason it is one: every
 * caller in this codebase - a hundred-odd route handlers - already writes
 * `if (e instanceof VersionConflictError) return 409`, and a brand-new error class would fall past
 * all of them into their generic 502 "record_write_failed" branch. A reused key is a caller's
 * mistake, not the store's failure, so it must read as a conflict at every existing door without
 * one of them being edited. Its own `code` is what distinguishes it for anybody who looks.
 */
class IdempotencyConflictError extends VersionConflictError {
  constructor(detail) {
    super("this idempotency key already committed a different record", detail);
    this.name = "IdempotencyConflictError";
    this.code = "IDEMPOTENCY_KEY_REUSED";
  }
}

/**
 * The ClinicalStore backend over the persistence port, fixed to one tenant. This is the whole
 * bridge: four methods the store already expects, each forwarding with the tenant prepended. The
 * store cannot address another tenant because the backend has no parameter for one.
 */
class TenantBackend {
  constructor(repository, tenantId) {
    this.repository = assertRepository(repository);
    this.tenantId = tenantId;
    this._ctx = null;
  }
  async open() {}
  async close() {}
  get(resourceType, id) { return this.repository.latest(this.tenantId, resourceType, id); }
  history(resourceType, id) { return this.repository.history(this.tenantId, resourceType, id); }
  byPatient(resourceType, patientId) { return this.repository.byPatient(this.tenantId, resourceType, patientId); }

  /** Context for the NEXT write only: idempotency key and the audit event to land with it. */
  withWriteContext(ctx) { this._ctx = ctx || null; }

  async write(records) {
    const ctx = this._ctx || {};
    this._ctx = null;
    return this.repository.append(this.tenantId, records, { idempotencyKey: ctx.idempotencyKey || null, audit: ctx.audit || null });
  }
}

/**
 * Reads the tenant's record policy out of connect_tenant.settings (JSON). Nothing here is a
 * clinical rule; it is which system owns which records, and it is per hospital.
 *
 *   settings.wardsynq.recordMode      "system-of-record" (default) | "integration"
 *   settings.wardsynq.externallyOwned resource types the external EMR creates; in integration mode
 *                                     defaults to the identity and visit masters, Patient and
 *                                     Encounter, which an existing EMR always owns. Configurable.
 */
function recordPolicy(tenant) {
  let settings = {};
  try { settings = typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { settings = {}; }
  const ws = (settings && settings.wardsynq) || {};
  const mode = ws.recordMode === MODE.INTEGRATION ? MODE.INTEGRATION : MODE.SYSTEM_OF_RECORD;
  const externallyOwned = Array.isArray(ws.externallyOwned)
    ? ws.externallyOwned.filter((t) => RESOURCE_TYPES.includes(t))
    : (mode === MODE.INTEGRATION ? ["Patient", "Encounter"] : []);
  return Object.freeze({ mode, externallyOwned: Object.freeze(externallyOwned) });
}

/** Kept under its first name. The mapping itself lives in actor.js, beside the OPD-role mapping. */
const actorForMembership = actorFromConnectRole;

function externallyOwned(record) {
  const sys = record && record.meta && record.meta.source && record.meta.source.system;
  return !!sys && sys !== NATIVE_SYSTEM;
}

class RecordService {
  /**
   * @param {{repository: object, tenant: {id: string, settings?: any}, actor: object, role: string,
   *   bus?: object, pseudonym?: (patientId: string) => Promise<string|null>, now?: () => string}} deps
   */
  constructor(deps) {
    deps = deps || {};
    if (!deps.tenant || !deps.tenant.id) throw new RecordRequestError("a record service is always for one tenant", "NO_TENANT");
    if (!deps.actor) throw new RecordRequestError("a record service is always for one actor", "NO_ACTOR");
    this.tenant = deps.tenant;
    this.tenantId = String(deps.tenant.id);
    this.actor = deps.actor;
    this.role = deps.role || null;
    this.roleSource = deps.roleSource || null;
    this.policy = recordPolicy(deps.tenant);
    this.now = deps.now || (() => new Date().toISOString());
    this.pseudonym = deps.pseudonym || (async () => null);
    this.repository = assertRepository(deps.repository);
    this.backend = new TenantBackend(this.repository, this.tenantId);
    /* The raw store is a CONSTRUCTOR LOCAL, never a property. It used to be `this.store`, directly
     * under a comment claiming it "is not exported from this object" - which it plainly was: every
     * route handler holds a RecordService (openService() returns one), and ClinicalStore.put() takes
     * no actor and performs none of authoriseWrite's checks - no EXECUTE ceiling, no
     * signedBy-must-be-the-actor check, no credential check, no audit row. Nothing in the repository
     * reached for it, so this closes a latent hole rather than fixing a live bypass, but it is the
     * single invariant this layer exists to hold and a comment is not an access control. */
    const store = new ClinicalStore({ backend: this.backend, bus: deps.bus || null });
    // The only write path.
    this.governed = new GovernedStore({ store, bus: deps.bus || null });
  }

  /** What a client needs to know before it writes: who the server thinks it is, and the mode. */
  descriptor() {
    const a = this.actor;
    return {
      service: "wardsynq-record",
      tenantId: this.tenantId,
      mode: this.policy.mode,
      externallyOwned: [...this.policy.externallyOwned],
      role: this.role,
      roleSource: this.roleSource,
      actor: {
        id: a.id, kind: a.kind, tier: a.tier, display: a.display, canSign: !!a.credential,
        // null = every type. A UI disables what the server will refuse rather than discovering it.
        readable: a.scope.read === null ? null : [...a.scope.read],
        writable: a.scope.write === null ? null : [...a.scope.write],
      },
      resourceTypes: [...RESOURCE_TYPES],
    };
  }

  /** The types this actor may read, for chart and feed filtering. */
  _readableTypes() { return RESOURCE_TYPES.filter((t) => canRead(this.actor, t)); }

  async _audit(action, fields) {
    const patientId = fields && fields.patientId;
    // TASK 4.14: correlationId/deviceId/sessionId - the plan's minimum-audit fields this codebase
    // had nowhere to put. Folded into the existing free-form `scope` blob under its own `request`
    // key rather than a new column (see actor.js's requestContextOf() for why), so every audit
    // event this file already writes carries them with no change to any of this file's callers.
    const rc = this.actor && this.actor.requestContext;
    const scope = (fields && fields.scope) || null;
    const event = {
      ts: this.now(), actor: this.actor.id, connectorId: "wardsynq", action,
      resourceCounts: (fields && fields.resourceCounts) || null,
      scope: rc ? { ...(scope || {}), request: rc } : scope,
      patientRefHash: patientId ? await this.pseudonym(patientId) : null,
      outcome: (fields && fields.outcome) || "ok",
    };
    return event;
  }

  _assertType(resourceType) {
    if (!RESOURCE_TYPES.includes(resourceType)) throw new RecordRequestError(`unknown resource type "${resourceType}"`, "UNKNOWN_TYPE");
  }

  async get(resourceType, id) {
    this._assertType(resourceType);
    const rec = await this.governed.get(this.actor, resourceType, id);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, id, found: !!rec }, patientId: rec && (rec.patientId || (resourceType === "Patient" ? rec.id : null)) }));
    return rec;
  }

  async history(resourceType, id) {
    this._assertType(resourceType);
    const rows = await this.governed.history(this.actor, resourceType, id);
    const last = rows[rows.length - 1];
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, id, history: true, versions: rows.length }, patientId: last && (last.patientId || (resourceType === "Patient" ? last.id : null)) }));
    return rows;
  }

  async byPatient(resourceType, patientId) {
    this._assertType(resourceType);
    const rows = await this.governed.byPatient(this.actor, resourceType, patientId);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { resourceType, byPatient: true }, resourceCounts: { [resourceType]: rows.length }, patientId }));
    return rows;
  }

  /**
   * A roster: the latest version of every record of one type in this tenant. Capped, and audited
   * as a list rather than a read, because a ward list is the one legitimate cross-patient query.
   */
  async list(resourceType, limit) {
    this._assertType(resourceType);
    this.governed._assertRead(this.actor, resourceType);
    const rows = await this.repository.latestByType(this.tenantId, resourceType, limit);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.list", { scope: { resourceType, limit: Number(limit) || null }, resourceCounts: { [resourceType]: rows.length } }));
    return rows;
  }

  /**
   * Every local Patient that already carries one of this patient's identifiers.
   *
   * THE POINT IS WHAT THIS IS NOT. Identity reconciliation used to ask list("Patient", N) for a
   * roster and scan it, so on a hospital with more patients than N a returning patient outside the
   * roster was not found and a SECOND chart was created for them. This is an index seek whose cost
   * is the number of identifiers offered - two or three - and is the same on a hospital of ten
   * patients and a hospital of a hundred thousand.
   *
   * It answers with CANDIDATES, not with a decision. The decision stays where it was, in
   * reconcileIdentity()'s own rules, which this only feeds.
   *
   * @param {object} patientLike anything with `mrn` and/or `identifiers[]`
   * @returns {Promise<object[]>} matching Patients this actor may read
   */
  async findPatientsByIdentifier(patientLike) {
    this._assertType("Patient");
    this.governed._assertRead(this.actor, "Patient");
    const keys = patientIdentifierKeys({ ...(patientLike || {}), resourceType: "Patient" });
    if (!keys.length) return [];
    const rows = await this.repository.patientsByIdentifier(this.tenantId, keys);
    await this.repository.auditOnly(this.tenantId, await this._audit("record.identity-lookup", {
      // The KEYS are not logged, only how many were offered: an identifier is the patient.
      scope: { identifiersOffered: keys.length }, resourceCounts: { Patient: rows.length },
    }));
    return rows;
  }

  /** The whole chart: latest version of every resource in the patient's compartment. */
  async chart(patientId) {
    const out = {};
    const counts = {};
    // Only the types this actor may read. A pharmacist's chart is the orders and nothing else, and
    // the absence of a key says so rather than an empty list pretending the notes do not exist.
    for (const t of this._readableTypes()) {
      const rows = await this.governed.byPatient(this.actor, t, patientId);
      out[t] = rows;
      counts[t] = rows.length;
    }
    await this.repository.auditOnly(this.tenantId, await this._audit("record.read", { scope: { chart: true }, resourceCounts: counts, patientId }));
    return out;
  }

  /** Everything written to this tenant after a cursor. How a second client learns what changed. */
  async changes(since, limit) {
    if (!this.governed) throw new RecordRequestError("no store", "NO_STORE");
    // The governed store has no change feed of its own; this is a READ and is gated the same way.
    this.governed._assertRead(this.actor);
    const raw = await this.repository.changes(this.tenantId, since, limit);
    // The cursor advances over everything; the records handed back are only what may be read.
    const page = { records: raw.records.filter((r) => canRead(this.actor, r.resourceType)), cursor: raw.cursor };
    await this.repository.auditOnly(this.tenantId, await this._audit("record.changes", { scope: { since: Number(since) || 0, cursor: page.cursor, withheld: raw.records.length - page.records.length }, resourceCounts: { records: page.records.length } }));
    return page;
  }

  /**
   * The native write door.
   *
   * @param {object} entity  a canonical entity (resourceType + id required)
   * @param {{expectedVersion?: number|null, idempotencyKey?: string|null, activePatientId?: string|null,
   *   origin?: {kind: string, id?: string}|null}} [opts]
   *   origin  who produced the content. `{kind: "ai", id: "maik"}` (or an entity with aiDrafted: true)
   *           makes the write an AI-kind actor's, delegated by this session's human, never the human's.
   * @returns {Promise<{record: object, replayed: boolean, actor: {id, kind, tier, onBehalfOf}}>}
   */
  async put(entity, opts) {
    opts = opts || {};
    const writer = isAiOrigin(entity, opts.origin) ? aiActorFor(this.actor, opts.origin) : this.actor;
    if (!entity || typeof entity !== "object") throw new RecordRequestError("a write needs an entity", "NO_ENTITY");
    if (typeof entity.resourceType !== "string") throw new RecordRequestError("entity.resourceType is required", "NO_TYPE");
    this._assertType(entity.resourceType);
    if (typeof entity.id !== "string" || !entity.id.trim()) throw new RecordRequestError("entity.id is required", "NO_ID");

    const key = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
    if (key) {
      const prior = await this.repository.recall(this.tenantId, key);
      if (prior) {
        const versions = await this.repository.history(this.tenantId, prior.resourceType, prior.id);
        const rec = versions.find((v) => v.version === prior.version) || null;

        /* A KEY IS BOUND TO THE TYPE AND THE PATIENT IT FIRST COMMITTED FOR.
         *
         * Without this the recall matched on the key ALONE, and a client that reused one key across
         * two writes - a key minted per retry-session rather than per request, the commonest way
         * there is to get idempotency wrong - had its second write silently discarded and was handed
         * the FIRST record back under `ok: true`. When the two writes were two different patients
         * that is both a lost clinical write and another patient's record returned as the answer: a
         * wrong-patient disclosure arriving down the success path, where nobody is looking for one.
         *
         * IT IS THE PATIENT AND NOT THE ID, and the difference is load-bearing. A retried POST must
         * still replay, and several declarations mint an id from `new Date()` - activationIdFor() in
         * emergency-mode.js, grantIdFor() in break-glass.js - so two retries milliseconds apart
         * produce two different ids for one logical act. Binding to the id would turn every one of
         * those honest retries into a refusal, and the second declaration of an emergency is not a
         * thing to invent. Binding to the SUBJECT refuses what is actually dangerous - the same key
         * carrying a different patient, or a different kind of record entirely - and leaves the
         * retry alone.
         *
         * A Patient's own subject is its id: for that one type the record IS the person. */
        const subjectOf = (r) => (r && (r.patientId || (r.resourceType === "Patient" ? r.id : null))) || null;
        if (prior.resourceType !== entity.resourceType || subjectOf(rec) !== subjectOf(entity)) {
          throw new IdempotencyConflictError({
            idempotencyKey: key,
            committed: { resourceType: prior.resourceType, id: prior.id },
            attempted: { resourceType: entity.resourceType, id: entity.id },
          });
        }
        // Same key, same outcome. The record returned is the version that write produced, so a
        // client that lost the first response sees exactly what it would have seen.
        return { record: rec, replayed: true };
      }
    }

    const current = await this.repository.latest(this.tenantId, entity.resourceType, entity.id);
    const currentVersion = current ? current.version : 0;

    // Concurrency, the visible half. A client that says which version it read is refused if that
    // is no longer the latest, and is handed the latest so it can reconcile rather than guess.
    if (opts.expectedVersion !== undefined && opts.expectedVersion !== null) {
      const expected = Number(opts.expectedVersion);
      if (!Number.isInteger(expected) || expected < 0) throw new RecordRequestError("expectedVersion must be a non-negative integer", "BAD_EXPECTED_VERSION");
      if (expected !== currentVersion) {
        throw new VersionConflictError(`expected version ${expected} but the record is at version ${currentVersion}`, { expectedVersion: expected, currentVersion, current });
      }
    }

    // Authority. A record another system owns is corrected by that system, through its connector,
    // not by the native door. This holds in BOTH modes: a lab result a LIS reported is not edited by
    // hand in a system-of-record deployment either.
    if (current && externallyOwned(current)) {
      throw new AuthorityError(
        `${entity.resourceType}/${entity.id} is owned by ${current.meta.source.system}; changes to it arrive through that system's connector`,
        "EXTERNAL_AUTHORITY", { system: current.meta.source.system, current }
      );
    }
    // In integration mode, the external EMR creates the identity and visit masters. WardSynQ does
    // not mint a patient the hospital's EMR does not know about.
    if (!current && this.policy.mode === MODE.INTEGRATION && this.policy.externallyOwned.includes(entity.resourceType)) {
      throw new AuthorityError(
        `${entity.resourceType} records are created by the hospital's EMR in integration mode`,
        "EXTERNAL_CREATE", { mode: this.policy.mode, externallyOwned: [...this.policy.externallyOwned] }
      );
    }

    const patientId = entity.resourceType === "Patient" ? entity.id : (entity.patientId || null);
    // The audit row lands in the SAME atomic append as the version it describes. The version it
    // names is the one the store is about to assign, which the concurrency check above just fixed.
    const auditEvent = await this._audit("record.write", {
      scope: { resourceType: entity.resourceType, id: entity.id, version: currentVersion + 1, mode: this.policy.mode, idempotent: !!key,
        ...(writer !== this.actor ? { writer: writer.id, writerKind: writer.kind, onBehalfOf: writer.onBehalfOf } : {}) },
      resourceCounts: { [entity.resourceType]: 1 },
      patientId,
    });
    this.backend.withWriteContext({ idempotencyKey: key, audit: auditEvent });

    let saved;
    try {
      saved = await this.governed.put(writer, entity, { activePatientId: opts.activePatientId || null });
    } catch (err) {
      this.backend.withWriteContext(null);
      if (err instanceof GovernanceError) {
        await this.repository.auditOnly(this.tenantId, await this._audit("record.denied", {
          scope: { resourceType: entity.resourceType, id: entity.id, reasons: err.reasons.map((r) => r.code),
            ...(writer !== this.actor ? { writer: writer.id, writerKind: writer.kind, onBehalfOf: writer.onBehalfOf } : {}) },
          patientId, outcome: "denied",
        }));
      }
      throw err;
    }
    return { record: saved, replayed: false, actor: { id: writer.id, kind: writer.kind, tier: writer.tier, onBehalfOf: writer.onBehalfOf } };
  }

  /**
   * The ingest door, for the Integration Hub. Hands back a governed handle that writes as whichever
   * ADAPTER actor the hub supplies, with audit per entity. The hub enforces the adapter ceiling
   * through the same GovernedStore, so an upstream EMR's "active order" lands as a draft here too.
   */
  governedForIngest(opts) {
    opts = opts || {};
    const self = this;
    // The hub's own replay guard is per process, and on a server a process is one request. The
    // durable version is the idempotency table: the source's event identity is recorded with the
    // FIRST entity that lands, so a re-sent bundle is recognised by the next request too.
    let pendingKey = opts.idempotencyKey ? String(opts.idempotencyKey) : null;
    return {
      /** True when this bundle has already landed. Checked by the route before the hub runs. */
      alreadyIngested: async () => (pendingKey ? !!(await self.repository.recall(self.tenantId, pendingKey)) : false),
      put: async (adapterActor, entity) => {
        const patientId = entity.resourceType === "Patient" ? entity.id : (entity.patientId || null);
        const current = await self.repository.latest(self.tenantId, entity.resourceType, entity.id);
        const auditEvent = await self._audit("record.ingest", {
          scope: { resourceType: entity.resourceType, id: entity.id, version: (current ? current.version : 0) + 1, system: entity.meta && entity.meta.source && entity.meta.source.system },
          resourceCounts: { [entity.resourceType]: 1 }, patientId,
        });
        auditEvent.actor = adapterActor.id;
        self.backend.withWriteContext({ audit: auditEvent, idempotencyKey: pendingKey });
        try {
          const saved = await self.governed.put(adapterActor, entity);
          pendingKey = null;                    // recorded with this write; later entities carry no key
          return saved;
        } catch (err) {
          self.backend.withWriteContext(null);
          throw err;
        }
      },
      /**
       * Every entity in ONE append: one audit event naming them all, the idempotency key landing with
       * them, and nothing landing unless everything does. The governed store authorises each first.
       */
      putMany: async (adapterActor, entities) => {
        const list = Array.isArray(entities) ? entities : [];
        if (!list.length) return [];
        const counts = {};
        for (const e of list) counts[e.resourceType] = (counts[e.resourceType] || 0) + 1;
        const patients = new Set(list.map((e) => (e.resourceType === "Patient" ? e.id : e.patientId)).filter(Boolean));
        const auditEvent = await self._audit("record.ingest", {
          scope: { transaction: true, entities: list.map((e) => ({ resourceType: e.resourceType, id: e.id, system: e.meta && e.meta.source && e.meta.source.system })) },
          resourceCounts: counts, patientId: patients.size === 1 ? [...patients][0] : null,
        });
        auditEvent.actor = adapterActor.id;
        self.backend.withWriteContext({ audit: auditEvent, idempotencyKey: pendingKey });
        try {
          const saved = await self.governed.putMany(adapterActor, list);
          pendingKey = null;
          return saved;
        } catch (err) {
          self.backend.withWriteContext(null);
          throw err;
        }
      },
    };
  }
}

export {
  RESOURCE_TYPES, MODE, NATIVE_SYSTEM, isExternalRecord,
  AuthorityError, RecordRequestError, IdempotencyConflictError,
  TenantBackend, RecordService, recordPolicy, actorForMembership, externallyOwned,
};
