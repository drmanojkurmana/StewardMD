/* functions/api/queue/[[path]].js — Smart OPD Queue router.
 *
 * Three postures: DOCTOR (Firebase auth via identify → owns their session), PATIENT (opaque signed token
 * only, no login, PHI-free), health (/ready). Feature OFF unless env QUEUE_ENABLED === "1". No PHI in any
 * URL/query/log. Every clinical decision is server-side (engine + pure logic), never trusting the client.
 *
 *   GET  /api/queue/ready                                  -> { enabled, configured }
 *   GET  /api/queue/session?date=&department=&hospitalId=  -> { session, tickets }   (get/create today's)
 *   GET  /api/queue/list?sessionId=                        -> { session, tickets }
 *   POST /api/queue/ticket   { sessionId, name, mobile, mrn, visitType, priority } -> { ticket }
 *   POST /api/queue/advance  { sessionId }                 -> { tickets }            (Next Patient)
 *   POST /api/queue/status   { sessionId, ticketId, status } -> { tickets }
 *   POST /api/queue/priority { sessionId, ticketId, priority } -> { tickets }
 *   POST /api/queue/session/status { sessionId, status?, doctorStatus? } -> { session }
 *   GET  /api/queue/link?sessionId=&ticketId=              -> { token, url }         (patient tracking link)
 *   GET  /api/queue/portal?t=<token>                       -> PHI-free live snapshot  (PATIENT, no auth)
 */
import { queueEnabled, isQueueConfigured, mintDisplayToken, verifyDisplayToken } from "../../_queue.js";
import { identify } from "../../_usage.js";
import { ownerEmails, ownerOK } from "../../_adminauth.js";
// NOTE: roleForActor is deliberately NOT imported. It prefers actor.role, which resolveActor
// hardcodes to "viewer" for staff sessions, so using it here would silently demote every nurse
// and receptionist to read-only. Org roles resolve through ORG.authorizeOrg / whoami instead.
import { CAPS, can, requireCap, capsFor } from "../../_queue_roles.js";
import * as Q from "../../_queue_engine.js";
import * as QT from "../../_queue_timeline.js";
import { notifyTimeline } from "../../_queue_notify.js";
import { importRoster, importFromSource } from "../../_queue_ghis.js";
import * as ORG from "../../_opd_org_store.js";
import { selfCreateTenant } from "../../_connect/enterprise/org.js";
import { unitsFor } from "../../_region.js";
import * as PAT from "../../_opd_patient_store.js";
import { resolveRoomDoctor, roomStatus, roomForActor } from "../../_opd_org.js";
import { brandingFor, putBranding, validateLogo, logoKey, bucket as brandBucket } from "../../_clinic_branding.js";
import { proFromRequest, requirePro, needsProBody } from "../../_entitlement.js";
import * as BILL from "../../_clinic_billing_store.js";
import { orderQueue, orderRoomView, displayBoard } from "../../_queue_eta.js";
import { verifyStaffSession, verifySecret, pinLocked, nextPinState, mintStaffSession } from "../../_opd_auth.js";
// WardSynQ record: the nurse-vitals migration (functions/_wardsynq/migrate-vitals.js). Off unless
// WARDSYNQ_RECORD=1 AND the org names a Connect tenant AND that tenant opts in; then the timeline
// handler below dual-writes, timeline first in "shadow", record first in "authoritative".
import { vitalsMigration, recordVitals, patientIdForTicket } from "../../_wardsynq/migrate-vitals.js";
import { registrationMigration, registerPatientRecord } from "../../_wardsynq/migrate-registration.js";
import { assessmentMigration, recordAssessment, recordAssessmentSignOff } from "../../_wardsynq/migrate-assessment.js";
import { invOrderMigration, recordInvestigationOrder } from "../../_wardsynq/migrate-inv-order.js";
import { prescriptionMigration, recordPrescription } from "../../_wardsynq/migrate-prescription.js";
import { resultsMigration, recordResult } from "../../_wardsynq/migrate-results.js";
import { encounterMigration, recordEncounterSync, ENCOUNTER_TERMINAL_STATUSES } from "../../_wardsynq/migrate-encounter.js";
import { recordLinkForOrg } from "../../_wardsynq/migration-tenant.js";
import { actorDeps as wsqActorDeps, recordDeps as wsqRecordDeps } from "../../_wardsynq/deps.js";
import { checkPrescriptionSafety } from "../../_wardsynq/rx-safety.js";
import { getRulePack } from "../../_wardsynq/rulepack.js";
// Inpatient ward + eMAR (2026-09-07). Same shape as every OPD migration above: the route resolves
// the org and the forced wardsynq migration, these do the governed record write.
import { admitPatient, listWard, recordWardVitals, createWardMedicationOrder, transferPatient, bedBoard, patientTimeline } from "../../_wardsynq/migrate-inpatient.js";
// Emergency department (2026-09-09). Reuses everything above unchanged - vitals, orders, the eMAR,
// notes, labs, NEWS2, critical results are all encounter-class-agnostic already. This adds only
// arrival (known or unidentified), triage acuity, and a non-admitted disposition.
import { edArrival, recordEdTriage, edDisposition, listEd } from "../../_wardsynq/migrate-ed.js";
import { startResusBundle, markResusElement, waiveResusElement, voidResusBundle, listResusBundles } from "../../_wardsynq/migrate-resus.js";
import { deviceAssociate, deviceDissociate, deviceIngest, deviceStatus, deviceList } from "../../_wardsynq/migrate-device.js";
import {
  bookSurgicalCase, recordCaseConsent, markCaseSite, signInCase, timeOutCase, inciseCase,
  signOutCase, abandonCase, recordOperativeNote, dispositionCase, getSurgicalCase, listSurgicalCases,
  listOpenCases, startAnesthesia, recordAnesthesiaEvent, endAnesthesia, getAnesthesia,
  recordImplant, listImplants,
} from "../../_wardsynq/migrate-surgery.js";
import {
  recordPregnancy, getPregnancy, maternityStatus, maternityMeows, recordLabourObservation,
  recordMaternalBloodLoss, listBloodLoss, recordDelivery, getDelivery, registerNewborn, listFamilyLinks,
} from "../../_wardsynq/migrate-maternity.js";
import {
  checkWeightBasedRate, checkPaediatricDoseCeiling, checkAgeBand,
  recordNeonatalObservation, recordLine, removeLine, listLines,
} from "../../_wardsynq/migrate-pediatrics.js";
import {
  linkOncologyPlan, getOncologyLink, recordOncologyDiagnosis,
  recordAdverseEvent, listAdverseEvents, recordChemoAdministration,
  listChemoAdministrations, oncologyTimeline,
} from "../../_wardsynq/migrate-oncology.js";
import {
  linkCardiologyRecord, getCardiologyLink, recordEcgReference, listEcgReferences, cardiologyTimeline,
} from "../../_wardsynq/migrate-cardiology.js";
import {
  requestTransfusion, recordCrossmatch, issueUnit, recordBedsideCheck,
  startTransfusion, recordTransfusionObservation, recordTransfusionReaction, completeTransfusion,
  transfusionQueue, traceBloodUnit,
} from "../../_wardsynq/migrate-transfusion.js";
import { medicationRound, administerStep } from "../../_wardsynq/migrate-emar.js";
import { draftDischargeSummary, signDischargeSummary, dischargePatient, readDischargeSummary } from "../../_wardsynq/migrate-discharge.js";
import { recordProblem, listProblems } from "../../_wardsynq/migrate-problem.js";
import { marSchedule } from "../../_wardsynq/mar-schedule.js";
import { openCriticalLoops, acknowledgeCritical, listCriticalLoops } from "../../_wardsynq/critical-results.js";
import { recordFluid, fluidBalance } from "../../_wardsynq/fluid-balance.js";
import { giveHandover, receiveHandover, listHandovers } from "../../_wardsynq/handover.js";
import { verifyOrder, verificationQueue } from "../../_wardsynq/pharmacy-verify.js";
import { dispenseOrder, returnDispense, listDispenses } from "../../_wardsynq/pharmacy-dispense.js";
import { declareBreakGlass, openEmergencyChart, listBreakGlass } from "../../_wardsynq/break-glass.js";
import { declareEmergency, deactivateEmergency, emergencyStatus, emergencyLog, emergencyReconciliation } from "../../_wardsynq/emergency-mode.js";
import { reportIncident, triageIncident, recordIncidentRCA, addIncidentCAPA, completeIncidentCAPA, closeIncident, incidentLog } from "../../_wardsynq/incidents.js";
import { assignPatientTag, verifyPatientTag, deactivatePatientTag, reportPatientTagLost, replacePatientTag, patientTagLog } from "../../_wardsynq/identity-tag.js";
import { operationOutcome } from "../../_wardsynq/fhir.js";
import { dispatchRead, dispatchOperation } from "../../_wardsynq/fhir-route.js";
import { ingestFhir, listExceptions, listSourceGrants, resolveException, inboundEnabled, grantSourceSystem, revokeSourceSystem } from "../../_wardsynq/fhir-inbound.js";
import { registerDestination, revokeDestination, listDestinations, queueDelivery, dispatchOutbound, listDeliveries, replayDelivery } from "../../_wardsynq/fhir-outbound.js";
import { createLaunch } from "../../_wardsynq/smart-server.js";
import { ingestHl7 } from "../../_wardsynq/hl7-inbound.js";
import { startReconciliation, decideMedicine, readReconciliation } from "../../_wardsynq/med-reconciliation.js";
import { wardMetrics } from "../../_wardsynq/ward-metrics.js";
import { patientFlow } from "../../_wardsynq/patient-flow.js";
import { releaseResult, pendingRequests } from "../../_wardsynq/lab-result.js";
import { mergePatients, unmergePatients, identityOf } from "../../_wardsynq/identity-merge.js";
import { overrideReport } from "../../_wardsynq/override-analytics.js";
import { listOrderSets, prepareOrderSet, recordApplication } from "../../_wardsynq/order-sets.js";
import { recordConsent, withdrawConsent, consentStatus } from "../../_wardsynq/consent.js";
import { bookAppointment, setAppointmentState, requestFollowUp, listSchedule } from "../../_wardsynq/scheduling.js";
import { setCarePlan, recordProgress, readCarePlan } from "../../_wardsynq/care-plan.js";
import { listTemplates, writeTemplatedNote } from "../../_wardsynq/note-templates.js";
import { encounterIdForTicket } from "../../_wardsynq/opd-identity.js";
/* Aliased: `recordAssessment` is already the OPD assessment writer in this file, and a risk
 * assessment is a different thing entirely. Two names that read the same for two different
 * clinical acts is how the wrong one gets called. */
import { queueTransmission, recordOutcome, resolveTransmission, listTransmissions, sendQueued } from "../../_wardsynq/prescription-transmit.js";
import { submitNote, signNote, listAwaitingCoSign } from "../../_wardsynq/note-cosign.js";
import { chartCompletionQueue } from "../../_wardsynq/chart-completion.js";
import { patientFlowReport, clinicalOperationsReport, billingReport, claimsReport, pharmacyReport, himReport } from "../../_wardsynq/reports.js";
import { downtimePack } from "../../_wardsynq/downtime.js";
import { buildTwinSnapshot, reconstructTwinAsOf, operationalHealthReport } from "../../_wardsynq/digital-twin.js";
import { predictMetric } from "../../_wardsynq/twin-predict.js";
import { simulateScenario } from "../../_wardsynq/twin-simulate.js";
import { askAboutHospital, reviewTwinInteraction } from "../../_wardsynq/twin-copilot.js";
import { prepareOverdueWorkQueue } from "../../_wardsynq/twin-agent.js";
import { qualityReport } from "../../_wardsynq/quality.js";
import { collectSpecimen, specimenOutcome, collectionList } from "../../_wardsynq/specimen.js";
import { adtForEncounter, oruForReport } from "../../_wardsynq/hl7v2.js";
import { requestAdmission, closeAdmissionRequest, admissionWaitingList } from "../../_wardsynq/admission-request.js";
import { registryReport } from "../../_wardsynq/registry.js";
import { chartWound, listWounds } from "../../_wardsynq/wound.js";
import { bookResource, setBookingState, resourceSchedule } from "../../_wardsynq/resource-booking.js";
import { blockPeriod, cancelBlackout, listBlackouts } from "../../_wardsynq/blackout.js";
import { flowsheet } from "../../_wardsynq/flowsheet-view.js";
import { orderInvestigation } from "../../_wardsynq/ward-order.js";
import { saveConsultation } from "../../_wardsynq/consultation.js";
import { requestVerification, recordVerification, listVerifications } from "../../_wardsynq/verification.js";
import { raisePurchaseOrder, receiveGoods, listPurchaseOrders } from "../../_wardsynq/purchasing.js";
import { recordDeath, correctDeath, addRelatedPerson, removeRelatedPerson, listRelatedPeople } from "../../_wardsynq/patient-identity.js";
import { recordDetail } from "../../_wardsynq/record-detail.js";
import { safetyInbox } from "../../_wardsynq/safety-inbox.js";

/* One consultation arrives with ONE idempotency key from the screen, but fans out into several
 * writes. Handing the same key to each would make the second piece look like a repeat of the first
 * and be silently dropped, which is how a resend quietly loses a prescription. Each piece gets its
 * own derived key instead, stable across retries of the same consultation. No key in, no key out:
 * a caller who sent none is not given replay protection it never asked for. */
function idemFor(key, piece, index) {
  const k = typeof key === "string" ? key.trim() : "";
  return k ? k + ":" + piece + ":" + index : null;
}
import { chartInfusion, listInfusions } from "../../_wardsynq/infusion.js";
import { reportImaging } from "../../_wardsynq/radiology-report.js";
import { protocolContext, recordProtocol } from "../../_wardsynq/radiology-protocol.js";
import { imagingWorklist } from "../../_wardsynq/dicom.js";
/* TASK 8: the governed AI layer over the clinical record. Distinct from the MaiK product routes
 * under /api/ai, which answer a clinician's own questions and touch no record. */
import { askAboutPatient, reviewInteraction, listInteractions } from "../../_wardsynq/maik-interaction.js";
import { maikStatus } from "../../_wardsynq/maik-gateway.js";
import { hit as rateHit } from "../../_wardsynq/rate-limit.js";
import { KIND, logEvent } from "../../_wardsynq/observability.js";
import { explainOrderSafety } from "../../_wardsynq/maik-cds.js";
import { checkAdvisories } from "../../_wardsynq/advisory-authoring.js";
import { cdaForEncounter } from "../../_wardsynq/cda.js";
import { news2ForPatient } from "../../_wardsynq/news2-view.js";
import { recordRead, readersToNotify } from "../../_wardsynq/read-log.js";
import { codeClaimForEncounter, claimAction, recordPreAuth, claimsForPatient, watchlist as upcodingList } from "../../_wardsynq/billing.js";
import { requestRelease, authorizeRelease, denyRelease, cancelRelease, fulfillRelease, readRoi, roiRequestsForPatient } from "../../_wardsynq/roi.js";
import { patientCopy, releaseToPatient } from "../../_wardsynq/patient-record.js";
import { exportPage, recordBackupRun, backupStatus } from "../../_wardsynq/backup-run.js";
import { chargesForPatient } from "../../_wardsynq/charge-capture.js";
import { raiseInvoice, postDiscount, postDeposit, postPayment, postRefund, postAdjustment, postWriteOff, voidInvoiceRoute, readInvoice, invoicesForPatient } from "../../_wardsynq/invoice.js";
import { recordMovement, stockLevels, reconcileCount } from "../../_wardsynq/stock.js";
import { possibleDuplicates } from "../../_wardsynq/mpi-view.js";
import { enrolPatient, redeemCode, portalRead, revokeAccess } from "../../_wardsynq/patient-access.js";
import { messageWorklist, replyToMessage } from "../../_wardsynq/portal-requests.js";
import { extract as analyticsExtract } from "../../_wardsynq/analytics-extract.js";
import { listTools as listRiskTools, recordAssessment as recordRiskAssessment, completeAction as completeRiskAction, listAssessments as listRiskAssessments } from "../../_wardsynq/risk-assessment.js";
import { recordAllergiesFromAssessment } from "../../_wardsynq/migrate-allergy.js";

// The Encounter migration's one shared call site. Every hook below (ticket add, import, a terminal
// status change, checkout) passes the ticket in whatever state it is NOW; recordEncounterSync reads
// that state and decides open/continuation/close itself — see migrate-encounter.js's header for why
// this is one function, not several. Best-effort and silent on failure at every call site: a missed
// WardSynQ sync must never block or alter the underlying queue action that triggered it, the same
// contract every other shadow-mode write already keeps.
async function syncEncounter(request, env, s, ticket) {
  try {
    const mig = (await wsqForcedMigration(env, await ORG.getOrg(env, s.orgId || s.hospitalId))) || await encounterMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
    if (!mig || mig.mode === "off") return null;
    if (mig.error) return null;   // wardsynq org with no tenant linked yet — best-effort, silent, like every other syncEncounter failure
    return await recordEncounterSync(request, env, { migration: mig, ticket, session: s, actorDeps: wsqActorDeps(env, { orgForTenant: () => org }), recordDeps: wsqRecordDeps(env, mig.tenantId) });
  } catch (e) {
    return null;
  }
}
const wsqTenantRow = (e, id) => (e.CONNECT_DB ? e.CONNECT_DB.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(String(id)).first() : null);
// NATIVE WARDSYNQ HOSPITAL (org.mode "wardsynq"): every migrated OPD write for such an org goes
// DIRECTLY to the WardSynQ record - no GHIS, no global WARDSYNQ_RECORD shadow flag (that flag stays
// off/untouched; it governs the separate GHIS-shadow feature entirely). Builds the SAME {mode,tenantId}
// shape resolveMigration() would, via the org's EXISTING connectTenantId link (no new linkage
// mechanism) — never inferred; only an explicit org.mode==="wardsynq" takes this path. Returns null
// when the org isn't wardsynq-mode, so every caller falls through to its normal flag-gated resolution,
// completely unchanged. An unlinked wardsynq org gets {error} rather than a silent no-op.
//
// 2026-09-07, real-device end-to-end verification: reads org.connectTenantId DIRECTLY rather than
// going through resolveTenantForOrg(env, org.id, {getOrg,...}), which re-fetches the SAME org from
// Firestore by id — every caller here already HAS a freshly-fetched org in hand (that is how it knew
// mode==="wardsynq" in the first place). One D1 read to confirm the tenant row actually exists;
// zero redundant Firestore round-trips. Found live: the extra fetch was one of several redundant
// org lookups stacking up on this request (this one, then orgForTenant's own Firestore query, then
// authorizeOrg's own getOrg, inside resolveClinicalActor) that pushed a single register/save/order
// past a 2+ second wall time and back as a 502 - the WardSynQ record actor-resolution chain had
// never run against real production Firestore before (WARDSYNQ_RECORD has always been 0, so no
// shadow-mode write ever reached it either). This removes the one redundant hop under this
// function's own control without touching the shared, already-tested resolveClinicalActor/
// orgForTenant/authorizeOrg chain every other migration also relies on.
async function wsqForcedMigration(env, org) {
  if (!org || org.mode !== "wardsynq") return null;
  const tenantId = org.connectTenantId;
  if (!tenantId) return { mode: "authoritative", tenantId: null, error: "wardsynq_tenant_not_configured" };
  const tenant = await wsqTenantRow(env, tenantId);
  if (!tenant) return { mode: "authoritative", tenantId: null, error: "wardsynq_tenant_not_configured" };
  return { mode: "authoritative", tenantId: String(tenantId) };
}
// The REMAINING redundant hop from the comment above: functions/_wardsynq/org.js's orgForTenant()
// finds an org from a tenant by a Firestore FIELD QUERY (q_orgs where connectTenantId==tenant.id) -
// its slowest path - unless the tenant's own settings already name the org explicitly
// (settings.wardsynq.orgId), which is its FASTEST path, a single doc get inside authorizeOrg's own
// getOrg immediately after. Nothing writes that explicit pointer today, so every wardsynq/Connect-
// tenant record actor resolution pays for the slow query, every time, on top of authorizeOrg's own
// getOrg. Writing it ONCE, here, at the moment an org is linked to a tenant (POST /api/queue/org/
// update with connectTenantId) makes every subsequent resolveClinicalActor call for that tenant take
// the fast path instead. Best-effort and silent on failure: a missed reciprocal pointer degrades to
// the pre-existing (slow but working) query path, never to a broken link.
async function wsqLinkTenantOrg(env, org) {
  try {
    if (!env.CONNECT_DB || !org || !org.connectTenantId) return;
    const tenant = await wsqTenantRow(env, org.connectTenantId);
    if (!tenant) return;
    let settings = {};
    try { settings = typeof tenant.settings === "string" ? JSON.parse(tenant.settings || "{}") : (tenant.settings || {}); } catch { settings = {}; }
    if (settings.wardsynq && settings.wardsynq.orgId === org.id) return;   // already linked, no write needed
    settings.wardsynq = Object.assign({}, settings.wardsynq, { orgId: org.id });
    await env.CONNECT_DB.prepare("UPDATE connect_tenant SET settings=?, updated_at=? WHERE id=?")
      .bind(JSON.stringify(settings), new Date().toISOString(), String(org.connectTenantId)).run();
  } catch (e) { /* best-effort: a missed reciprocal link never blocks the org update itself */ }
}
import "../../_opd_ghis_connector.js";   // side-effect: registers the "ghis" OPD connector
import "../../_opd_connect_connector.js";   // side-effect: registers the "connect" OPD connector (any FHIR hospital via Connect EMR)
import * as ONCO from "../../_onco_store.js";
// Static protocol templates (Phase 2 ships ONE protocol; a registry/lookup-by-file only makes sense
// once Phase 7 adds many - see kb/protocols/rchop.json + kb/schema/protocol.schema.json). Same JSON-
// import shape esbuild already resolves for Cloudflare Pages Functions (matches the `import X from
// "../../../kb/ai/maik-scope.js"` root-JS-import precedent in functions/api/ai/[[path]].js, just for
// a .json leaf instead of a UMD .js leaf).
import RCHOP_TEMPLATE from "../../../kb/protocols/rchop.json";
const ONCO_PROTOCOLS = { rchop: RCHOP_TEMPLATE };
function oncoProtocolTemplate(protocolId) { return ONCO_PROTOCOLS[String(protocolId || "").toLowerCase()] || null; }
// The OPD Protocol picker loads the 124 static /kb/protocols/*.json client-side; the server registry
// doesn't inline them. Accept a client-supplied REFERENCE template when the server doesn't know the id.
// It's a dose FORMULA (no PHI) and createPlan snapshots/freezes it. Minimally validated + force-marked
// reference/experimental so it can never be silently treated as a hospital-APPROVED active protocol
// (the activation gate in _onco_store.js still blocks confirm→active for it — assign stays a draft plan).
function clientProtocolTemplate(t) {
  if (!t || typeof t !== "object") return null;
  var r = t.regimen;
  if (!t.id || !r || !Array.isArray(r.drugs) || !r.drugs.length) return null;
  return Object.assign({}, t, { lifecycleState: "reference", experimental: true, _clientSupplied: true });
}
// ONCQIS Phase B: the PURE recommendation engine (onco-recommend.js, root JS, UMD default import -
// same shape as `import Engine from "../followcare-engine.js"`). Standard Protocols are the new-schema
// kb/schema/standard-protocol.schema.json objects; only status==="ACTIVE" are ever recommended, and
// none are published ACTIVE yet, so activeStandardProtocols() is [] for now (honest, not fabricated).
import ONCORECOMMEND from "../../../onco-recommend.js";
function activeStandardProtocols() { return Object.keys(ONCO_PROTOCOLS).map(function (k) { return ONCO_PROTOCOLS[k]; }).filter(function (p) { return p && p.status === "ACTIVE"; }); }

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in", "https://wardsynq.com", "https://www.wardsynq.com"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || ""; const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token, X-Staff-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
/* `extra` is optional response headers. Added for TASK 9.15's 429s: a rate-limit refusal without a
 * Retry-After is a refusal a client has to guess at, and guessing means retrying immediately. Shaped
 * like fhirJson's own `extra` argument below so there is one convention, and every existing
 * three-argument caller is unaffected. */
function json(obj, status, request, extra) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request), extra || {}) }); }
/* FHIR's own media type, on every FHIR response including errors. The CapabilityStatement declared
 * application/fhir+json while the route served application/json, and a strict client rejects that
 * mismatch - which is how "we have a FHIR endpoint" turns out to mean "we have JSON". A single
 * resource carries its ETag as a weak validator over versionId, so If-Match round-trips to the
 * record service's expectedVersion. */
function fhirJson(obj, status, request, extra) {
  const h = Object.assign({ "Content-Type": "application/fhir+json; charset=utf-8", "Cache-Control": "no-store" }, corsHeaders(request));
  if (obj && obj.meta && obj.meta.versionId && obj.resourceType !== "Bundle") h.ETag = `W/"${obj.meta.versionId}"`;
  if (obj && obj.meta && obj.meta.lastUpdated && obj.resourceType !== "Bundle") { const d = new Date(obj.meta.lastUpdated); if (!isNaN(d)) h["Last-Modified"] = d.toUTCString(); }
  Object.assign(h, extra || {});
  return new Response(JSON.stringify(obj), { status: status || 200, headers: h });
}
async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }

/* An authorization refusal, in words the person at the front desk can act on.
 *
 * authorizeOrgAccess already knows which refusal this is; every caller used to flatten it to
 * "forbidden", so the commonest failure by far - a member whose role defaulted to "viewer", which
 * holds queue.view and nothing else - looked identical to being signed out or in the wrong clinic.
 * The role is included because the owner's next question is always "what role does she have?".
 * Carries no patient data: an org id and a role name only. */
const AZ_SAY = {
  org_not_found: "That clinic no longer exists, or the app is pointed at the wrong one.",
  not_a_member: "You are not on this clinic's staff list. Ask the owner to add you.",
  org_mismatch: "You are signed in to a different clinic. Sign out and sign in to this one.",
  out_of_scope: "Your access is limited to certain departments or rooms, and this patient is outside it.",
  forbidden: "Your role does not allow that. Ask the owner to grant a role that does.",
};
/* WHAT THE PERSON WAS ACTUALLY REFUSED, in words they use for the job.
 *
 * This is the shared refusal for EVERY permission failure in the product, and its wording was
 * hardcoded to "cannot check patients in" - a phrase from the outpatient check-in desk. So a nurse
 * refused a clinical note was told she could not check patients in, a pharmacist refused a chart
 * was told the same, and so was everyone else. The message named an action nobody had attempted,
 * which is worse than saying nothing: it sends the owner to change the wrong thing.
 *
 * The capability now travels on the refusal (_opd_org.js), and these are the plain-English words
 * for each. A capability with no entry falls back to the generic sentence rather than inventing a
 * description of itself. */
const CAP_SAY = {
  "queue.view": "see the patient list", "queue.add": "register or add a patient",
  "queue.status": "move a patient through the queue", "queue.assign": "assign a patient to a clinician",
  "emr.view": "open a patient's chart", "emr.vitals": "record observations",
  "emr.treat": "prescribe or write in a chart", "order.read": "see a patient's orders",
  "order.verify": "verify an order", "order.dispense": "dispense medicines",
  "lab.result": "release a result", "billing.view": "see billing", "billing.charge": "take payment",
  "staff.admin": "manage staff and roles", "analytics.view": "see reports",
  "him.roi": "release records to a third party", "incident.report": "file an incident report",
};
function azRefusal(az) {
  const reason = (az && az.reason) || "forbidden";
  const out = { ok: false, error: reason, message: AZ_SAY[reason] || AZ_SAY.forbidden };
  if (az && az.role) {
    out.role = az.role;
    if (reason === "forbidden") {
      const doing = CAP_SAY[az.cap] ? " " + CAP_SAY[az.cap] : "";
      out.message = 'Your role here is "' + az.role + '", which cannot' + (doing || " do that") +
        (az.role === "viewer" ? " - a member with no role granted is read-only." : ".") +
        " Ask the owner to change it.";
    }
  }
  return out;
}
function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } }

const staffEnabled = (env) => env && env.QUEUE_STAFF_ENABLED === "1";
// Oncology treatment-plan writes (Phase 2) - mirrors emrWriteEnabled in functions/api/ghis/[[path]].js:
// inert (501, never touches Firestore) until the owner sets QUEUE_ONCO_WRITE=1 server-side.
function oncoWriteEnabled(env) { return !!(env && env.QUEUE_ONCO_WRITE === "1"); }
function isOwnerEmail(env, email) { try { return !!(email && ownerEmails(env).indexOf(email) > -1); } catch (e) { return false; } }
// Resolve the employeeId behind a GHIS session token (staff identity). Reads GHIS_KV directly — a 3-line
// mirror of the ghis proxy's getSession, avoiding a heavyweight cross-import.
async function ghisUserId(env, token) {
  if (!token || !env.GHIS_KV) return "";
  try { const raw = await env.GHIS_KV.get("sess:" + token); if (!raw) return ""; return String(JSON.parse(raw).userId || ""); } catch (e) { return ""; }
}
// The one identity entry point. AUTHORITY is never decided here — a session only proves WHO you are;
// what you may do is org-membership (authorizeOrg) server-side. Global role is "admin" only for a
// StewardMD owner, "doctor" for a signed-in StewardMD doctor (their own legacy session), else "viewer".
// NO hard-coded admin/GHIS ids, NO QUEUE_STAFF_ADMIN_IDS bootstrap (retired in Phase 5).
async function resolveActor(request, env) {
  const who = await identify(request, env);
  if (who && !who.guest) {
    const owner = isOwnerEmail(env, who.email);
    // Patient-facing name = the Firebase displayName ("Dr Manoj"), NEVER the email (no email exposure to patients).
    return { kind: "firebase", id: who.id, email: who.email || "", isOwner: owner, role: owner ? "admin" : "doctor", hospitalId: "", name: who.name || "Doctor" };
  }
  if (staffEnabled(env)) {
    const tok = request.headers.get("X-Staff-Token") || (request.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
    if (tok) {
      // 1. StewardMD-native staff session (email/PIN login) — signed HMAC, org-bound. Authority via q_members.
      const ss = await verifyStaffSession(env, tok, Date.now());
      if (ss) return { kind: "staff", id: ss.identity, orgId: ss.orgId, role: "viewer", name: ss.identity, ghisToken: "" };
      // 2. GHIS session — an identity provider only; it maps into org membership, never a global elevation.
      const eid = await ghisUserId(env, tok);
      if (eid) return { kind: "ghis", id: "ghis:" + eid, employeeId: eid, role: "viewer", name: eid, hospitalId: "", ghisToken: tok };
    }
  }
  return null;
}
// Session access: a doctor may only touch their OWN session; owner/admin any; staff any session in THEIR
// hospital (hospital-scoped). Read `cap` is checked by the caller via requireCap.
async function loadSessionFor(env, sessionId, actor) {
  const s = sessionId ? await Q.getSession(env, sessionId) : null;
  if (!s) return { err: json({ ok: false, error: "not_found" }, 404) };
  if (actor.kind === "firebase") {
    if (actor.isOwner || s.doctorUid === actor.id) return { s };   // owner any; doctor only their own session
    return { err: json({ ok: false, error: "forbidden" }, 403) };
  }
  // staff (ghis/pin/email): must be an ACTIVE member of the session's ORG (cap+scope via requireSessionCap).
  const az = await ORG.authorizeOrg(env, actor, s.orgId || s.hospitalId, null);
  if (!az.ok) return { err: json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403) };
  return { s };
}
// Capability + scope for a session op: Firebase (owner/doctor) via global role; staff via the session's
// org membership + room/dept scope. Throws a 403/404-shaped error (caught by the router).
async function requireSessionCap(env, actor, s, cap) {
  if (actor.kind === "firebase") { requireCap(actor.role, cap); return; }
  const az = await ORG.authorizeOrg(env, actor, s.orgId || s.hospitalId, cap, { roomId: s.roomId, departmentId: s.department });
  if (!az.ok) throw Object.assign(new Error(az.reason || "forbidden"), { status: az.reason === "org_not_found" ? 404 : 403 });
}
// Capability for an org-level op named by a raw orgId/hospitalId (board, session create).
async function requireOrgOrGlobal(env, actor, orgId, cap, resourceOwnerUid) {
  if (actor.kind === "firebase") {
    // A global "doctor" role is NOT tenant membership. When the resource is owned by a specific doctor
    // (onco plans carry doctorUid), a non-owner Firebase doctor may only touch their OWN resource -
    // otherwise any signed-in doctor could read/write another clinic's plan by id. When no owner uid is
    // passed (org-level ops like a board), behaviour is unchanged: cap-only.
    if (resourceOwnerUid !== undefined && resourceOwnerUid !== null && resourceOwnerUid !== "" && !actor.isOwner && String(resourceOwnerUid) !== String(actor.id)) {
      throw Object.assign(new Error("forbidden"), { status: 403 });
    }
    requireCap(actor.role, cap); return;
  }
  const az = await ORG.authorizeOrg(env, actor, orgId, cap);
  if (!az.ok) throw Object.assign(new Error(az.reason || "forbidden"), { status: az.reason === "org_not_found" ? 404 : 403 });
}
async function ticketView(env, tickets) { return Q.decorateForDoctor(env, tickets); }
const ACTIVE = ["registered", "waiting", "called", "in_consultation"];
const WAITING = ["registered", "waiting", "called"];
// The nurse-station board for an org: each room (its resolved-doctor session) with count + status, plus
// the central unassigned pool. Status uses the org's CONFIGURABLE thresholds (Phase 3), not hard-codes.
async function boardForOrg(env, org, date) {
  const rooms = await ORG.listRooms(env, org.id);
  const out = [];
  for (const rm of rooms) {
    const doctorUid = resolveRoomDoctor(rm);
    let tickets = [], sess = null;
    if (doctorUid) { sess = await Q.getOrCreateRoomSession(env, org, rm, date); if (sess) tickets = (await Q.listTickets(env, sess.id)).filter((t) => ACTIVE.indexOf(t.status) > -1); }
    const waiting = tickets.filter((t) => WAITING.indexOf(t.status) > -1).length;
    const inConsult = tickets.some((t) => t.status === "in_consultation");
    out.push({ room: rm, doctorUid: doctorUid || null, sessionId: sess ? sess.id : null, waiting: waiting,
      status: doctorUid ? roomStatus(waiting, inConsult, org.thresholds) : "unavailable", tickets: await ticketView(env, orderRoomView(tickets)) });
  }
  const pool = await Q.getOrCreatePoolSession(env, org, date);
  const poolTickets = (await Q.listTickets(env, pool.id)).filter((t) => WAITING.indexOf(t.status) > -1);
  return { mode: org.mode, thresholds: org.thresholds, rooms: out, pool: await ticketView(env, orderQueue(poolTickets)), poolSessionId: pool.id };
}
// Org config → OPD connector. Read from env OPD_CONNECTORS (JSON: { "<hospitalId>": "ghis", "*": "..." });
// native by default. NO hard-coded GHIS org/user id — a hospital is wired to a connector purely by config.
// (Phase 3 moves this to per-clinic records; the shape { id, mode, connectorId } is stable.)
function opdOrgFor(env, hospitalId) {
  let map = {}; try { map = JSON.parse((env && env.OPD_CONNECTORS) || "{}"); } catch (e) { map = {}; }
  const cid = map[hospitalId] || map["*"] || null;
  return { id: hospitalId || "", mode: cid ? "connect" : "native", connectorId: cid };
}

export async function onRequest(context) {
  const __t0 = Date.now();
  const { request, env } = context;
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: corsHeaders(request) });
  const url = new URL(request.url);
  const method = request.method;
  const parts = url.pathname.replace(/^\/api\/queue\/?/, "").replace(/\/+$/, "").split("/");
  const seg = parts[0] || "", sub = parts[1] || "";

  if (method === "GET" && seg === "ready") return json({ ok: true, enabled: queueEnabled(env), configured: isQueueConfigured(env) }, 200, request);
  if (!queueEnabled(env)) return json({ ok: false, error: "disabled" }, 404, request);

  try {
    // ---- StewardMD-native staff login (email / PIN) — GHIS-INDEPENDENT (Phase 5), pre-auth ----
    if (method === "POST" && seg === "auth" && (sub === "pin" || sub === "email")) {
      if (!staffEnabled(env)) return json({ ok: false, error: "staff_disabled" }, 404, request);
      const b = await readBody(request);
      if (sub === "pin") {
        const orgId = await ORG.resolveOrgId(env, b.clinicCode || b.orgId || "");   // accept the SMD-XXXXXX clinic code
        const auth = await ORG.getMemberAuth(env, orgId, b.identity || "");
        if (!auth || !auth.active || !auth.pinHash) return json({ ok: false, error: "invalid_login" }, 401, request);
        const gate = pinLocked(auth, Date.now());
        if (gate.locked) return json({ ok: false, error: "locked", retryInMs: gate.remainingMs }, 429, request);
        const ok = await verifySecret(String(b.pin || ""), auth.pinSalt, auth.pinHash);
        const nx = nextPinState(auth, Date.now(), ok);
        await ORG.recordMemberPinAttempt(env, auth.orgId, auth.identity, nx);
        if (!ok) return json({ ok: false, error: "invalid_login", attemptsLeft: Math.max(0, 5 - nx.pinAttempts) }, 401, request);
        return json({ ok: true, token: await mintStaffSession(env, auth.orgId, auth.identity, Date.now()), orgId: auth.orgId, identity: auth.identity }, 200, request);
      }
      const m = await ORG.findMemberByEmail(env, b.email || "");
      if (!m || !m.active || !m.passHash || !(await verifySecret(String(b.password || ""), m.passSalt, m.passHash))) return json({ ok: false, error: "invalid_login" }, 401, request);
      return json({ ok: true, token: await mintStaffSession(env, m.orgId, m.identity, Date.now()), orgId: m.orgId, identity: m.identity }, 200, request);
    }

    // ---- PATIENT: token only, no auth ----
    if (method === "GET" && seg === "portal") {   // PHI-free live position
      if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
      return json(await Q.portalContext(env, url.searchParams.get("t") || ""), 200, request);
    }
    // Patient's own sealed encounter timeline (their data, secure token, 7-30d window). No auth/login.
    if (method === "GET" && seg === "timeline" && url.searchParams.get("t")) {
      if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
      return json(await QT.getTimelineByToken(env, url.searchParams.get("t") || ""), 200, request);
    }
    // WALL DISPLAY: org-scoped signed token, no auth/login (a waiting-room screen). PHI-minimal
    // (first name + last initial only — never MRN/phone). Read-only projection of the nurse board.
    if (method === "GET" && seg === "display" && url.searchParams.get("t")) {
      if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
      const orgId = await verifyDisplayToken(env, url.searchParams.get("t") || "");
      if (!orgId) return json({ ok: false, error: "invalid" }, 200, request);
      const org = await ORG.getOrg(env, orgId);
      if (!org) return json({ ok: false, error: "not_found" }, 200, request);
      const board = displayBoard(org, await boardForOrg(env, org, url.searchParams.get("date") || ""));
      try { const b = await brandingFor(env, org.id); if (b && board.org) { board.org.logo = b.clinicLogo; if (b.clinicName) board.org.name = b.clinicName; } } catch (e) {}
      return json(board, 200, request);
    }
    // White-label logo (Pro clinic): served SAME-ORIGIN, public (a logo, no PHI). GET .../branding/logo?orgId=
    if (method === "GET" && seg === "branding") {
      const orgId = url.searchParams.get("orgId") || "";
      const b = await brandingFor(env, orgId), bkt = brandBucket(env);
      if (!b || !bkt) return json({ ok: false, error: "no_logo" }, 404, request);
      try {
        const obj = await bkt.get(logoKey(orgId, b.ext));
        if (!obj) return json({ ok: false, error: "no_logo" }, 404, request);
        const ctype = b.ext === "png" ? "image/png" : b.ext === "webp" ? "image/webp" : "image/jpeg";
        return new Response(obj.body, { status: 200, headers: Object.assign({ "Content-Type": ctype, "Cache-Control": "public, max-age=300" }, corsHeaders(request)) });
      } catch (e) { return json({ ok: false, error: "no_logo" }, 404, request); }
    }

    // ---- authenticated: doctor (Firebase) OR staff (GHIS token, when QUEUE_STAFF_ENABLED) ----
    const actor = await resolveActor(request, env);
    if (!actor) return json({ ok: false, error: "unauthorized" }, 401, request);
    if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
    const who = actor;   // compat alias: a plain doctor's actor.id === their Firebase uid

    // Upload/replace a Pro clinic's white-label logo (owner/admin of the org, and must be Pro).
    // Body = raw image bytes; query ?orgId=&name=. Stored in R2, recorded in q_org_branding.
    if (method === "POST" && seg === "branding") {
      const orgId = url.searchParams.get("orgId") || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, CAPS.STAFF_ADMIN);
      if (!az.ok) return json({ ok: false, error: "forbidden" }, 403, request);
      let _pg = { ok: false, reason: "none" };
      try { _pg = await requirePro(env, request); } catch (e) {}
      // Keep the legacy `error: "pro_required"` key for any older client, and add the reason.
      if (!_pg.ok) return json(needsProBody(_pg, { ok: false, error: "pro_required", feature: "queue-branding" }), 402, request);
      const bkt = brandBucket(env);
      if (!bkt) return json({ ok: false, error: "storage_unavailable" }, 503, request);
      const ct = request.headers.get("Content-Type") || "";
      const bytes = await request.arrayBuffer();
      const v = validateLogo(ct, bytes.byteLength);
      if (!v.ok) return json({ ok: false, error: v.error }, 400, request);
      await bkt.put(logoKey(orgId, v.ext), bytes, { httpMetadata: { contentType: ct } });
      const res = await putBranding(env, orgId, { clinicName: url.searchParams.get("name") || "", ext: v.ext, updatedBy: actor.id || "" });
      return json(Object.assign({ ok: true }, res), 200, request);
    }

    // ---- Patient registration (ABDM-ready identity + MR allocation) -----------------------------
    // ONE place decides who issues the MR: the WORKPLACE, never whether a number was typed in.
    // The client does not re-implement validation - it renders the field-keyed errors returned here.
    /* ---- INPATIENT WARD + eMAR (wardsynq-native hospitals only) --------------------------------
     *
     * Admission -> ward list -> ward vitals -> inpatient medication order -> the medication round ->
     * the governed administration. Every one of these is refused for any org that is not
     * org.mode "wardsynq": this vertical writes to the WardSynQ record and has NO GHIS path, by
     * design. The OPD routes above are untouched.
     *
     * Capabilities, deliberately split so the record can tell who did what:
     *   admit / vitals      QUEUE_ADD / EMR_VITALS   the ward clerk and the nurse
     *   medication order    EMR_TREAT                the doctor, and only the doctor
     *   verify / dispense   ORDER_DISPENSE           pharmacy releasing the dose
     *   scan / administer   MED_ADMINISTER           the nurse at the bedside
     */
    // The clinical ward block owns /ward/<sub>. The org-configuration routes POST /ward (create a
    // ward master record) and POST /ward/update live further down with the other admin routes and
    // were unreachable from here: every such call fell through capFor and answered not_found, so a
    // hospital could never add a ward from the console. They are let past on purpose.
    if (seg === "ward" && sub && !(method === "POST" && sub === "update")) {
      // PUT carries a body too, since 2026-09-08: a FHIR update is a PUT of the whole resource.
      // The HL7 door takes the message as text (ER7), never as JSON.
      const isHl7 = parts[1] === "hl7";
      const rawText = isHl7 && method === "POST" ? await request.text().catch(() => "") : null;
      const body = isHl7 ? {} : ((method === "POST" || method === "PUT") ? await readBody(request) : {});
      const wOrgId = url.searchParams.get("orgId") || body.orgId || "";
      // TASK 4.13: the subs each new narrow capability is an ALTERNATIVE authority for - see the
      // ROI_SUBS/TRANSFUSION_SUBS fallback checks below, right after wAz is first computed.
      const ROI_SUBS = new Set(["roi-request", "roi-authorize", "roi-deny", "roi-cancel", "roi-fulfill", "roi", "roi-requests"]);
      const TRANSFUSION_SUBS = new Set(["transfusion-request", "transfusion-crossmatch", "transfusion-issue", "transfusion-bedside-check", "transfusion-start", "transfusion-observe", "transfusion-reaction", "transfusion-complete"]);
      /* TASK 9.15. Whole-hospital or whole-ward reads. Rationed tightly because they are rare and
       * deliberate, and because they are the one shape that turns an authenticated account into a
       * bulk exfiltration tool in a loop. */
      const RL_BULK = new Set(["backup", "downtime", "analytics-extract", "roi-export", "twin-reconstruct", "operational-health"]);
      /* Emergency access is bounded but never scarce: the limit is here to make scripted break-glass
       * abuse visible and finite, and it sits far above the handful of declarations a real shift
       * produces. Refusing a genuine emergency to enforce a quota would be the worse failure. */
      const RL_EMERGENCY = new Set(["break-glass", "emergency-chart", "emergency-declare", "emergency-deactivate"]);
      const RL_LIMITS = { bulk: 12, emergency: 60, write: 600, read: 3000 };

      const capFor = {
        admit: CAPS.QUEUE_ADD, list: CAPS.QUEUE_VIEW, vitals: CAPS.EMR_VITALS,
        /* The whole-consultation save. The route bar is deliberately the LOWEST capability that
         * means "this person has clinical business writing to a chart", the same reading break-glass
         * uses, because the composite endpoint carries whatever mix of pieces the caller is entitled
         * to - a nurse sending vitals alone must not be turned away at the door by a bar set for the
         * prescription she was never going to send. The real authority is per piece and lives in
         * _wardsynq/consultation.js, which resolves the actor once and refuses the entire save if
         * any single piece is outside their grant. A tighter bar here would be a false comfort: it
         * would narrow who may call, and change nothing about what anyone may write. */
        consultation: CAPS.EMR_VITALS,
        /* Approvals. ASKING for one is the lowest clinical bar - the prescriber who was just blocked
         * is the person who asks. GRANTING one is emr.treat, because the thing being approved is a
         * prescribing decision and the hospital named a consultant as the grantor. The rule that
         * actually protects this is neither of those: verification.js refuses to let the person who
         * asked be the person who grants, whatever capability they hold. */
        /* Purchasing. Ordering stock and booking it in is the pharmacy's own work, so it sits on
         * the capability the pharmacy already holds for dispensing rather than on any clinical one -
         * a doctor has no business raising a purchase order, and a storekeeper has none prescribing.
         * WHO APPROVES the order is a separate question answered by the approval chain, which will
         * not let whoever raised it also grant it. */
        /* Recording a death is a doctor's act - it is the clinical statement a certificate rests on,
         * and emr.treat is the capability that already means "may make clinical decisions about this
         * patient". Withdrawing one sits at the same bar deliberately: an error serious enough to
         * need a doctor to make is serious enough to need a doctor to take back. */
        /* Looking at the record behind a line on the timeline is READING THE CHART, and it is
         * gated exactly as reading the chart is. The record service applies the actor's own read
         * scope on top, so a role that may not read a type is refused there too - this route adds
         * no authority of its own and is not a side door around the governed store. */
        /* The safety inbox is READING the ward's charts, merged. Gated at emr.view, the same bar
         * every other chart read sits at - and the record service applies each reader's own grant
         * on top, so a patient a reader may not read never enters the list. The role filter inside
         * is an ORDERING convenience and never a permission: it can only narrow what the reader was
         * already entitled to see. */
        "safety-inbox": CAPS.EMR_VIEW,
        "record-detail": CAPS.EMR_VIEW,
        deceased: CAPS.EMR_TREAT, "deceased-correct": CAPS.EMR_TREAT,
        /* Contacts are the front desk's work, on the capability that registers a patient. Reading
         * them is emr.view: a nurse looking for somebody to ring must not need prescribing rights. */
        "related-person": CAPS.QUEUE_ADD, "related-person-remove": CAPS.QUEUE_ADD,
        "related-people": CAPS.EMR_VIEW,
        "purchase-orders": CAPS.ORDER_DISPENSE, "purchase-order": CAPS.ORDER_DISPENSE,
        "goods-receive": CAPS.ORDER_DISPENSE,
        "approval-request": CAPS.EMR_VITALS, approvals: CAPS.EMR_VIEW,
        "approval-decide": CAPS.EMR_TREAT,
        "medication-order": CAPS.EMR_TREAT, round: CAPS.QUEUE_VIEW, mar: CAPS.MED_ADMINISTER,
        // Reading what is due is reading the ward, not acting on it: the same view capability the
        // ward list uses. Nothing here writes, so this grants no ability to move a dose.
        schedule: CAPS.QUEUE_VIEW,
        // The chart's own timeline: the same governed read every one of its sections already uses,
        // just merged and ordered. Seeing it is emr.view, same as flowsheet/criticals — it writes
        // nothing and grants no new authority over the chart.
        timeline: CAPS.EMR_VIEW,
        /* Critical results. SEEING the list is emr.view - a ward that cannot see its open critical
         * results is the failure this whole path exists to prevent, so it is not gated behind the
         * authority to act. ACKNOWLEDGING is emr.treat: it is a clinical decision recorded against a
         * named clinician, and the store enforces the write scope independently. */
        criticals: CAPS.EMR_VIEW, acknowledge: CAPS.EMR_TREAT, "flag-critical": CAPS.EMR_TREAT,
        // Moving a patient between beds is the same administrative act as admitting them to one.
        transfer: CAPS.QUEUE_ADD, beds: CAPS.QUEUE_VIEW,
        /* Emergency department. Arrival is the same administrative act as admit (queue.add) - it
         * opens a visit, it does not treat one. Triage acuity is the nurse's own record, the same
         * authority as vitals. Disposition closes the visit - the SAME capability discharge already
         * uses below (queue.add) - whether that closing is a discharge home or, via "admitted",
         * a hand-off into admitPatient(), which itself needs only queue.add too. */
        "ed-arrival": CAPS.QUEUE_ADD, "ed-triage": CAPS.EMR_VITALS, "ed-disposition": CAPS.QUEUE_ADD,
        "ed-list": CAPS.QUEUE_VIEW,
        /* Resuscitation bundles. Starting one is "a clinical commitment" (wardsynq-emergency.js's own
         * words) - emr.treat. Reading a running bundle's status is emr.view, the same as the chart
         * it hangs off. */
        "resus-start": CAPS.EMR_TREAT, "resus-mark": CAPS.EMR_TREAT, "resus-waive": CAPS.EMR_TREAT,
        "resus-void": CAPS.EMR_TREAT, resus: CAPS.EMR_VIEW,
        /* ICU device association (HAZ-DEV-01). Scanning a wristband and an asset tag onto each other
         * is the nurse's own bedside act, the same authority as charting a vital - emr.vitals, the
         * same capability that governs everything else DeviceAssociation is granted through
         * (VITALS_TYPES in actor.js). A reading is the same act repeated by the device's own gateway. */
        "device-associate": CAPS.EMR_VITALS, "device-dissociate": CAPS.EMR_VITALS,
        // TASK 6.14: a wristband/QR/NFC tag is the same bedside act as a device association -
        // assign/verify/replace/deactivate/lost/log all EMR_VITALS, same as device-* above.
        "tag-assign": CAPS.EMR_VITALS, "tag-verify": CAPS.EMR_VITALS, "tag-replace": CAPS.EMR_VITALS,
        "tag-deactivate": CAPS.EMR_VITALS, "tag-lost": CAPS.EMR_VITALS, "tag-log": CAPS.EMR_VITALS,
        "device-ingest": CAPS.EMR_VITALS, "device-status": CAPS.EMR_VIEW, "device-list": CAPS.EMR_VIEW,
        /* The WHO checklist gate (Task 2.3). Every write here is "a clinical commitment" in the same
         * sense wardsynq-emergency.js's own resus bundle already is - emr.treat, unrestricted.
         * Reading a case, an anaesthesia record or an implant log is emr.view, the same as the
         * chart they hang off. */
        "surgery-book": CAPS.EMR_TREAT, "surgery-consent": CAPS.EMR_TREAT, "surgery-marksite": CAPS.EMR_TREAT,
        "surgery-signin": CAPS.EMR_TREAT, "surgery-timeout": CAPS.EMR_TREAT, "surgery-incise": CAPS.EMR_TREAT,
        "surgery-signout": CAPS.EMR_TREAT, "surgery-abandon": CAPS.EMR_TREAT, "surgery-note": CAPS.EMR_TREAT,
        "surgery-disposition": CAPS.EMR_TREAT, "surgery-get": CAPS.EMR_VIEW, "surgery-list": CAPS.EMR_VIEW,
        "surgery-board": CAPS.EMR_VIEW,
        "anesthesia-start": CAPS.EMR_TREAT, "anesthesia-event": CAPS.EMR_TREAT, "anesthesia-end": CAPS.EMR_TREAT,
        "anesthesia-get": CAPS.EMR_VIEW, implant: CAPS.EMR_TREAT, "implant-list": CAPS.EMR_VIEW,
        /* Maternity (Task 2.4). Antenatal history, delivery and newborn linkage are clinical
         * commitments the same way a resus bundle or a surgical checklist step is - emr.treat. A
         * partogram observation is the midwife's own bedside charting - emr.vitals, the same
         * authority as a vital sign (VITALS_TYPES/writeCategories "labour" in actor.js). Reading any
         * of it is emr.view, the same as the rest of the chart. */
        pregnancy: CAPS.EMR_TREAT, "pregnancy-get": CAPS.EMR_VIEW, "maternity-status": CAPS.EMR_VIEW, meows: CAPS.EMR_VIEW,
        labour: CAPS.EMR_VITALS, "blood-loss": CAPS.EMR_VITALS, "blood-loss-list": CAPS.EMR_VIEW,
        delivery: CAPS.EMR_TREAT, "delivery-get": CAPS.EMR_VIEW,
        newborn: CAPS.EMR_TREAT, "family-links": CAPS.EMR_VIEW,
        /* Pediatrics/NICU (Task 2.5). weight-rate/dose-ceiling/age-band are read-only calculators -
         * emr.view, the same authority as reading the chart they help interpret; they persist
         * nothing. A neonatal respiratory/device-settings reading is the same bedside charting act
         * as a vital sign - emr.vitals. A line is a clinical commitment, the same authority
         * migrate-surgery.js's ImplantRecord already uses - emr.treat. */
        "weight-rate": CAPS.EMR_VIEW, "dose-ceiling": CAPS.EMR_VIEW, "age-band": CAPS.EMR_VIEW,
        neonatal: CAPS.EMR_VITALS, line: CAPS.EMR_TREAT, "line-remove": CAPS.EMR_TREAT, "line-list": CAPS.EMR_VIEW,
        /* The ONCqis bridge (Task 2.6). Linking a plan, recording the oncology diagnosis, an
         * adverse event or a chemo administration are all clinical commitments - emr.treat, the
         * same authority every other cross-module link in this file already needs. Reading any of
         * it is emr.view, the same as the rest of the chart. */
        "onco-link": CAPS.EMR_TREAT, "onco-link-get": CAPS.EMR_VIEW, "onco-diagnosis": CAPS.EMR_TREAT,
        "onco-ae": CAPS.EMR_TREAT, "onco-ae-list": CAPS.EMR_VIEW,
        "onco-chemo": CAPS.EMR_TREAT, "onco-chemo-list": CAPS.EMR_VIEW, "onco-timeline": CAPS.EMR_VIEW,
        "cardio-link": CAPS.EMR_TREAT, "cardio-link-get": CAPS.EMR_VIEW, "cardio-ecg": CAPS.EMR_TREAT,
        "cardio-ecg-list": CAPS.EMR_VIEW, "cardio-timeline": CAPS.EMR_VIEW,
        // TASK 3.5: role separation between blood-bank crossmatch/issue and ward-side bedside
        // administration is NOT implemented here - every stage rides the same emr.treat capability
        // every other "clinical commitment" resource in this file uses, stated explicitly rather
        // than decided unilaterally (see migrate-transfusion.js's own header).
        "transfusion-request": CAPS.EMR_TREAT, "transfusion-crossmatch": CAPS.EMR_TREAT,
        "transfusion-issue": CAPS.EMR_TREAT, "transfusion-bedside-check": CAPS.EMR_TREAT,
        "transfusion-start": CAPS.EMR_TREAT, "transfusion-observe": CAPS.EMR_TREAT,
        "transfusion-reaction": CAPS.EMR_TREAT, "transfusion-complete": CAPS.EMR_TREAT,
        "transfusion-queue": CAPS.EMR_VIEW, "transfusion-trace": CAPS.EMR_VIEW,
        // Charting fluid is the nurse's own record, the same authority as recording a vital.
        fluid: CAPS.EMR_VITALS, balance: CAPS.EMR_VIEW,
        // Handing a patient over is the clinical account of a shift: the same authority as recording
        // a vital, because it is the nurse's own record of their own patients.
        handover: CAPS.EMR_VITALS, "receive-handover": CAPS.EMR_VITALS, handovers: CAPS.EMR_VIEW,
        /* Pharmacy verification is its OWN authority now, not borrowed from the nurse's. The queue
         * is readable by the same capability, because a pharmacist with no way to SEE the orders
         * cannot verify them - which is what made this impossible to do honestly before. */
        "verify-order": CAPS.ORDER_VERIFY, "verification-queue": CAPS.ORDER_VERIFY,
        /* Issuing stock is the same pharmacy authority as verifying. It is NOT med.administer, and
         * that separation is the point: this writes a supply record and never an administration. */
        dispense: CAPS.ORDER_VERIFY, "dispense-return": CAPS.ORDER_VERIFY, dispenses: CAPS.ORDER_VERIFY,
        /* Break-glass. ONLY A CLINICIAN may declare one: emr.vitals is the lowest capability that
         * means "this person has clinical business with patients", which a cashier or an HR user
         * does not hold. It widens what a clinician may SEE in an emergency; it never turns a
         * non-clinician into one. The list is deliberately readable by any clinical role - the whole
         * value of break-glass is that the ward can see it happened, not only an administrator. */
        "break-glass": CAPS.EMR_VITALS, "emergency-chart": CAPS.EMR_VITALS, "break-glass-log": CAPS.EMR_VITALS,
        // TASK 4.15: declaring/deactivating a hospital emergency is EMERGENCY_DECLARE only - never
        // the broader emr.vitals break-glass rides on above, which is a per-patient clinical read,
        // not a governance act. Status/log are EMR_VIEW - the same visibility tier ward-metrics and
        // cosign-queue already use, so most clinical roles see a live emergency banner.
        "emergency-declare": CAPS.EMERGENCY_DECLARE, "emergency-deactivate": CAPS.EMERGENCY_DECLARE,
        "emergency-status": CAPS.EMR_VIEW, "emergency-log": CAPS.EMR_VIEW,
        "emergency-reconciliation": CAPS.EMERGENCY_DECLARE,
        // TASK 5.14: filing an incident is broad (INCIDENT_REPORT); triage/RCA/CAPA/close and the
        // ledger itself are INCIDENT_INVESTIGATE (safety_officer/admin) - the same split
        // EMERGENCY_DECLARE's declare/deactivate hold over one shared resource scope.
        "incident-report": CAPS.INCIDENT_REPORT,
        "incident-triage": CAPS.INCIDENT_INVESTIGATE, "incident-rca": CAPS.INCIDENT_INVESTIGATE,
        "incident-capa": CAPS.INCIDENT_INVESTIGATE, "incident-capa-complete": CAPS.INCIDENT_INVESTIGATE,
        "incident-close": CAPS.INCIDENT_INVESTIGATE, "incident-log": CAPS.INCIDENT_INVESTIGATE,
        /* The FHIR export. emr.view because it renders the chart: exporting a record is reading it,
         * and an export door that was easier to open than the chart itself would be the way around
         * every other control on this file. The record service still applies the actor's own read
         * scope on top, so the bundle contains only what that clinician could already see. */
        fhir: CAPS.EMR_VIEW,
        // What another system sent that WardSynQ would not write without a person deciding.
        "fhir-exceptions": CAPS.EMR_VIEW,
        // TASK 7 STEP 1: who WardSynQ believes when a feed says who it is. staff.admin, the same
        // capability that manages the staff->role mapping - registering a trusted source system is
        // exactly that kind of hospital-administration act, never a clinical one.
        "source-grant": CAPS.STAFF_ADMIN, "source-revoke": CAPS.STAFF_ADMIN, "source-grants": CAPS.STAFF_ADMIN,
        /* TASK 7.4: the outbound side. ALL of it is staff.admin, including the send itself. Deciding
         * that a chart leaves this building for another organisation is an administrative and
         * information-governance act, not a bedside one - a clinician who can read a record has no
         * authority to transmit it elsewhere, and an outbound door that opened at emr.view would be
         * the easiest way around every disclosure control in this file. */
        "outbound-destination": CAPS.STAFF_ADMIN, "outbound-destination-revoke": CAPS.STAFF_ADMIN,
        "outbound-destinations": CAPS.STAFF_ADMIN, "outbound-send": CAPS.STAFF_ADMIN,
        "outbound-dispatch": CAPS.STAFF_ADMIN, "outbound": CAPS.STAFF_ADMIN, "outbound-replay": CAPS.STAFF_ADMIN,
        hl7: CAPS.EMR_TREAT,
        /* DECIDING is emr.treat: "this is the same person" and "the feed's version replaces ours"
         * are clinical judgements about a chart, and they are recorded under the decider's name. */
        "fhir-exception-resolve": CAPS.EMR_TREAT,
        "smart-launch": CAPS.EMR_VIEW,
        /* Taking a medicines history is a nurse-or-pharmacist act (emr.vitals covers the ward
         * staff who do it). DECIDING what happens to a home medicine is prescribing-adjacent and
         * belongs to the treating clinician, so it is emr.treat. */
        "med-history": CAPS.EMR_VITALS, "med-decide": CAPS.EMR_TREAT, "med-reconciliation": CAPS.EMR_VIEW,
        // What is outstanding on the ward. A count of open items, naming no patient except on the
        // oldest unacknowledged critical result - so it is readable by the ward, at emr.view.
        metrics: CAPS.EMR_VIEW, "patient-flow": CAPS.EMR_VIEW,
        /* TASK 10: the Hospital Digital Twin. Reads exactly what patient-flow/metrics/emergency-
         * status/etc already gate at EMR_VIEW - the twin composes their answers, so it never needs a
         * broader cap than the narrowest section it fuses. Reconstruction reads deep version history
         * across the whole tenant, which is the same forensic-reach reasoning backup.js's own
         * STAFF_ADMIN gate uses, so it is gated a step higher than a live read. The Copilot and agent
         * routes write nothing clinical (a TwinInteraction and a draft list respectively) and stay at
         * EMR_VIEW for the same reason MaiK's own patient-facing routes do: reading is the bar, the
         * write it produces is scoped by a dedicated service actor, not by the asker's own grant. */
        twin: CAPS.EMR_VIEW, "twin-reconstruct": CAPS.STAFF_ADMIN, "twin-predict": CAPS.EMR_VIEW,
        /* TASK 10 observability pass: the health report reads across MaiKInteraction and
         * BreakGlassGrant rosters tenant-wide, the same forensic reach twin-reconstruct's own
         * STAFF_ADMIN gate exists for - never a clinical read, so never EMR_VIEW. */
        "operational-health": CAPS.STAFF_ADMIN,
        "twin-simulate": CAPS.EMR_VIEW, "twin-copilot": CAPS.EMR_VIEW, "twin-review": CAPS.EMR_VIEW,
        "twin-agent-queue": CAPS.EMR_VIEW,
        // TASK 4.12: hospital reports. Patient-flow/clinical-operations ride the same emr.view as the
        // live queues they wrap. Billing/claims/pharmacy/HIM report at the same capability their own
        // live routes already require - a report is not a way to read what the underlying route
        // itself refuses.
        "report-patient-flow": CAPS.EMR_VIEW, "report-clinical-operations": CAPS.EMR_VIEW,
        "report-billing": CAPS.BILLING_VIEW, "report-claims": CAPS.BILLING_VIEW,
        "report-pharmacy": CAPS.ORDER_DISPENSE, "report-him": CAPS.STAFF_ADMIN,
        // The laboratory. Its own authority: releasing a result is not treating a patient.
        "release-result": CAPS.LAB_RESULT, "pending-tests": CAPS.LAB_RESULT,
        /* Resolving identity is the registration authority, not a clinical one: it is the same act
         * as creating the record in the first place. Reading who a patient is needs only emr.view -
         * a clinician who followed a link to a merged record must be told where the chart went. */
        merge: CAPS.QUEUE_ADD, unmerge: CAPS.QUEUE_ADD, identity: CAPS.EMR_VIEW,
        /* Which safety rules are being overridden. Per RULE, never per clinician - see
         * override-analytics.js. Readable by any clinician, because the people the rules fire at
         * are the ones best placed to say a rule is wrong. */
        overrides: CAPS.EMR_VIEW,
        /* Order sets. Seeing what a set WOULD order is emr.view; preparing and recording an
         * application is emr.treat, because applying a set is ordering. The set itself writes no
         * order - every request still goes through the ordinary ordering route. */
        "order-sets": CAPS.EMR_VIEW, "prepare-set": CAPS.EMR_TREAT, "applied-set": CAPS.EMR_TREAT,
        /* Consent. Taking one is ward-staff work - a nurse witnesses and records what a patient
         * agreed to - so emr.vitals, the same authority as the rest of what she records. Reading is
         * emr.view: a refusal nobody can see is a refusal that gets asked again. */
        consent: CAPS.EMR_VITALS, "withdraw-consent": CAPS.EMR_VITALS, consents: CAPS.EMR_VIEW,
        /* The diary is the front desk's: booking, cancelling and marking arrival are the same
         * administrative act as registering a walk-in. PROMISING a follow-up is clinical - it is a
         * decision that the patient needs to be seen again - so that one is emr.treat. */
        book: CAPS.QUEUE_ADD, appointment: CAPS.QUEUE_ADD, schedule_: CAPS.QUEUE_VIEW,
        "follow-up": CAPS.EMR_TREAT, diary: CAPS.QUEUE_VIEW,
        /* The care plan is nursing work: setting goals and recording whether they were met is what
         * a nurse does all shift, so emr.vitals. Reading it is emr.view. */
        "care-plan": CAPS.EMR_VITALS, progress: CAPS.EMR_VITALS, plan: CAPS.EMR_VIEW,
        // Writing a clinical note from a template is authoring a clinical document: emr.treat.
        templates: CAPS.EMR_VIEW, "note": CAPS.EMR_TREAT,
        /* Signing and co-signing are the same act and the same capability: what separates them is
         * the actor's registration, which the store checks, not a capability a hospital can grant. */
        "note-submit": CAPS.EMR_TREAT, "note-sign": CAPS.EMR_TREAT, "cosign-queue": CAPS.EMR_VIEW,
        "completion-queue": CAPS.EMR_VIEW,
        /* The downtime pack is the whole ward's chart on one sheet, so it needs the authority to read
         * a chart - not the lower bar that opens the bed list. It writes nothing. */
        downtime: CAPS.EMR_VIEW,
        // Measures about the system, naming no clinician. Readable by anyone who can read a chart,
        // for the same reason the override report is: the people the machinery acts on can see it.
        quality: CAPS.EMR_VIEW,
        /* A registry NAMES PATIENTS beside their diagnoses - chart-level PHI, and exactly what a
         * browsing incident looks like. So it needs the authority to read a chart, not the lower bar
         * that opens a ward list. quality.js, which names nobody, sits at the same level because it
         * cannot go lower; this one could not go lower even if it wanted to. */
        registries: CAPS.EMR_VIEW,
        /* Taking a sample is nursing work, the same authority as recording a vital. The outcome
         * falls back to lab.result above, because the laboratory is the half that receives it. */
        collect: CAPS.EMR_VITALS, "specimen-outcome": CAPS.EMR_VITALS, collections: CAPS.EMR_VIEW,
        // Asking for an investigation is a clinical act, like prescribing.
        investigation: CAPS.EMR_TREAT,
        /* Reporting an imaging study is the radiologist's own act, granted by lab.result - the same
         * authority the laboratory reports under. A reporter is a reporter, and it writes only its
         * own report. */
        "report-imaging": CAPS.LAB_RESULT,
        /* Protocolling is the radiology department's own act, the same authority that reports the
         * study. It decides whether contrast is given, so it is emphatically not the ward's. */
        "protocol-context": CAPS.LAB_RESULT, "protocol-set": CAPS.LAB_RESULT,
        /* TASK 7.7: the modality worklist - what the scanner is being asked to do today.
         *
         * emr.view, NOT lab.result, and the reason matters. A worklist item is patient demographics
         * (name, id, date of birth, sex) beside a requested procedure, and emr.view is exactly the
         * capability that already reads those. lab.result would have looked stricter and been
         * broken: the laboratory grant deliberately cannot read Patient at all ("and never reads the
         * chart", pinned in the role-mapping test), and a worklist with no identity on it is worse
         * than no worklist. Widening the lab grant to make this work would have overturned a
         * considered boundary for the convenience of one feature, so it was not done. */
        "imaging-worklist": CAPS.EMR_VIEW,
        /* TASK 8. ASKING reads the chart and writes no clinical content, so it is emr.view - the same
         * capability that reads the record it summarises, and no wider. REVIEWING is emr.treat:
         * accepting a drafted note puts an unsigned note on the chart, which is a clinical act, and
         * the AI actor it writes as is capped to no wider than the reviewer's own scope. */
        "maik-ask": CAPS.EMR_VIEW, "maik-interactions": CAPS.EMR_VIEW, "maik-review": CAPS.EMR_TREAT,
        /* TASK 8.9. Explaining a safety verdict reads the order, the allergy list and the medicines -
         * the same chart emr.view already reads - and writes no clinical content. It is deliberately
         * NOT gated higher than the deterministic screens that show the same verdict: a control that
         * makes the explanation harder to reach than the finding it explains would push clinicians
         * back to the terser screen, which is the opposite of the intent. */
        "maik-explain-safety": CAPS.EMR_VIEW,
        /* TASK 8.10. Configuration status: which providers are reachable and which may receive
         * patient data. It returns no credential and no fingerprint of one, so emr.view is the right
         * bar - the people who need to know whether MaiK is actually on are the ones using it. */
        "maik-status": CAPS.EMR_VIEW,
        // Charting a pump is the bedside's act, exactly like giving a dose.
        infusion: CAPS.MED_ADMINISTER, infusions: CAPS.EMR_VIEW,
        // Charting a wound is nursing work, the same authority as a vital or a fluid entry.
        wound: CAPS.EMR_VITALS, wounds: CAPS.EMR_VIEW,
        // Reading the flowsheet is reading the chart. It writes nothing.
        flowsheet: CAPS.EMR_VIEW,
        /* An early warning score is a reading of the chart's own vitals. It writes nothing and
         * escalates nobody, so it needs the authority to read a chart and no more. */
        news2: CAPS.EMR_VIEW,
        /* Recording that a value was decisive is part of reading a chart, so it needs the authority
         * to read one - emr.vitals, the same bar as charting an observation about the patient.
         * Asking WHO to tell about a correction is emr.view: it is the safety question, and the
         * people who have to make the calls must be able to ask it. */
        read: CAPS.EMR_VITALS, readers: CAPS.EMR_VIEW,
        /* Billing. Coding a claim and moving it through its lifecycle is billing.charge - the
         * cashier's own capability, deliberately NOT a clinical one: the whole point of
         * wardsynq-billing.js is that the money never gets a write path to the chart, and giving a
         * coder an EMR capability to reach these routes would have handed them exactly that.
         *
         * Reading a patient's claims is billing.view. The upcoding watchlist is STAFF_ADMIN, because
         * the module's own instruction is that it is checked "by somebody who is not paid on
         * collections" - and billing.view is precisely the person who is. */
        claim: CAPS.BILLING_CHARGE, "claim-state": CAPS.BILLING_CHARGE, preauth: CAPS.BILLING_CHARGE,
        claims: CAPS.BILLING_VIEW, upcoding: CAPS.STAFF_ADMIN,
        // TASK 4.9: a third-party record request is a records-custody function, not clinical or
        // billing work - staff.admin, the same authority every other org-administration action in
        // this file already uses, pending a real site adding a dedicated HIM role.
        "roi-request": CAPS.STAFF_ADMIN, "roi-authorize": CAPS.STAFF_ADMIN, "roi-deny": CAPS.STAFF_ADMIN,
        "roi-cancel": CAPS.STAFF_ADMIN, "roi-fulfill": CAPS.STAFF_ADMIN, roi: CAPS.STAFF_ADMIN, "roi-requests": CAPS.STAFF_ADMIN,
        /* Charge capture reads what was DONE and proposes nothing binding, so it sits with the rest
         * of coding at billing.charge. It writes nothing at all - not even a Claim. */
        charges: CAPS.BILLING_CHARGE,
        // TASK 4.6: raising an invoice and posting a financial event against it is billing.charge,
        // the same authority as coding a claim. Reading it (a balance, a reconciliation footing) is
        // billing.view - the actual reason that capability exists, per the note above.
        invoice: method === "POST" ? CAPS.BILLING_CHARGE : CAPS.BILLING_VIEW, "invoice-discount": CAPS.BILLING_CHARGE, "invoice-deposit": CAPS.BILLING_CHARGE,
        "invoice-payment": CAPS.BILLING_CHARGE, "invoice-refund": CAPS.BILLING_CHARGE, "invoice-adjustment": CAPS.BILLING_CHARGE,
        "invoice-writeoff": CAPS.BILLING_CHARGE, "invoice-void": CAPS.BILLING_CHARGE,
        invoices: CAPS.BILLING_VIEW,
        /* Stock control is the dispensing side of pharmacy. Nothing behind these routes can refuse a
         * dispense: a count is a belief and the box in the pharmacist's hand is the fact. */
        "stock-move": CAPS.ORDER_DISPENSE, stock: CAPS.ORDER_DISPENSE, "stock-reconcile": CAPS.ORDER_DISPENSE,
        /* Asking "is this person already here" is the front desk's work, and it is the same
         * authority that registers them - QUEUE_ADD. It proposes candidates and can link nothing:
         * a merge is a separate, human, retractable claim through its own route. */
        "id-match": CAPS.QUEUE_ADD,
        /* The patient's own copy. Seeing what the patient WOULD be given is reading the chart, so
         * emr.view. HANDING IT OVER IS EMR_TREAT: deciding a patient is ready to be told what is in
         * their record is a clinical act, not a clerical one, and the person who does it has to be
         * the person who can answer the questions it produces. */
        "patient-copy": CAPS.EMR_VIEW, "patient-release": CAPS.EMR_TREAT,
        /* Enrolling a patient for their own access, and ending it. EMR_TREAT: enrolment is where the
         * whole chain of trust is established and it happens with the patient in front of you, which
         * is the same bar as deciding they are ready to be told what is in their record. The
         * patient's own two routes are NOT here - they live under /api/portal, outside the block
         * that assumes an employee. */
        "patient-enrol": CAPS.EMR_TREAT, "patient-revoke": CAPS.EMR_TREAT,
        /* The patient message worklist is readable by any clinician - an unanswered message is a
         * ward-level safety fact, not one doctor's inbox. ANSWERING is EMR_TREAT: replying to a
         * patient's clinical question is a clinical act, and nothing non-human can reach it. */
        "patient-messages": CAPS.EMR_VIEW, "patient-reply": CAPS.EMR_TREAT,
        /* The analytics extract is meant to LEAVE the building, which is a different act from
         * reading a ward's own measures. analytics.view, not emr.view: the person who takes numbers
         * out is not automatically every clinician who can open a chart. It names no patient. */
        "analytics-extract": CAPS.ANALYTICS_VIEW,
        /* Authoring the hospital's own advisories is an administrative act by whoever owns the
         * configuration, not a clinical one - and the check writes nothing and activates nothing. */
        "advisory-check": CAPS.STAFF_ADMIN,
        /* THE BACKUP EXPORT HANDS OVER AN ENTIRE HOSPITAL. It deliberately bypasses the per-actor
         * read scoping every other route obeys, because a backup filtered by somebody's permissions
         * restores into a chart with holes in it. So no clinical capability reaches it at any dose:
         * it is STAFF_ADMIN, the person who owns the deployment, and every page is audited. */
        backup: CAPS.STAFF_ADMIN, "backup-status": CAPS.STAFF_ADMIN,
        // ADT out. Reading a stay in another wire format is still reading a chart, so it needs the
        // authority to read one. It writes nothing and there is no inbound listener.
        adt: CAPS.EMR_VIEW, oru: CAPS.EMR_VIEW, cda: CAPS.EMR_VIEW,
        /* Putting somebody on the waiting list is the same administrative act as admitting them to a
         * bed - the front desk's work. It reserves nothing and admits nobody. */
        "request-admission": CAPS.QUEUE_ADD, "close-admission-request": CAPS.QUEUE_ADD, "waiting-list": CAPS.QUEUE_VIEW,
        // Booking a room is the front desk's act, the same authority as booking an appointment.
        "book-resource": CAPS.QUEUE_ADD, "resource-state": CAPS.QUEUE_ADD, "resource-schedule": CAPS.QUEUE_VIEW,
        // TASK 4.5: blocking a diary or a resource for a period is the SAME front-desk scheduling
        // authority as booking/cancelling one - not a clinical decision.
        "block-period": CAPS.QUEUE_ADD, "cancel-blackout": CAPS.QUEUE_ADD, blackouts: CAPS.QUEUE_VIEW,
        // Risk assessment is nursing work, like the rest of the flowsheet.
        "risk-tools": CAPS.EMR_VIEW, assess: CAPS.EMR_VITALS, "risk-action": CAPS.EMR_VITALS, risks: CAPS.EMR_VIEW,
        /* Sending a prescription is part of prescribing, so queueing is emr.treat. Recording what
         * the transport said, and resolving a failure by printing it instead, is desk work. */
        transmit: CAPS.EMR_TREAT, "transmit-send": CAPS.QUEUE_ADD, "transmit-outcome": CAPS.QUEUE_ADD, "transmit-resolve": CAPS.QUEUE_ADD, outbox: CAPS.QUEUE_VIEW,
        // Closing a stay is the administrative act QUEUE_ADD already covers for opening one.
        // The summary is a clinical document: drafting and signing it are EMR_TREAT.
        discharge: CAPS.QUEUE_ADD, "discharge-summary": CAPS.EMR_TREAT, "sign-discharge-summary": CAPS.EMR_TREAT,
        // Asserting a diagnosis is a clinical act; reading the list is not.
        problem: CAPS.EMR_TREAT, problems: CAPS.EMR_VIEW,
      };
      /* Every eMAR transition needs MED_ADMINISTER, including verify and dispense.
       *
       * Those two are a pharmacist's act in a hospital with a unit-dose pharmacy, and ORDER_DISPENSE
       * exists for exactly that person. It is NOT used here, and the reason is worth stating: verify
       * and dispense WRITE the MedicationAdministration record, so granting them to ORDER_DISPENSE
       * would mean granting the pharmacy role write access to that resource - and a role that can
       * write it through the raw record API could post a fabricated "administered" row without ever
       * going near a bedside. The ward-stock model, where the nurse holding the dose walks it
       * through its own states, needs no such grant. Pharmacy verification as a distinct authority
       * is a real feature and is deliberately left to a later pass with its own narrower grant. */
      /* READING the discharge summary is reading the chart; DRAFTING one authors a clinical
       * document. The same path is both, so the capability follows the method: a ward nurse can
       * open the summary and see what is still outstanding without being able to write it. */
      const need = sub === "mar" ? CAPS.MED_ADMINISTER
        : (sub === "discharge-summary" && method === "GET") ? CAPS.EMR_VIEW
        : capFor[sub];
      if (!need) return json({ ok: false, error: "not_found" }, 404, request);
      let wAz = await ORG.authorizeOrg(env, actor, wOrgId, need);
      // Set true only when the noteWriterRoles alternative authority below actually fires. Carried
      // to writeTemplatedNote's ctx so the record engine's own grant can be told the same thing the
      // route just decided - see that check's own comment for why the route's say-so alone is not
      // enough for the write to actually succeed.
      let noteWriterOverride = false;
      /* The open critical results are readable by a VERIFIER as well as by the ward. A pharmacist
       * checking a dose against the patient's potassium needs to see that potassium, and gating this
       * list on emr.view alone was the reason they could not - the gap this build closes. It is an
       * alternative authority, never a widening: order.verify grants the narrow record scope in
       * actor.js and nothing more, so this cannot open any other route. */
      /* WHO MAY DOCUMENT IS THE HOSPITAL'S DECISION, within a boundary it cannot move.
       *
       * Writing a note needs emr.treat, which is the PRESCRIBING capability, so out of the box only
       * prescribers document. On a great many real wards the nursing note is a core part of the
       * record, and the alternative - handing nurses emr.treat - would hand them prescribing too.
       * So the hospital names the roles it trusts to document (Admin Center -> noteWriterRoles) and
       * those roles may write a note and nothing else. The role still has to be a real member of
       * this hospital with emr.view; this is an alternative authority for ONE act, not a way to
       * grant a capability, and it cannot reach any other route.
       *
       * A hospital that sets nothing keeps today's behaviour exactly. */
      if (!wAz.ok && sub === "note" && method === "POST") {
        // The hospital's own config, read HERE rather than reusing wsqCfg: that is built further
        // down, after authorization, so reading it at this point would silently be undefined and
        // the setting would appear to do nothing.
        const noteOrg = await ORG.getOrg(env, wOrgId);
        const noteCfg = (noteOrg && noteOrg.wardsynq) || null;
        const allowed = (noteCfg && Array.isArray(noteCfg.noteWriterRoles) ? noteCfg.noteWriterRoles : []).map((r) => String(r || "").trim()).filter(Boolean);
        if (allowed.length) {
          const seeChart = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.EMR_VIEW);
          /* Passing THIS gate is not enough to actually write the note. authorizeOrg only opens
           * the route; the record engine (wardsynq-actors.js's GovernedStore) independently checks
           * the writer's own grant before it will commit anything, and a role admitted here purely
           * by noteWriterRoles (a nurse, say) has a grant built from emr.vitals alone, which has
           * never included ClinicalNote - so the write below was refused anyway (SCOPE_DENIED),
           * silently making this whole setting a no-op. noteWriterOverride carries the fact that
           * THIS route already verified the config exception down to writeTemplatedNote, which is
           * the only place allowed to act on it - see the comment on its own use in
           * note-templates.js's open(). */
          if (seeChart.ok && allowed.indexOf(String(seeChart.role || "")) >= 0) { wAz = seeChart; noteWriterOverride = true; }
        }
      }
      /* THE BENCH MAY SEE ITS OWN WORK. collections and pending-tests are gated emr.view, which is
       * right for a ward asking "where is my patient's sample?" - and wrong as the ONLY authority,
       * because the other caller is the laboratory itself, asking "what is on my bench?". The lab
       * role deliberately has no emr.view (dispensing and resulting need the order, not the
       * consultation notes), so the department's own worklist was the one thing it could not open.
       * lab.result is the alternative authority, exactly as order.verify is for criticals and
       * lab.result already is for specimen-outcome directly below. It grants the narrow record
       * scope in actor.js and nothing more, so this opens no other route. */
      if (!wAz.ok && (sub === "collections" || sub === "pending-tests")) wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.LAB_RESULT);
      if (!wAz.ok && sub === "criticals") wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.ORDER_VERIFY);
      /* A specimen's outcome is recorded by whichever side of the journey it happened on: the ward
       * says the attempt failed, the LABORATORY says it arrived. Same alternative-authority shape,
       * and the same reason it is not a widening - lab.result grants only the narrow record scope in
       * actor.js, so this opens no other route and the store still checks the write itself. */
      if (!wAz.ok && sub === "specimen-outcome") wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.LAB_RESULT);
      /* TASK 4.13: HIM_ROI is the new, narrow alternative to staff.admin for the ROI routes - the
       * `him` role holds HIM_ROI and not staff.admin, and this does not widen staff.admin's own
       * reach anywhere else. Same alternative-authority shape as criticals/specimen-outcome above. */
      if (!wAz.ok && ROI_SUBS.has(sub)) wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.HIM_ROI);
      /* TASK 4.13: TRANSFUSION_ISSUE is the new, narrow alternative to emr.treat for the transfusion
       * routes - the `blood_bank` role holds TRANSFUSION_ISSUE and none of the EMR capabilities, and
       * this does not narrow what emr.treat could already do. Same shape as the two checks above. */
      if (!wAz.ok && TRANSFUSION_SUBS.has(sub)) wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.TRANSFUSION_ISSUE);
      if (!wAz.ok) return json(azRefusal(wAz), wAz.reason === "org_not_found" ? 404 : 403, request);

      /* TASK 9.15/9.1: A THROTTLE ON THE CLINICAL DOOR, which had none.
       *
       * rate-limit.js was a good limiter wired to exactly two SMART endpoints. Every route under
       * /api/queue/ward/* was unthrottled - including GET /ward/backup, which reads the WHOLE
       * hospital's record, and GET /ward/downtime, which reads a whole ward. An authenticated
       * account could pull the entire record store in a loop, and nothing counted.
       *
       * THE LIMITS ARE ASYMMETRIC ON PURPOSE, AND THE ASYMMETRY IS THE SAFETY ARGUMENT. A limiter
       * that stops a nurse charting during an arrest is itself a patient-safety hazard, so the
       * clinical tiers sit far above any human rate and exist only to bound automation. The BULK
       * tier is tight, because whole-hospital reads are rare, deliberate, and the actual thing worth
       * rationing. Emergency declarations get their own tier: bounded against scripted abuse, and
       * generous enough that a real emergency is never the request that gets refused.
       *
       * Keyed by ACTOR AND ORG, never by IP - the caller is already authenticated here, and an IP
       * key would throttle a whole hospital behind one NAT. */
      const rlTier = RL_BULK.has(sub) ? "bulk"
        : RL_EMERGENCY.has(sub) ? "emergency"
        : method === "GET" ? "read" : "write";
      const rl = await rateHit(
        { binding: env && env.WSQ_RL, kv: env && env.MAIK_KV },
        { key: `wsq:${wOrgId}:${actor.id}:${rlTier}`, limit: RL_LIMITS[rlTier], windowMs: 60000 });
      if (!rl.allowed) {
        /* A refusal names the tier and the wait, because "429" on a ward screen with no further
         * information is indistinguishable from the system being broken. */
        return json({ ok: false, error: "rate_limited", tier: rlTier,
          retryAfterSeconds: rl.retryAfterSeconds,
          message: `Too many ${rlTier} requests from this account in one minute. This limit exists to bound automated abuse, not clinical work; if a clinical action was refused, that is a defect worth reporting.`,
          store: rl.store },
          429, request, { "Retry-After": String(rl.retryAfterSeconds) });
      }

      const wOrg = await ORG.getOrg(env, wOrgId);
      /* The hospital's own WardSynQ configuration: critical limits, round times, beds, order sets.
       * It is a NESTED object on the org because that projection is a whitelist - every one of
       * these was being read as a top-level field and arriving undefined, so a hospital that had
       * carefully set its own potassium limits was silently running on WardSynQ's defaults. See
       * wardsynqConfig() in _opd_org.js. */
      const wsqCfg = (wOrg && wOrg.wardsynq) || null;
      const mig = await wsqForcedMigration(env, wOrg);
      if (!mig) return json({ ok: false, error: "not_a_wardsynq_hospital", message: "The inpatient ward is only available for a WardSynQ-native hospital." }, 409, request);
      if (mig.error) return json({ ok: false, error: mig.error }, 409, request);
      const deps = { migration: mig, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId), orgId: wOrgId, wsqCfg };

      if (sub === "admit" && method === "POST") {
        const r = await admitPatient(request, env, { ...deps, admission: body.admission || body, emergencyOverride: body.emergencyOverride === true, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* ONE CONSULTATION, ONE CALL. The writers are handed in rather than imported by
       * consultation.js, so every piece goes through the exact function its own route has always
       * called - same validation, same governance, same audit, same org config (the formulary and
       * the advisories below are ORG content and must not become caller-supplied just because the
       * call arrived bundled). consultation.js decides order, does the up-front permission check
       * across all pieces, and reports honestly when a save lands in part. */
      if (sub === "safety-inbox" && method === "GET") {
        /* The roster comes from the ward list this router already serves - the inbox does not get a
         * second idea of who is on the ward, and a patient who is not on it is not scanned. */
        const roster = await listWard(request, env, { ...deps });
        if (!roster || !roster.ok) return json(roster || { ok: false, error: "ward_unavailable" }, (roster && roster.status) || 502, request);
        const r = await safetyInbox(request, env, {
          ...deps,
          patients: (roster.patients || roster.list || []).map((p) => ({ patientId: p.patientId, name: p.name, mrn: p.mrn, ward: p.ward, bed: p.bed })),
          rules: (wsqCfg && wsqCfg.chartCompletion) || null,
          criticalPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null,
          riskTools: (wsqCfg && wsqCfg.riskTools) || [],
          role: url.searchParams.get("role") || "",
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "record-detail" && method === "GET") {
        const r = await recordDetail(request, env, { ...deps, resourceType: url.searchParams.get("type") || "", recordId: url.searchParams.get("id") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "deceased" && method === "POST") {
        const r = await recordDeath(request, env, { ...deps, patientId: body.patientId, deceased: body.deceased || body, confirm: body.confirm === true, correct: body.correct === true, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "deceased-correct" && method === "POST") {
        const r = await correctDeath(request, env, { ...deps, patientId: body.patientId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "related-person" && method === "POST") {
        const r = await addRelatedPerson(request, env, { ...deps, patientId: body.patientId, person: body.person || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "related-person-remove" && method === "POST") {
        const r = await removeRelatedPerson(request, env, { ...deps, relatedPersonId: body.relatedPersonId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "related-people" && method === "GET") {
        const r = await listRelatedPeople(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "purchase-order" && method === "POST") {
        const r = await raisePurchaseOrder(request, env, { ...deps, vendor: body.vendor, lines: body.lines, note: body.note, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "goods-receive" && method === "POST") {
        const r = await receiveGoods(request, env, { ...deps, purchaseOrderId: body.purchaseOrderId, item: body.item, quantity: body.quantity, unit: body.unit, line: body.line, batch: body.batch, expiry: body.expiry, location: body.location, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "purchase-orders" && method === "GET") {
        const r = await listPurchaseOrders(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "approval-request" && method === "POST") {
        const r = await requestVerification(request, env, { ...deps, subjectType: body.subjectType, subjectId: body.subjectId, reason: body.reason, context: body.context, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "approval-decide" && method === "POST") {
        const r = await recordVerification(request, env, { ...deps, verificationId: body.verificationId, decision: body.decision, reason: body.reason, withdraws: body.withdraws, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "approvals" && method === "GET") {
        const r = await listVerifications(request, env, { ...deps, subjectId: url.searchParams.get("subjectId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "consultation" && method === "POST") {
        const cWriters = {
          vitals: (rq, ev, c) => recordWardVitals(rq, ev, { ...c, encounterId: c.encounterId, patientId: body.patientId, vitals: c.item,
            recordedAt: (c.item && c.item.recordedAt) || body.recordedAt,
            tempUnit: unitsFor(wOrg && wOrg.region).temp, weightUnit: unitsFor(wOrg && wOrg.region).weight,
            idempotencyKey: idemFor(body.idempotencyKey, "vitals", c.index) }),
          problems: (rq, ev, c) => recordProblem(rq, ev, { ...c, problem: c.item, idempotencyKey: idemFor(body.idempotencyKey, "problem", c.index) }),
          medications: (rq, ev, c) => createWardMedicationOrder(rq, ev, { ...c, order: c.item, safety: (c.item && c.item.safety) || null,
            formulary: (wsqCfg && wsqCfg.formulary) || null,
            advisories: (wsqCfg && wsqCfg.advisories) || null,
            ageYears: body.ageYears,
            requireReasonOffFormulary: !!(wsqCfg && wsqCfg.requireReasonOffFormulary),
            idempotencyKey: idemFor(body.idempotencyKey, "med", c.index) }),
          investigations: (rq, ev, c) => orderInvestigation(rq, ev, { ...c,
            code: c.item && c.item.code, display: c.item && c.item.display, codeSystem: c.item && c.item.codeSystem,
            category: c.item && c.item.category, priority: c.item && c.item.priority, reason: c.item && c.item.reason,
            idempotencyKey: idemFor(body.idempotencyKey, "inv", c.index) }),
          note: (rq, ev, c) => writeTemplatedNote(rq, ev, { ...c, templates: (wsqCfg && wsqCfg.noteTemplates) || [],
            templateId: c.item && c.item.templateId, sections: c.item && c.item.sections, at: c.item && c.item.at,
            idempotencyKey: idemFor(body.idempotencyKey, "note", c.index), noteWriterOverride }),
        };
        const r = await saveConsultation(request, env, { ...deps, body, encounterId: body.encounterId, writers: cWriters });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "list" && method === "GET") {
        const r = await listWard(request, env, { ...deps, ward: url.searchParams.get("ward") || "", region: (wOrg && wOrg.region) || "IN" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "ed-arrival" && method === "POST") {
        const r = await edArrival(request, env, { ...deps, arrival: body.arrival || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "ed-triage" && method === "POST") {
        const r = await recordEdTriage(request, env, { ...deps, encounterId: body.encounterId, acuity: body.acuity, chiefComplaint: body.chiefComplaint, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "ed-disposition" && method === "POST") {
        const r = await edDisposition(request, env, { ...deps, encounterId: body.encounterId, disposition: body.disposition, reason: body.reason, at: body.at, admission: body.admission, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "ed-list" && method === "GET") {
        const r = await listEd(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resus-start" && method === "POST") {
        const r = await startResusBundle(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, code: body.code, evidence: body.evidence, timeZero: body.timeZero, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resus-mark" && method === "POST") {
        const r = await markResusElement(request, env, { ...deps, bundleId: body.bundleId, key: body.key, event: body.event, at: body.at, detail: body.detail, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resus-waive" && method === "POST") {
        const r = await waiveResusElement(request, env, { ...deps, bundleId: body.bundleId, key: body.key, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resus-void" && method === "POST") {
        const r = await voidResusBundle(request, env, { ...deps, bundleId: body.bundleId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resus" && method === "GET") {
        const r = await listResusBundles(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "device-associate" && method === "POST") {
        const r = await deviceAssociate(request, env, { ...deps, association: body.association || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "device-dissociate" && method === "POST") {
        const r = await deviceDissociate(request, env, { ...deps, deviceId: body.deviceId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "device-ingest" && method === "POST") {
        const r = await deviceIngest(request, env, { ...deps, reading: body.reading || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "device-status" && method === "GET") {
        const r = await deviceStatus(request, env, { ...deps, deviceId: url.searchParams.get("deviceId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "device-list" && method === "GET") {
        const r = await deviceList(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-assign" && method === "POST") {
        const r = await assignPatientTag(request, env, { ...deps, patientId: body.patientId, tagType: body.tagType, code: body.code, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-verify" && method === "POST") {
        const r = await verifyPatientTag(request, env, { ...deps, patientId: body.patientId, tagType: body.tagType, scannedCode: body.scannedCode });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-replace" && method === "POST") {
        const r = await replacePatientTag(request, env, { ...deps, tagId: body.tagId, newCode: body.newCode, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-deactivate" && method === "POST") {
        const r = await deactivatePatientTag(request, env, { ...deps, tagId: body.tagId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-lost" && method === "POST") {
        const r = await reportPatientTagLost(request, env, { ...deps, tagId: body.tagId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "tag-log" && method === "GET") {
        const r = await patientTagLog(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-book" && method === "POST") {
        const r = await bookSurgicalCase(request, env, { ...deps, booking: body.booking || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-consent" && method === "POST") {
        const r = await recordCaseConsent(request, env, { ...deps, caseId: body.caseId, consent: body.consent, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-marksite" && method === "POST") {
        const r = await markCaseSite(request, env, { ...deps, caseId: body.caseId, marking: body.marking, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-signin" && method === "POST") {
        const r = await signInCase(request, env, { ...deps, caseId: body.caseId, submission: body.submission, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-timeout" && method === "POST") {
        const r = await timeOutCase(request, env, { ...deps, caseId: body.caseId, submission: body.submission, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-incise" && method === "POST") {
        const r = await inciseCase(request, env, { ...deps, caseId: body.caseId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-signout" && method === "POST") {
        const r = await signOutCase(request, env, { ...deps, caseId: body.caseId, submission: body.submission, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-abandon" && method === "POST") {
        const r = await abandonCase(request, env, { ...deps, caseId: body.caseId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-note" && method === "POST") {
        const r = await recordOperativeNote(request, env, { ...deps, caseId: body.caseId, note: body.note, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-disposition" && method === "POST") {
        const r = await dispositionCase(request, env, { ...deps, caseId: body.caseId, disposition: body.disposition, pacuBed: body.pacuBed, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-get" && method === "GET") {
        const r = await getSurgicalCase(request, env, { ...deps, caseId: url.searchParams.get("caseId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-list" && method === "GET") {
        const r = await listSurgicalCases(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "surgery-board" && method === "GET") {
        const r = await listOpenCases(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "anesthesia-start" && method === "POST") {
        const r = await startAnesthesia(request, env, { ...deps, caseId: body.caseId, asaClass: body.asaClass, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "anesthesia-event" && method === "POST") {
        const r = await recordAnesthesiaEvent(request, env, { ...deps, caseId: body.caseId, event: body.event, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "anesthesia-end" && method === "POST") {
        const r = await endAnesthesia(request, env, { ...deps, caseId: body.caseId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "anesthesia-get" && method === "GET") {
        const r = await getAnesthesia(request, env, { ...deps, caseId: url.searchParams.get("caseId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "implant" && method === "POST") {
        const r = await recordImplant(request, env, { ...deps, caseId: body.caseId, implant: body.implant, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "implant-list" && method === "GET") {
        const r = await listImplants(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", caseId: url.searchParams.get("caseId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "pregnancy" && method === "POST") {
        const r = await recordPregnancy(request, env, { ...deps, patientId: body.patientId, pregnancy: body.pregnancy || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "pregnancy-get" && method === "GET") {
        const r = await getPregnancy(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "maternity-status" && method === "GET") {
        const r = await maternityStatus(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "meows" && method === "GET") {
        const r = await maternityMeows(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "labour" && method === "POST") {
        const r = await recordLabourObservation(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, code: body.code, value: body.value, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "blood-loss" && method === "POST") {
        const r = await recordMaternalBloodLoss(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, loss: body.loss || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "blood-loss-list" && method === "GET") {
        const r = await listBloodLoss(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "delivery" && method === "POST") {
        const r = await recordDelivery(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, delivery: body.delivery || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "delivery-get" && method === "GET") {
        const r = await getDelivery(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "newborn" && method === "POST") {
        const r = await registerNewborn(request, env, { ...deps, motherPatientId: body.motherPatientId, encounterId: body.encounterId, sex: body.sex, name: body.name, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "family-links" && method === "GET") {
        const r = await listFamilyLinks(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "weight-rate" && method === "POST") {
        const r = await checkWeightBasedRate(request, env, { ...deps, dosePerKgPerMin: body.dosePerKgPerMin, weightKg: body.weightKg, concentrationMgPerMl: body.concentrationMgPerMl, patient: body.patient });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "dose-ceiling" && method === "POST") {
        const r = await checkPaediatricDoseCeiling(request, env, { ...deps, mgPerKg: body.mgPerKg, weightKg: body.weightKg, adultMaxMg: body.adultMaxMg, band: body.band });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "age-band" && method === "POST") {
        const r = await checkAgeBand(request, env, { ...deps, patient: body.patient, now: body.now });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "neonatal" && method === "POST") {
        const r = await recordNeonatalObservation(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, code: body.code, value: body.value, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "line" && method === "POST") {
        const r = await recordLine(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, line: body.line || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "line-remove" && method === "POST") {
        const r = await removeLine(request, env, { ...deps, lineId: body.lineId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "line-list" && method === "GET") {
        const r = await listLines(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-link" && method === "POST") {
        const r = await linkOncologyPlan(request, env, { ...deps, encounterId: body.encounterId, plan: body.plan || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-link-get" && method === "GET") {
        const r = await getOncologyLink(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-diagnosis" && method === "POST") {
        const r = await recordOncologyDiagnosis(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, condition: body.condition, staging: body.staging, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-ae" && method === "POST") {
        const r = await recordAdverseEvent(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, oncoPlanId: body.oncoPlanId, event: body.event, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-ae-list" && method === "GET") {
        const r = await listAdverseEvents(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-chemo" && method === "POST") {
        const r = await recordChemoAdministration(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, oncoPlanId: body.oncoPlanId, cycleId: body.cycleId, admin: body.admin || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-chemo-list" && method === "GET") {
        const r = await listChemoAdministrations(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "onco-timeline" && method === "GET") {
        const r = await oncologyTimeline(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cardio-link" && method === "POST") {
        const r = await linkCardiologyRecord(request, env, { ...deps, encounterId: body.encounterId, link: body.link || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cardio-link-get" && method === "GET") {
        const r = await getCardiologyLink(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cardio-ecg" && method === "POST") {
        const r = await recordEcgReference(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, ecg: body.ecg || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cardio-ecg-list" && method === "GET") {
        const r = await listEcgReferences(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cardio-timeline" && method === "GET") {
        const r = await cardiologyTimeline(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-request" && method === "POST") {
        const r = await requestTransfusion(request, env, { ...deps, mrn: body.mrn, patientId: body.patientId, encounterId: body.encounterId, component: body.component, units: body.units, indication: body.indication, aboGroup: body.aboGroup, rhD: body.rhD, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-crossmatch" && method === "POST") {
        const r = await recordCrossmatch(request, env, { ...deps, episodeId: body.episodeId, unitId: body.unitId, aboGroup: body.aboGroup, rhD: body.rhD, component: body.component, expiresAt: body.expiresAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-issue" && method === "POST") {
        const r = await issueUnit(request, env, { ...deps, episodeId: body.episodeId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-bedside-check" && method === "POST") {
        const r = await recordBedsideCheck(request, env, { ...deps, episodeId: body.episodeId, checkerId: body.checkerId, secondCheckerId: body.secondCheckerId, scannedPatientBarcode: body.scannedPatientBarcode, scannedUnitId: body.scannedUnitId, patient: body.patient, unitInHand: body.unitInHand, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-start" && method === "POST") {
        const r = await startTransfusion(request, env, { ...deps, episodeId: body.episodeId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-observe" && method === "POST") {
        const r = await recordTransfusionObservation(request, env, { ...deps, episodeId: body.episodeId, vitals: body.vitals, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-reaction" && method === "POST") {
        const r = await recordTransfusionReaction(request, env, { ...deps, episodeId: body.episodeId, detail: body.detail, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-complete" && method === "POST") {
        const r = await completeTransfusion(request, env, { ...deps, episodeId: body.episodeId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-queue" && method === "GET") {
        const r = await transfusionQueue(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfusion-trace" && method === "GET") {
        const r = await traceBloodUnit(request, env, { ...deps, unitId: url.searchParams.get("unitId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "vitals" && method === "POST") {
        const r = await recordWardVitals(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, vitals: body.vitals, recordedAt: body.recordedAt,
          // What a clinician HERE writes a vital in, when the caller did not say. See _region.js.
          tempUnit: unitsFor(wOrg && wOrg.region).temp, weightUnit: unitsFor(wOrg && wOrg.region).weight,
          idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "medication-order" && method === "POST") {
        const r = await createWardMedicationOrder(request, env, {
          ...deps, order: body.order || body, safety: body.safety || null,
          /* The formulary is ORG content, exactly as the order sets and the critical limits are: a
           * caller who could pass one could lift any restriction the hospital had set. */
          formulary: (wsqCfg && wsqCfg.formulary) || null,
          // The hospital's own advisories, ORG content like everything else here. They can never
          // block: see the header of _wardsynq/advisories.js.
          advisories: (wsqCfg && wsqCfg.advisories) || null, ageYears: body.ageYears,
          requireReasonOffFormulary: !!(wsqCfg && wsqCfg.requireReasonOffFormulary),
          specialty: body.specialty, approvalRef: body.approvalRef, formularyReason: body.formularyReason,
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "round" && method === "GET") {
        const r = await medicationRound(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", dueAt: url.searchParams.get("dueAt") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* FHIR, read only. Three shapes, all GET:
       *   /ward/fhir/metadata                    the CapabilityStatement
       *   /ward/fhir/Patient/<id>                one resource
       *   /ward/fhir?patient=<id>[&_type=A,B]    everything for one patient, as a Bundle
       * Errors come back as OperationOutcome, because that is what a FHIR client parses. */
      if (sub === "fhir-exceptions" && method === "GET") {
        const r = await listExceptions(request, env, { ...deps, config: (wsqCfg && wsqCfg.fhir) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "smart-launch" && method === "POST") {
        /* An EHR launch: this clinician starts a registered application for the patient (and
         * encounter) they are looking at. The application then arrives at the external door's
         * authorize endpoint with the launch token, and the consent screen already knows the patient. */
        const r = await createLaunch(request, env, { ...deps, config: (wsqCfg && wsqCfg.fhir) || null, base: `${url.origin}/api/fhir/${wOrgId}`, clientId: body.clientId, patientId: body.patientId, encounterId: body.encounterId });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "fhir-exception-resolve" && method === "POST") {
        const r = await resolveException(request, env, { ...deps, config: (wsqCfg && wsqCfg.fhir) || null, hl7Config: (wsqCfg && wsqCfg.hl7) || null, terminology: (wsqCfg && wsqCfg.terminology) || null, profiles: (wsqCfg && wsqCfg.fhir && wsqCfg.fhir.profiles) || null, base: `${url.origin}/api/queue/ward/fhir`, exceptionId: body.exceptionId, resolution: body.resolution, localPatientId: body.localPatientId, reason: body.reason });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "source-grants" && method === "GET") {
        const r = await listSourceGrants(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "source-grant" && method === "POST") {
        const r = await grantSourceSystem(request, env, { ...deps, actorId: body.actorId, sourceSystem: body.sourceSystem, note: body.note, expiresAt: body.expiresAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "source-revoke" && method === "POST") {
        const r = await revokeSourceSystem(request, env, { ...deps, actorId: body.actorId, sourceSystem: body.sourceSystem, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 7.4: WardSynQ -> another system. A destination is REGISTERED (that registration is the
       * allowlist), a resource is QUEUED against it by name, and a dispatcher drains what is due.
       * No route here takes a URL from the caller: the only address anything is ever posted to is
       * one already on the record. See fhir-outbound.js. */
      if (sub === "outbound-destination" && method === "POST") {
        const r = await registerDestination(request, env, { ...deps, name: body.name, url: body.url, resourceTypes: body.resourceTypes, auth: body.auth, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound-destination-revoke" && method === "POST") {
        const r = await revokeDestination(request, env, { ...deps, name: body.name, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound-destinations" && method === "GET") {
        const r = await listDestinations(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound-send" && method === "POST") {
        const r = await queueDelivery(request, env, { ...deps, destination: body.destination, resourceType: body.resourceType, id: body.id, profiles: (wsqCfg && wsqCfg.fhir && wsqCfg.fhir.profiles) || null, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound-dispatch" && method === "POST") {
        /* WSQ_OUTBOUND_FETCH is a binding, not a parameter: it lets a deployment (and the test
         * suite's deterministic FHIR server) supply the transport without any caller being able to
         * choose one. Absent, the platform's own fetch is used. Either way makeSafeFetch wraps it
         * and the destination URL still comes only from the registered record. */
        const r = await dispatchOutbound(request, env, { ...deps, limit: body.limit, now: body.now || "",
          fetchImpl: env && typeof env.WSQ_OUTBOUND_FETCH === "function" ? env.WSQ_OUTBOUND_FETCH : null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound-replay" && method === "POST") {
        const r = await replayDelivery(request, env, { ...deps, deliveryId: body.deliveryId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbound" && method === "GET") {
        const r = await listDeliveries(request, env, { ...deps, state: url.searchParams.get("state") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "hl7" && method === "POST") {
        /* The HL7 v2 gateway. Off is a 404 before the message is looked at; a message that could be
         * parsed is answered with an ACK in ER7, whatever became of it (see hl7-inbound.js). */
        const r = await ingestHl7(request, env, { ...deps, config: (wsqCfg && wsqCfg.hl7) || null, hl7Config: (wsqCfg && wsqCfg.hl7) || null, terminology: (wsqCfg && wsqCfg.terminology) || null, body: rawText || "", sourceSystem: request.headers.get("X-Source-System") || "", facility: (wOrg && wOrg.name) || "", base: `${url.origin}/api/queue/ward/fhir` });
        if (r.ack) return new Response(r.ack, { status: r.status || 200, headers: Object.assign({ "Content-Type": "x-application/hl7-v2+er7; charset=utf-8", "Cache-Control": "no-store", "X-WardSynQ-Ack": /^MSA\|(\w+)/m.exec(r.ack) ? /^MSA\|(\w+)/m.exec(r.ack)[1] : "" }, corsHeaders(request)) });
        return fhirJson(r.outcome || operationOutcome("error", "exception", "no acknowledgement could be built"), r.status || 500, request);
      }
      if (sub === "fhir") {
        /* FHIR R4, read side. Every response is application/fhir+json and every error is an
         * OperationOutcome, including an unknown path - a FHIR client parses those and nothing else.
         *   GET /ward/fhir/metadata                          CapabilityStatement
         *   GET /ward/fhir/{Type}?...                        search-type (see fhir-search.js)
         *   GET /ward/fhir/{Type}/{id}                       read       (ETag = W/"versionId")
         *   GET /ward/fhir/{Type}/{id}/_history              history-instance
         *   GET /ward/fhir/{Type}/{id}/_history/{vid}        vread
         *   GET /ward/fhir/Patient/{id}/$everything          everything for one patient
         *   GET /ward/fhir?patient={id}[&_type=A,B]          the same, older spelling */
        const fType = parts[2] || "", fId = parts[3] || "", fOp = parts[4] || "", fVid = parts[5] || "";
        const fctx = { ...deps, base: `${url.origin}/api/queue/ward/fhir`, terminology: (wsqCfg && wsqCfg.terminology) || null, profiles: (wsqCfg && wsqCfg.fhir && wsqCfg.fhir.profiles) || null, inbound: inboundEnabled((wsqCfg && wsqCfg.fhir) || null), region: (wOrg && wOrg.region) || "" };
        /* $validate is an operation, not a write: it files nothing, so it is open to anyone who may
         * read, whether or not the hospital has opened the inbound door. */
        if (method === "POST") {
          const op = await dispatchOperation(request, env, parts.slice(2), body, fctx);
          if (op) return fhirJson(op.obj, op.status, request);
        }
        /* WRITES. Off unless the hospital enabled wardsynq.fhir.inbound, and only for an actor who
         * may already write the chart (emr.treat) - the FHIR sub is emr.view for reads, so the write
         * methods check the stronger capability themselves. Everything goes through fhir-inbound.js:
         * the SAME normaliser and adapter the record already trusts, identity reconciled BEFORE any
         * row lands, local authorship never overwritten, and anything uncertain held as an
         * ExchangeException rather than filed. */
        if (method === "POST" || method === "PUT") {
          /* Off is a 404, before anything about the request is examined - the existence of a write
           * door is not leaked to a caller the hospital has not opened it for. */
          if (!inboundEnabled((wsqCfg && wsqCfg.fhir) || null)) return fhirJson(operationOutcome("error", "not-supported", "not found"), 404, request);
          const wAzW = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.EMR_TREAT);
          if (!wAzW.ok) return fhirJson(operationOutcome("error", "forbidden", "writing to the record needs emr.treat"), 403, request);
          const common = { ...fctx, body, config: (wsqCfg && wsqCfg.fhir) || null, sourceSystem: request.headers.get("X-Source-System") || "", ifMatch: request.headers.get("If-Match") || "", ifNoneExist: request.headers.get("If-None-Exist") || "", prefer: /return=minimal/i.test(request.headers.get("Prefer") || "") ? "minimal" : "representation" };
          const subjectRef = body && ((body.subject && body.subject.reference) || (body.patient && body.patient.reference) || "");
          const patientRef = (/(?:^|\/)Patient\/([^/?#]+)$/.exec(String(subjectRef || "")) || [])[1] || "";
          let r;
          if (method === "POST" && !fType) r = await ingestFhir(request, env, { ...common, mode: "bundle" });
          else if (method === "POST" && fType && !fId) {
            if (body && body.resourceType !== fType) return fhirJson(operationOutcome("error", "invalid", `body is ${body && body.resourceType}, URL says ${fType}`), 400, request);
            r = await ingestFhir(request, env, { ...common, mode: "create", targetType: fType, patientRef });
          } else if (method === "PUT" && fType && fId && !fOp) {
            if (body && body.resourceType !== fType) return fhirJson(operationOutcome("error", "invalid", `body is ${body && body.resourceType}, URL says ${fType}`), 400, request);
            r = await ingestFhir(request, env, { ...common, mode: "update", targetType: fType, targetId: fId, patientRef });
          } else {
            return fhirJson(operationOutcome("error", "not-supported", "supported writes: POST /fhir (Bundle), POST /fhir/{Type}, PUT /fhir/{Type}/{id}"), 405, request, { Allow: "GET, POST, PUT" });
          }
          const extra = {};
          const first = r.bundle && r.bundle.entry && r.bundle.entry.find((e) => e.response && e.response.location);
          if (r.ok && (r.status === 201 || r.status === 200) && first && (method === "PUT" || fType)) { extra.Location = first.response.location; if (first.response.etag) extra.ETag = first.response.etag; }
          return fhirJson(r.ok ? r.bundle : r.outcome, r.status, request, extra);
        }
        if (method !== "GET") {
          return fhirJson(operationOutcome("error", "not-supported", "method not supported on this path"), 405, request, { Allow: "GET, POST, PUT" });
        }
        /* The read grammar lives ONCE, in fhir-route.js, shared with the external SMART door, so both
         * doors answer the same path the same way. `orgId` is this API's transport parameter, not a
         * FHIR one; the dispatcher strips it before parsing and keeps it in the Bundle links. */
        const { obj, status } = await dispatchRead(request, env, parts.slice(2), url, fctx, request.headers.get("Prefer") || "");
        return fhirJson(obj, status, request);
      }
      if (sub === "transmit" && method === "POST") {
        const r = await queueTransmission(request, env, { ...deps, orderId: body.orderId, channel: body.channel, destination: body.destination, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transmit-send" && method === "POST") {
        /* The destination comes from org config and NEVER from the body: if a caller could name it,
         * anyone who can queue a prescription could post a patient's medicines to a host of their
         * choosing, and the audit would show a successful transmission. */
        const r = await sendQueued(request, env, { ...deps, transmissionId: body.transmissionId, endpoints: (wsqCfg && wsqCfg.transmitEndpoints) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transmit-outcome" && method === "POST") {
        const r = await recordOutcome(request, env, { ...deps, transmissionId: body.transmissionId, state: body.state, reference: body.reference, failureReason: body.failureReason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transmit-resolve" && method === "POST") {
        const r = await resolveTransmission(request, env, { ...deps, transmissionId: body.transmissionId, resolution: body.resolution, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "outbox" && method === "GET") {
        const r = await listTransmissions(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", outstandingOnly: url.searchParams.get("outstanding") === "1" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "risk-tools" && method === "GET") {
        const r = await listRiskTools(request, env, { ...deps, tools: (wsqCfg && wsqCfg.riskTools) || [] });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "assess" && method === "POST") {
        const r = await recordRiskAssessment(request, env, { ...deps, tools: (wsqCfg && wsqCfg.riskTools) || [], toolId: body.toolId, encounterId: body.encounterId, answers: body.answers, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "risk-action" && method === "POST") {
        const r = await completeRiskAction(request, env, { ...deps, assessmentId: body.assessmentId, action: body.action, note: body.note, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "risks" && method === "GET") {
        const r = await listRiskAssessments(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "templates" && method === "GET") {
        const r = await listTemplates(request, env, { ...deps, templates: (wsqCfg && wsqCfg.noteTemplates) || [] });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "note" && method === "POST") {
        // Templates are ORG content for the same reason order sets are.
        /* An OPD caller knows its TICKET, not its encounter, and the encounter id depends on whether
         * the ticket carries a GHIS episode. Deriving it here from the canonical
         * `encounterIdForTicket` keeps ONE formula: a client that computed it would be a second copy
         * that silently files notes under a non-existent encounter the day a ticket gains an
         * episode id. An explicit encounterId still wins, so the ward path is unchanged. */
        let noteEncounterId = body.encounterId;
        if (!noteEncounterId && body.ticketId) {
          const t = await Q.getTicket(env, String(body.ticketId));
          noteEncounterId = t ? encounterIdForTicket(t) : null;
        }
        const r = await writeTemplatedNote(request, env, { ...deps, templates: (wsqCfg && wsqCfg.noteTemplates) || [], templateId: body.templateId, encounterId: noteEncounterId, sections: body.sections, at: body.at, idempotencyKey: body.idempotencyKey || null, noteWriterOverride });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "note-submit" && method === "POST") {
        const r = await submitNote(request, env, { ...deps, noteId: body.noteId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "note-sign" && method === "POST") {
        const r = await signNote(request, env, { ...deps, noteId: body.noteId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "book-resource" && method === "POST") {
        const r = await bookResource(request, env, { ...deps, resources: (wsqCfg && wsqCfg.resources) || null, resourceId: body.resourceId, startAt: body.startAt, minutes: body.minutes, patientId: body.patientId, encounterId: body.encounterId, purpose: body.purpose, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resource-state" && method === "POST") {
        const r = await setBookingState(request, env, { ...deps, bookingId: body.bookingId, state: body.state, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "resource-schedule" && method === "GET") {
        const r = await resourceSchedule(request, env, { ...deps, resources: (wsqCfg && wsqCfg.resources) || null, resourceId: url.searchParams.get("resourceId") || "", from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "request-admission" && method === "POST") {
        const r = await requestAdmission(request, env, { ...deps, mrn: body.mrn, specialty: body.specialty, ward: body.ward, reason: body.reason, urgency: body.urgency, plannedFor: body.plannedFor, requestedAt: body.requestedAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "close-admission-request" && method === "POST") {
        const r = await closeAdmissionRequest(request, env, { ...deps, requestId: body.requestId, state: body.state, encounterId: body.encounterId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "waiting-list" && method === "GET") {
        const r = await admissionWaitingList(request, env, { ...deps, specialty: url.searchParams.get("specialty") || "", includeClosed: url.searchParams.get("includeClosed") === "1" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cda" && method === "GET") {
        const r = await cdaForEncounter(request, env, {
          ...deps, encounterId: url.searchParams.get("encounterId") || "",
          org: { name: (wOrg && wOrg.name) || "", oid: (wOrg && wOrg.code) || "" },
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "oru" && method === "GET") {
        const r = await oruForReport(request, env, { ...deps, reportId: url.searchParams.get("reportId") || "", sendingFacility: (wOrg && wOrg.code) || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "adt" && method === "GET") {
        const r = await adtForEncounter(request, env, {
          ...deps, encounterId: url.searchParams.get("encounterId") || "",
          event: url.searchParams.get("event") || "", sendingFacility: (wOrg && wOrg.code) || "",
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "read" && method === "POST") {
        const r = await recordRead(request, env, { ...deps, patientId: body.patientId, valueId: body.valueId, version: body.version, value: body.value, kind: body.kind, context: body.context, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "readers" && method === "GET") {
        const r = await readersToNotify(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "", valueId: url.searchParams.get("valueId") || "",
          supersededVersion: url.searchParams.get("supersededVersion"), correctedAt: url.searchParams.get("correctedAt") || "",
          label: url.searchParams.get("label") || "", unit: url.searchParams.get("unit") || "",
          wasValue: url.searchParams.get("wasValue"), nowValue: url.searchParams.get("nowValue"),
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "claim" && method === "POST") {
        const r = await codeClaimForEncounter(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, codes: body.codes, now: body.now, invoiceId: body.invoiceId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "claim-state" && method === "POST") {
        const r = await claimAction(request, env, { ...deps, claimId: body.claimId, action: body.action, reason: body.reason, codes: body.codes || null, now: body.now, submittedAmount: body.submittedAmount, approvedAmount: body.approvedAmount, deniedAmount: body.deniedAmount });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "preauth" && method === "POST") {
        const r = await recordPreAuth(request, env, { ...deps, patientId: body.patientId, treatment: body.treatment, state: body.state, scheme: body.scheme, reason: body.reason, decidedAt: body.decidedAt, invoiceId: body.invoiceId, authorizedAmount: body.authorizedAmount, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "claims" && method === "GET") {
        const r = await claimsForPatient(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "upcoding" && method === "GET") {
        const r = await upcodingList(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-request" && method === "POST") {
        const r = await requestRelease(request, env, { ...deps, patientId: body.patientId, requester: body.requester, purpose: body.purpose, authorizationBasis: body.authorizationBasis, scope: body.scope, recipient: body.recipient, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-authorize" && method === "POST") {
        const r = await authorizeRelease(request, env, { ...deps, roiId: body.roiId, authorizationBasis: body.authorizationBasis, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-deny" && method === "POST") {
        const r = await denyRelease(request, env, { ...deps, roiId: body.roiId, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-cancel" && method === "POST") {
        const r = await cancelRelease(request, env, { ...deps, roiId: body.roiId, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-fulfill" && method === "POST") {
        const r = await fulfillRelease(request, env, { ...deps, roiId: body.roiId, deliveredStatus: body.deliveredStatus, resourceCounts: body.resourceCounts, note: body.note, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi" && method === "GET") {
        const r = await readRoi(request, env, { ...deps, roiId: url.searchParams.get("roiId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "roi-requests" && method === "GET") {
        const r = await roiRequestsForPatient(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "id-match" && method === "POST") {
        const r = await possibleDuplicates(request, env, {
          ...deps, name: body.name, dob: body.dob, sex: body.sex, mrn: body.mrn,
          identifiers: body.identifiers, patientId: body.patientId, limit: body.limit,
          thresholds: (wsqCfg && wsqCfg.mpiThresholds) || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "stock-move" && method === "POST") {
        const r = await recordMovement(request, env, { ...deps, kind: body.kind, code: body.code, display: body.display, quantity: body.quantity, location: body.location, batch: body.batch, expiry: body.expiry, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "stock" && method === "GET") {
        const r = await stockLevels(request, env, { ...deps, location: url.searchParams.get("location") || "", reorderLevels: (wsqCfg && wsqCfg.reorderLevels) || null, nearExpiryDays: (wsqCfg && wsqCfg.nearExpiryDays) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "stock-reconcile" && method === "POST") {
        const r = await reconcileCount(request, env, { ...deps, code: body.code, location: body.location, unit: body.unit, counted: body.counted, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "charges" && method === "GET") {
        const r = await chargesForPatient(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "",
          encounterId: url.searchParams.get("encounterId") || "",
          tariff: (wsqCfg && wsqCfg.tariff) || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice" && method === "POST") {
        const r = await raiseInvoice(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, tariff: (wsqCfg && wsqCfg.tariff) || null, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice" && method === "GET") {
        const r = await readInvoice(request, env, { ...deps, invoiceId: url.searchParams.get("invoiceId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoices" && method === "GET") {
        const r = await invoicesForPatient(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-discount" && method === "POST") {
        const r = await postDiscount(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-deposit" && method === "POST") {
        const r = await postDeposit(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reference: body.reference, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-payment" && method === "POST") {
        const r = await postPayment(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reference: body.reference, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-refund" && method === "POST") {
        const r = await postRefund(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reason: body.reason, reference: body.reference, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-adjustment" && method === "POST") {
        const r = await postAdjustment(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-writeoff" && method === "POST") {
        const r = await postWriteOff(request, env, { ...deps, invoiceId: body.invoiceId, amount: body.amount, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "invoice-void" && method === "POST") {
        const r = await voidInvoiceRoute(request, env, { ...deps, invoiceId: body.invoiceId, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "backup" && method === "GET") {
        const r = await exportPage(request, env, { ...deps, since: url.searchParams.get("since"), limit: url.searchParams.get("limit") });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "backup" && method === "POST") {
        const r = await recordBackupRun(request, env, { ...deps, throughSeq: body.throughSeq, rows: body.rows, location: body.location, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "backup-status" && method === "GET") {
        const r = await backupStatus(request, env, { ...deps, rpoMinutes: (wsqCfg && wsqCfg.rpoMinutes) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "advisory-check" && method === "POST") {
        const r = await checkAdvisories(request, env, { ...deps, advisories: body.advisories, now: body.now });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "protocol-context" && method === "GET") {
        const r = await protocolContext(request, env, { ...deps, serviceRequestId: url.searchParams.get("serviceRequestId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "protocol-set" && method === "POST") {
        const r = await recordProtocol(request, env, { ...deps, serviceRequestId: body.serviceRequestId, protocol: body.protocol, contrast: body.contrast === true, contrastReason: body.contrastReason, notes: body.notes, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "analytics-extract" && method === "GET") {
        const r = await analyticsExtract(request, env, { ...deps, from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", minCell: url.searchParams.get("minCell") });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-messages" && method === "GET") {
        const r = await messageWorklist(request, env, { ...deps });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-reply" && method === "POST") {
        const r = await replyToMessage(request, env, { ...deps, messageId: body.messageId, reply: body.reply });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-enrol" && method === "POST") {
        const r = await enrolPatient(request, env, { ...deps, patientId: body.patientId, issuedTo: body.issuedTo, identifiedBy: body.identifiedBy, config: (wsqCfg && wsqCfg.patientAccess) || null, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-revoke" && method === "POST") {
        const r = await revokeAccess(request, env, { ...deps, grantId: body.grantId, reason: body.reason, config: (wsqCfg && wsqCfg.patientAccess) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-copy" && method === "GET") {
        const r = await patientCopy(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", neverRelease: (wsqCfg && wsqCfg.neverRelease) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-release" && method === "POST") {
        const r = await releaseToPatient(request, env, { ...deps, patientId: body.patientId, givenTo: body.givenTo, at: body.at, neverRelease: (wsqCfg && wsqCfg.neverRelease) || null, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "news2" && method === "GET") {
        const r = await news2ForPatient(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "",
          // Scale 2 is a PRESCRIPTION. It is taken from the caller stating it and never inferred.
          scale: url.searchParams.get("scale") || "",
          escalation: (wsqCfg && wsqCfg.criticalEscalation) || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "flowsheet" && method === "GET") {
        const r = await flowsheet(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "",
          from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", hours: url.searchParams.get("hours") || "",
          rows: (wsqCfg && wsqCfg.flowsheetRows) || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "timeline" && method === "GET") {
        const r = await patientTimeline(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "wound" && method === "POST") {
        const r = await chartWound(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, site: body.site, kind: body.kind, stage: body.stage, origin: body.origin, lengthCm: body.lengthCm, widthCm: body.widthCm, depthCm: body.depthCm, tissue: body.tissue, exudate: body.exudate, infectionSigns: body.infectionSigns, dressing: body.dressing, note: body.note, assessedAt: body.assessedAt, photo: body.photo, image: body.image, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "wounds" && method === "GET") {
        const r = await listWounds(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "maik-ask" && method === "POST") {
        /* WSQ_MAIK_FETCH is a BINDING, not a parameter: it lets a deployment (and this repository's own
         * test suite) supply the transport the local-model adapter talks over, while leaving every
         * decision about WHICH model may answer - and whether it may see patient data at all - to the
         * gateway and the hospital's configuration. No caller can choose a provider. */
        const r = await askAboutPatient(request, env, { ...deps, config: (wsqCfg && wsqCfg.maik) || null,
          patientId: body.patientId, encounterId: body.encounterId, task: body.task, question: body.question,
          sections: body.sections, idempotencyKey: body.idempotencyKey || null,
          fetchImpl: env && typeof env.WSQ_MAIK_FETCH === "function" ? env.WSQ_MAIK_FETCH : null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "maik-explain-safety" && method === "POST") {
        const r = await explainOrderSafety(request, env, { ...deps, config: (wsqCfg && wsqCfg.maik) || null,
          orderId: body.orderId, patientId: body.patientId, encounterId: body.encounterId,
          /* The SAME compiled rule pack the prescribing and pharmacy paths use. MaiK never receives a
           * pack of its own: a second pack is a second set of clinical rules by another name. */
          rulePack: getRulePack(),
          correlationId: body.correlationId, idempotencyKey: body.idempotencyKey || null,
          fetchImpl: env && typeof env.WSQ_MAIK_FETCH === "function" ? env.WSQ_MAIK_FETCH : null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "maik-status" && method === "GET") {
        const st = maikStatus(env, (wsqCfg && wsqCfg.maik) || null);
        return json({ ok: true, ...st }, 200, request);
      }
      if (sub === "maik-review" && method === "POST") {
        const r = await reviewInteraction(request, env, { ...deps, config: (wsqCfg && wsqCfg.maik) || null,
          interactionId: body.interactionId, decision: body.decision, editedOutput: body.editedOutput,
          reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "maik-interactions" && method === "GET") {
        const r = await listInteractions(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "imaging-worklist" && method === "GET") {
        const r = await imagingWorklist(request, env, { ...deps, config: (wsqCfg && wsqCfg.dicom) || null, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-imaging" && method === "POST") {
        const r = await reportImaging(request, env, { ...deps, serviceRequestId: body.serviceRequestId, findings: body.findings, impression: body.impression, status: body.status, modality: body.modality, critical: !!body.critical, reportedAt: body.reportedAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "infusion" && method === "POST") {
        const r = await chartInfusion(request, env, { ...deps, orderId: body.orderId, event: body.event, ratePerHour: body.ratePerHour, reason: body.reason, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "infusions" && method === "GET") {
        const r = await listInfusions(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "investigation" && method === "POST") {
        const r = await orderInvestigation(request, env, { ...deps, encounterId: body.encounterId, code: body.code, display: body.display, codeSystem: body.codeSystem, category: body.category, priority: body.priority, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "collect" && method === "POST") {
        const r = await collectSpecimen(request, env, { ...deps, serviceRequestId: body.serviceRequestId, specimenType: body.specimenType, container: body.container, at: body.at, scannedPatientBarcode: body.scannedPatientBarcode, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "specimen-outcome" && method === "POST") {
        const r = await specimenOutcome(request, env, { ...deps, specimenId: body.specimenId, state: body.state, failureReason: body.failureReason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "collections" && method === "GET") {
        // scope=hospital is the laboratory's own board: every outstanding specimen, not one chart's.
        const r = await collectionList(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", scope: url.searchParams.get("scope") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "registries" && method === "GET") {
        const r = await registryReport(request, env, {
          ...deps, registries: (wsqCfg && wsqCfg.registries) || null,
          registryId: url.searchParams.get("registry") || "", overdueOnly: url.searchParams.get("overdue") === "1",
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "quality" && method === "GET") {
        const esc = (wsqCfg && wsqCfg.criticalEscalation) || null;
        const r = await qualityReport(request, env, {
          ...deps, days: url.searchParams.get("days") || "",
          // The threshold is the HOSPITAL's, not a default invented here: a measure scored against a
          // window nobody agreed to is a number nobody will act on.
          ackWindowMinutes: esc && esc.acknowledgeWithinMinutes,
          graceMinutes: (wsqCfg && wsqCfg.marGraceMinutes),
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "downtime" && method === "GET") {
        const r = await downtimePack(request, env, {
          ...deps, ward: url.searchParams.get("ward") || "", hours: url.searchParams.get("hours") || "",
          marTimes: (wsqCfg && wsqCfg.marTimes) || null,
          /* THE SAME CLOCK THE LIVE ROUND USES. This read `|| 0`, so a hospital that had not
           * configured an offset got UTC here and mar-schedule.js's own default (330) everywhere
           * else - the downtime pack printed every dose time 5h30m from the screen it replaces.
           * The downtime pack is the PAPER SHEET a ward uses when the system is down, which makes
           * it the single worst place in the product for a wrong dose clock. */
          offsetMinutes: Number.isFinite(wsqCfg && wsqCfg.utcOffsetMinutes) ? wsqCfg.utcOffsetMinutes : undefined,
          // And the zone, where the hospital has one: the sheet a ward uses when the system is down
          // must print the same dose times the live round does, on both sides of a clock change.
          timeZone: (wsqCfg && wsqCfg.timeZone) || undefined,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cosign-queue" && method === "GET") {
        const r = await listAwaitingCoSign(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "completion-queue" && method === "GET") {
        const r = await chartCompletionQueue(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "",
          rules: (wsqCfg && wsqCfg.chartCompletion) || null,
          criticalPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null,
          riskTools: (wsqCfg && wsqCfg.riskTools) || [],
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "care-plan" && method === "POST") {
        const r = await setCarePlan(request, env, { ...deps, encounterId: body.encounterId, title: body.title, goals: body.goals, reviewBy: body.reviewBy, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "progress" && method === "POST") {
        const r = await recordProgress(request, env, { ...deps, encounterId: body.encounterId, key: body.key, title: body.title, state: body.state, note: body.note, review: !!body.review, reviewBy: body.reviewBy, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "plan" && method === "GET") {
        const r = await readCarePlan(request, env, { ...deps, encounterId: url.searchParams.get("encounterId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "book" && method === "POST") {
        const r = await bookAppointment(request, env, { ...deps, patientId: body.patientId, clinicianId: body.clinicianId, startAt: body.startAt, minutes: body.minutes, reason: body.reason, requestId: body.requestId, overbook: !!body.overbook, overbookReason: body.overbookReason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "appointment" && method === "POST") {
        const r = await setAppointmentState(request, env, { ...deps, appointmentId: body.appointmentId, state: body.state, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "follow-up" && method === "POST") {
        const r = await requestFollowUp(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, clinicianId: body.clinicianId, reason: body.reason, dueBy: body.dueBy, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "diary" && method === "GET") {
        const r = await listSchedule(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", clinicianId: url.searchParams.get("clinicianId") || "", from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "block-period" && method === "POST") {
        const r = await blockPeriod(request, env, { ...deps, clinicianId: body.clinicianId, resourceId: body.resourceId, from: body.from, to: body.to, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cancel-blackout" && method === "POST") {
        const r = await cancelBlackout(request, env, { ...deps, blackoutId: body.blackoutId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "blackouts" && method === "GET") {
        const r = await listBlackouts(request, env, { ...deps, clinicianId: url.searchParams.get("clinicianId") || "", resourceId: url.searchParams.get("resourceId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "consent" && method === "POST") {
        const r = await recordConsent(request, env, { ...deps, patientId: body.patientId, encounterId: body.encounterId, scope: body.scope, decision: body.decision, detail: body.detail, givenBy: body.givenBy, giverName: body.giverName, capacity: body.capacity, validFrom: body.validFrom, validUntil: body.validUntil, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "withdraw-consent" && method === "POST") {
        const r = await withdrawConsent(request, env, { ...deps, patientId: body.patientId, scope: body.scope, detail: body.detail, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "consents" && method === "GET") {
        const r = await consentStatus(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", scope: url.searchParams.get("scope") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "order-sets" && method === "GET") {
        const r = await listOrderSets(request, env, { ...deps, sets: (wsqCfg && wsqCfg.orderSets) || [] });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "prepare-set" && method === "POST") {
        /* The sets are ORG content, never a request parameter: a caller who could pass a set could
         * hand themselves any order they liked with a set's name on it. */
        const r = await prepareOrderSet(request, env, { ...deps, sets: (wsqCfg && wsqCfg.orderSets) || [], setId: body.setId, patientId: body.patientId, encounterId: body.encounterId, select: body.select });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "applied-set" && method === "POST") {
        const r = await recordApplication(request, env, { ...deps, setId: body.setId, setName: body.setName, setVersion: body.setVersion, patientId: body.patientId, encounterId: body.encounterId, applied: body.applied, failed: body.failed, deselected: body.deselected, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "overrides" && method === "GET") {
        const r = await overrideReport(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "merge" && method === "POST") {
        const r = await mergePatients(request, env, { ...deps, survivorId: body.survivorId, mergedId: body.mergedId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "unmerge" && method === "POST") {
        const r = await unmergePatients(request, env, { ...deps, survivorId: body.survivorId, mergedId: body.mergedId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "identity" && method === "GET") {
        const r = await identityOf(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "release-result" && method === "POST") {
        const r = await releaseResult(request, env, {
          ...deps, serviceRequestId: body.serviceRequestId, patientId: body.patientId, encounterId: body.encounterId,
          panel: body.panel, tests: body.tests, status: body.status, reportedAt: body.reportedAt, conclusion: body.conclusion,
          // What counts as an implausible change, and what may be released unread, are the HOSPITAL's
          // clinical content - the same shape as the critical limits this file already passes.
          deltaLimits: (wsqCfg && wsqCfg.deltaLimits) || null, autoVerify: (wsqCfg && wsqCfg.autoVerify) || null,
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "pending-tests" && method === "GET") {
        const r = await pendingRequests(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", scope: url.searchParams.get("scope") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "metrics" && method === "GET") {
        const r = await wardMetrics(request, env, { ...deps, ward: url.searchParams.get("ward") || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "patient-flow" && method === "GET") {
        const r = await patientFlow(request, env, { ...deps, escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-patient-flow" && method === "GET") {
        const r = await patientFlowReport(request, env, { ...deps, escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-clinical-operations" && method === "GET") {
        const r = await clinicalOperationsReport(request, env, { ...deps, ward: url.searchParams.get("ward") || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10.1-10.4: the Hospital Digital Twin. Every number is a call into a file that already
       * owns it - see digital-twin.js's own header for why this route is deliberately thin. */
      if (sub === "twin" && method === "GET") {
        const r = await buildTwinSnapshot(request, env, { ...deps, ward: url.searchParams.get("ward") || "",
          escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null, includeFinance: url.searchParams.get("finance") === "1",
          resources: (wsqCfg && wsqCfg.resources) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10.20: bounded point-in-time reconstruction. Gated at STAFF_ADMIN, one notch above the
       * live twin's EMR_VIEW, for the same forensic-reach reason backup.js's own export is: a caller
       * who can walk the full version history of every emergency/blackout/critical-result ever
       * declared is reading something closer to an audit trail than a clinical chart. */
      if (sub === "twin-reconstruct" && method === "GET") {
        const r = await reconstructTwinAsOf(request, env, deps, url.searchParams.get("at") || "");
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10 observability pass: the application-side SLO/health contract, composed from
       * records this tenant already writes - see digital-twin.js's own header for what this is
       * and, just as deliberately, is NOT. */
      if (sub === "operational-health" && method === "GET") {
        const r = await operationalHealthReport(request, env, { ...deps, ward: url.searchParams.get("ward") || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null, resources: (wsqCfg && wsqCfg.resources) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10.12: governed operational predictions. Never merged into the twin's own sections -
       * see twin-predict.js's header for why the shapes are kept apart on purpose. */
      if (sub === "twin-predict" && method === "GET") {
        const r = await predictMetric(request, env, { ...deps, metric: url.searchParams.get("metric") || "",
          lookbackDays: Number(url.searchParams.get("lookbackDays")) || undefined, horizonDays: Number(url.searchParams.get("horizonDays")) || undefined });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10.19: what-if simulation. Reads a real twin, projects arithmetically, writes nothing -
       * see twin-simulate.js's header for the structural (not just disciplinary) reason it cannot. */
      if (sub === "twin-simulate" && method === "POST") {
        const twinR = await buildTwinSnapshot(request, env, { ...deps, ward: body.ward || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null, resources: (wsqCfg && wsqCfg.resources) || null });
        if (!twinR.ok || !twinR.twin) return json({ ok: false, error: "twin_unavailable" }, 502, request);
        const r = simulateScenario(twinR.twin, body.scenario, body.params || {});
        return json(r, r.ok !== false ? 200 : 422, request);
      }
      /* TASK 10.17: MaiK Command Copilot, over the hospital's operational state. */
      if (sub === "twin-copilot" && method === "POST") {
        const r = await askAboutHospital(request, env, { ...deps, config: (wsqCfg && wsqCfg.maik) || null,
          question: body.question, task: body.task, ward: body.ward, escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null,
          includeFinance: body.includeFinance === true, correlationId: body.correlationId, idempotencyKey: body.idempotencyKey || null,
          fetchImpl: env && typeof env.WSQ_MAIK_FETCH === "function" ? env.WSQ_MAIK_FETCH : null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "twin-review" && method === "POST") {
        const r = await reviewTwinInteraction(request, env, { ...deps, interactionId: body.interactionId, decision: body.decision, reason: body.reason, editedOutput: body.editedOutput, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      /* TASK 10.18: the one governed agent - draft-only, see twin-agent.js's header. */
      if (sub === "twin-agent-queue" && method === "GET") {
        const r = await prepareOverdueWorkQueue(request, env, { ...deps, ward: url.searchParams.get("ward") || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-billing" && method === "GET") {
        const r = await billingReport(request, env, { ...deps, from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-claims" && method === "GET") {
        const r = await claimsReport(request, env, { ...deps, from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-pharmacy" && method === "GET") {
        const r = await pharmacyReport(request, env, { ...deps, from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", reorderLevels: (wsqCfg && wsqCfg.reorderLevels) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "report-him" && method === "GET") {
        const r = await himReport(request, env, { ...deps, patientRules: (wsqCfg && wsqCfg.chartCompletion) || null, criticalPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null, riskTools: (wsqCfg && wsqCfg.riskTools) || [] });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "med-history" && method === "POST") {
        const r = await startReconciliation(request, env, { ...deps, encounterId: body.encounterId, stage: body.stage, medicines: body.medicines, historySource: body.source, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "med-decide" && method === "POST") {
        const r = await decideMedicine(request, env, { ...deps, encounterId: body.encounterId, stage: body.stage, key: body.key, drug: body.drug, decision: body.decision, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "med-reconciliation" && method === "GET") {
        const r = await readReconciliation(request, env, { ...deps, encounterId: url.searchParams.get("encounterId") || "", stage: url.searchParams.get("stage") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "break-glass" && method === "POST") {
        const r = await declareBreakGlass(request, env, {
          ...deps, patientId: body.patientId, reason: body.reason, minutes: body.minutes, idempotencyKey: body.idempotencyKey || null,
          // Same honest gap critical-results.js already states: no real channel is wired in this
          // build (a channel is a FUNCTION, not JSON an org's Firestore config could carry; wiring
          // one means reusing StewardMD's existing APNs/FCM push infrastructure, future work, not
          // fabricated here). The declaration therefore honestly records NO_CHANNEL rather than a
          // silent "sent" - the mechanism is real and wired; the transport is the named gap.
          notifyDeps: {},
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-chart" && method === "GET") {
        const r = await openEmergencyChart(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "break-glass-log" && method === "GET") {
        const r = await listBreakGlass(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", activeOnly: url.searchParams.get("active") === "1" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-declare" && method === "POST") {
        const r = await declareEmergency(request, env, { ...deps, kind: body.kind, scope: body.scope, reason: body.reason, relaxations: body.relaxations, minutes: body.minutes, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-deactivate" && method === "POST") {
        const r = await deactivateEmergency(request, env, { ...deps, activationId: body.activationId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-status" && method === "GET") {
        const r = await emergencyStatus(request, env, deps);
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-log" && method === "GET") {
        const r = await emergencyLog(request, env, { ...deps, activeOnly: url.searchParams.get("active") === "1" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "emergency-reconciliation" && method === "GET") {
        const r = await emergencyReconciliation(request, env, { ...deps, activationId: url.searchParams.get("activationId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-report" && method === "POST") {
        const r = await reportIncident(request, env, { ...deps, what: body.what, when: body.when, severity: body.severity, anonymous: body.anonymous === true, reportedBy: body.reportedBy, patientId: body.patientId, likelihood: body.likelihood, contributingFactors: body.contributingFactors, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-triage" && method === "POST") {
        // triagedBy is the authenticated actor, never the body: an investigation's conclusions
        // are never anonymous (wardsynq-incidents.js header), and a body field lets a safety
        // officer file the conclusion under any name they type. A conflicting body.triagedBy is
        // ignored, same as updatedBy/actor.id elsewhere in this router.
        const r = await triageIncident(request, env, { ...deps, incidentId: body.incidentId, likelihood: body.likelihood, triagedBy: actor.id || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-rca" && method === "POST") {
        // conductedBy: the authenticated actor, not the body — same reasoning as triagedBy above.
        const r = await recordIncidentRCA(request, env, { ...deps, incidentId: body.incidentId, rootCause: body.rootCause, contributingFactors: body.contributingFactors, method: body.method, conductedBy: actor.id || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-capa" && method === "POST") {
        const r = await addIncidentCAPA(request, env, { ...deps, incidentId: body.incidentId, action: body.action, owner: body.owner, dueBy: body.dueBy, strength: body.strength });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-capa-complete" && method === "POST") {
        const r = await completeIncidentCAPA(request, env, { ...deps, incidentId: body.incidentId, capaId: body.capaId, by: body.by, evidence: body.evidence });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-close" && method === "POST") {
        const r = await closeIncident(request, env, { ...deps, incidentId: body.incidentId, by: body.by });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "incident-log" && method === "GET") {
        const r = await incidentLog(request, env, { ...deps, state: url.searchParams.get("state") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "verify-order" && method === "POST") {
        const r = await verifyOrder(request, env, { ...deps, orderId: body.orderId, outcome: body.outcome, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "verification-queue" && method === "GET") {
        const r = await verificationQueue(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", rulePack: getRulePack() });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "dispense" && method === "POST") {
        const r = await dispenseOrder(request, env, { ...deps, orderId: body.orderId, quantity: body.quantity, batch: body.batch, expiry: body.expiry, destination: body.destination, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "dispense-return" && method === "POST") {
        const r = await returnDispense(request, env, { ...deps, dispenseId: body.dispenseId, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "dispenses" && method === "GET") {
        const r = await listDispenses(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "handover" && method === "POST") {
        const r = await giveHandover(request, env, { ...deps, encounterId: body.encounterId, sbar: body.sbar || body, givenAt: body.givenAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "receive-handover" && method === "POST") {
        const r = await receiveHandover(request, env, { ...deps, handoverId: body.handoverId, note: body.note, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "handovers" && method === "GET") {
        const r = await listHandovers(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", state: url.searchParams.get("state") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "fluid" && method === "POST") {
        const r = await recordFluid(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, entries: body.entries, recordedAt: body.recordedAt, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "balance" && method === "GET") {
        const r = await fluidBalance(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "transfer" && method === "POST") {
        const r = await transferPatient(request, env, { ...deps, encounterId: body.encounterId, ward: body.ward, bed: body.bed, reason: body.reason, movedAt: body.movedAt, emergencyOverride: body.emergencyOverride === true, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "beds" && method === "GET") {
        // The ward's bed list is ORG configuration. With none configured the board reports what is
        // occupied and says it cannot know what is free, rather than reporting zero free beds.
        const r = await bedBoard(request, env, { ...deps, ward: url.searchParams.get("ward") || "", beds: (wsqCfg && wsqCfg.beds) || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "criticals" && method === "GET") {
        const r = await listCriticalLoops(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "", state: url.searchParams.get("state") || "",
          policy: (wsqCfg && wsqCfg.criticalEscalation) || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "flag-critical" && method === "POST") {
        // Opens the loops for a report that has already been recorded. Separate from ingestion on
        // purpose: a result is written by whoever received it, and the loop is opened against the
        // report on the record rather than against whatever a caller happened to send.
        const r = await openCriticalLoops(request, env, {
          ...deps, reportId: body.reportId,
          // The site's limits, never a request parameter: a caller who could pass these could decide
          // a potassium of 7 was not critical by asking differently.
          limits: (wsqCfg && wsqCfg.criticalLimits) || null,
          // No channel is wired in this build (a channel is a FUNCTION - wardsynq-notify.js's own
          // Dispatcher deps - not JSON an org's Firestore config document could ever carry; wiring a
          // real one means reusing StewardMD's existing APNs/FCM push infrastructure, per
          // wardsynq-safety-case.js's HAZ-DET-01, and is future work, not fabricated here). Every
          // opened loop therefore honestly records NO_CHANNEL rather than a silent "sent".
          notifyDeps: {},
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "acknowledge" && method === "POST") {
        const r = await acknowledgeCritical(request, env, {
          ...deps, loopId: body.loopId, action: body.action, close: !!body.close,
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "schedule" && method === "GET") {
        const r = await marSchedule(request, env, {
          ...deps,
          patientId: url.searchParams.get("patientId") || "",
          from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "",
          // The ward's own round times and clock. Org configuration, never a request parameter: a
          // caller who could pass these could move every dose on the chart by asking differently.
          marTimes: (wsqCfg && wsqCfg.marTimes) || null,
          offsetMinutes: Number.isFinite(wsqCfg && wsqCfg.utcOffsetMinutes) ? wsqCfg.utcOffsetMinutes : undefined,
          /* The hospital's IANA zone, when it has one. It WINS over the offset for named ward times,
           * because a site that observes DST has no single correct offset to be given. */
          timeZone: (wsqCfg && wsqCfg.timeZone) || undefined,
          graceMinutes: Number.isFinite(wsqCfg && wsqCfg.marGraceMinutes) ? wsqCfg.marGraceMinutes : undefined,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "problem" && method === "POST") {
        const r = await recordProblem(request, env, { ...deps, problem: body.problem || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "problems" && method === "GET") {
        const r = await listProblems(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "", includeInactive: url.searchParams.get("includeInactive") === "1" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "discharge" && method === "POST") {
        const r = await dischargePatient(request, env, { ...deps, encounterId: body.encounterId, dischargedAt: body.dischargedAt, disposition: body.disposition, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "discharge-summary" && method === "GET") {
        // Reading the summary is reading the chart. Drafting one WRITES, so it stays emr.treat;
        // opening the screen must not require the authority to author a clinical document.
        const r = await readDischargeSummary(request, env, { ...deps, encounterId: url.searchParams.get("encounterId") || "", patientId: url.searchParams.get("patientId") || "" });
        /* Whether THIS viewer may author and sign. Told to the screen so it can offer only what the
         * person can actually do, instead of showing a Sign button that is certain to be refused.
         * It is a display fact, not a grant: drafting and signing re-check the capability and the
         * signing credential on their own routes regardless of what the screen chose to render. */
        if (r.ok) r.canAuthor = (await ORG.authorizeOrg(env, actor, wOrgId, CAPS.EMR_TREAT)).ok === true;
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "discharge-summary" && method === "POST") {
        const r = await draftDischargeSummary(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, dischargedAt: body.dischargedAt, sections: body.sections, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "sign-discharge-summary" && method === "POST") {
        const r = await signDischargeSummary(request, env, { ...deps, encounterId: body.encounterId, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "mar" && method === "POST") {
        const r = await administerStep(request, env, {
          ...deps, action: body.action, orderId: body.orderId, dueAt: body.dueAt,
          patient: body.patient, scan: body.scan, reason: body.reason, witnessId: body.witnessId,
          rulePack: getRulePack(), highAlertDrugs: (wsqCfg && wsqCfg.highAlertDrugs) || [],
          idempotencyKey: body.idempotencyKey || null,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      return json({ ok: false, error: "not_found" }, 404, request);
    }

    if (seg === "patient") {
      const body = method === "POST" ? await readBody(request) : {};
      const pOrg = url.searchParams.get("orgId") || body.orgId || "";
      if (sub === "register" && method === "POST") {
        const az = await ORG.authorizeOrg(env, actor, pOrg, CAPS.QUEUE_ADD);
        /* Say WHICH refusal this is. authorizeOrgAccess already distinguishes org_not_found,
         * not_a_member, forbidden (with the role) and out_of_scope - and this threw all of it away
         * and answered a bare "forbidden". So a nurse whose membership had defaulted to "viewer"
         * saw check-in fail with nothing to act on, and neither she nor the owner could tell that
         * from being in the wrong clinic or not signed in. The reason names the fix. */
        if (!az.ok) return json(azRefusal(az), az.reason === "org_not_found" ? 404 : 403, request);
        const org = await ORG.getOrg(env, pOrg);
        if (!org) return json({ ok: false, error: "org_not_found" }, 404, request);
        const r = await PAT.registerPatient(env, org, body, actor.id || "");
        /* A PATIENT WHO IS ALREADY REGISTERED STILL NEEDS A CLINICAL RECORD MASTER.
         *
         * This used to return here on "duplicate" / "mrn_taken", which is right for the form (the
         * receptionist is told the patient exists) but left a real hole: if the record write ever
         * failed once - a timeout, a refusal, a tenant not yet migrated - the patient existed in the
         * register with a name and a number, and had no Patient master at all. The ward list joins
         * names off that master, so the bed showed a record id instead of a human being, forever:
         * re-registering was the obvious repair and it was refused before it could repair anything.
         *
         * So a duplicate now RECONCILES. The registration itself is still refused and still reported
         * exactly as before; what changes is that the already-stored patient is read back and its
         * record master is written if it is missing. The write is the same idempotent one the first
         * registration does (unchanged records are skipped), so repeating it costs nothing and
         * cannot invent a second identity - the id is derived from the MR number. */
        if (!r.ok) {
          const dupMrn = (r.duplicateOf && r.duplicateOf.mrn) || (r.error === "mrn_taken" ? (body.mrn || "") : "");
          if (!dupMrn) return json(r, 200, request);
          const existing = await PAT.getPatient(env, pOrg, dupMrn).catch(() => null);
          if (!existing) return json(r, 200, request);
          const dupMig = (await wsqForcedMigration(env, org)) || await registrationMigration(env, { orgId: pOrg }, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
          if (!dupMig || dupMig.error || dupMig.mode === "off") return json(r, 200, request);
          const rec = await registerPatientRecord(request, env, {
            migration: dupMig,
            registration: { mrn: existing.mrn, mrSource: existing.mrSource, pending: existing.pending, patient: existing },
            actorDeps: wsqActorDeps(env, { orgForTenant: () => org }), recordDeps: wsqRecordDeps(env, dupMig.tenantId),
          }).catch((e) => ({ ok: false, error: "record_write_failed", detail: String((e && e.message) || e) }));
          // The registration outcome is unchanged. The reconcile is reported alongside it.
          return json(Object.assign({}, r, { reconciled: rec }), 200, request);
        }
        // WardSynQ record: the patient-identity migration (functions/_wardsynq/migrate-registration.js).
        // The MR number above is ALREADY allocated by this point in every mode — that allocation is
        // the one thing this migration is told to never touch. Off (every tenant today): none of this
        // runs and the response is exactly what it always was. A wardsynq-mode org forces this
        // authoritative directly (org already fetched above) — no global flag, same reasoning as the
        // timeline handler's four migrations.
        const wsqReg = await wsqForcedMigration(env, org);
        if (wsqReg && wsqReg.error) return json({ ok: false, error: wsqReg.error, mrn: r.mrn }, 409, request);
        const mig = wsqReg || await registrationMigration(env, { orgId: pOrg }, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
        if (mig.mode !== "off") {
          const rec = await registerPatientRecord(request, env, { migration: mig, registration: { mrn: r.mrn, mrSource: r.mrSource, pending: r.pending, patient: r.patient }, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) });
          if (mig.mode === "authoritative" && !rec.ok) {
            // The MR number is already spent and is not un-spent here (see the file header for why).
            // What "authoritative" changes is that this failure is reported, not swallowed.
            return json({ ok: false, error: "record_refused", mrn: r.mrn, wardsynq: rec }, rec.status || 502, request);
          }
          return json(Object.assign({}, r, { wardsynq: rec }), 200, request);
        }
        return json(r, 200, request);
      }
      if (sub === "get" && method === "GET") {
        const az = await ORG.authorizeOrg(env, actor, pOrg, CAPS.QUEUE_VIEW);
        if (!az.ok) return json({ ok: false, error: "forbidden" }, 403, request);
        const p = await PAT.getPatient(env, pOrg, url.searchParams.get("mrn") || "");
        return json(p ? { ok: true, patient: p } : { ok: false, error: "not_found" }, 200, request);
      }
      // The hospital EMR issued a real MR for someone queued on a provisional id.
      if (sub === "link-mrn" && method === "POST") {
        const az = await ORG.authorizeOrg(env, actor, pOrg, CAPS.QUEUE_ADD);
        if (!az.ok) return json({ ok: false, error: "forbidden" }, 403, request);
        return json(await PAT.linkHospitalMrn(env, pOrg, body.provisionalMrn || "", body.mrn || "", body.mrSource || "ghis", actor.id || ""), 200, request);
      }
      return json({ ok: false, error: "not_found" }, 404, request);
    }

    // ---- Clinic operations: BILLING station (lean MVP). /api/queue/bill/<action>. Inert unless
    // CLINIC_BILLING_ENABLED=1. Every action is org-scoped + capability-gated + audited server-side. ----
    if (seg === "bill") {
      if (!BILL.billingEnabled(env)) return json({ ok: false, error: "billing_disabled" }, 200, request);
      const body = method === "POST" ? await readBody(request) : {};
      const bOrg = url.searchParams.get("orgId") || body.orgId || "";
      const capFor = {
        patient: method === "POST" ? CAPS.QUEUE_ADD : CAPS.ORDER_READ,
        order: CAPS.ORDER_CREATE, orders: CAPS.ORDER_READ, queue: CAPS.BILLING_VIEW,
        tariff: method === "POST" ? CAPS.STAFF_ADMIN : CAPS.BILLING_VIEW,
        invoice: method === "POST" ? CAPS.BILLING_CHARGE : CAPS.BILLING_VIEW, pay: CAPS.BILLING_CHARGE,
        // Pharmacy station: read what is owed, and hand it over. Separate caps from billing on purpose -
        // the person releasing medicines is never the person taking the money.
        pharmacy: CAPS.ORDER_READ, dispense: CAPS.ORDER_DISPENSE
      };
      const need = capFor[sub]; if (!need) return json({ ok: false, error: "not_found" }, 404, request);
      const bAz = await ORG.authorizeOrg(env, actor, bOrg, need);
      if (!bAz.ok) return json({ ok: false, error: "forbidden" }, 403, request);
      const aid = actor.id || "";
      if (sub === "patient" && method === "POST") { const org = await ORG.getOrg(env, bOrg); return json(await BILL.registerPatient(env, bOrg, (org && org.code) || bOrg, { name: body.name, mobile: body.mobile, sex: body.sex, ageYears: body.ageYears, actor: aid }), 200, request); }
      if (sub === "patient" && method === "GET") { const p = await BILL.getPatient(env, bOrg, url.searchParams.get("id") || ""); return json(p ? Object.assign({ ok: true }, p) : { ok: false, error: "not_found" }, 200, request); }
      if (sub === "order" && method === "POST") return json(await BILL.createOrder(env, bOrg, body, aid), 200, request);
      if (sub === "orders" && method === "GET") return json({ ok: true, orders: await BILL.ordersForPatient(env, bOrg, url.searchParams.get("patientId") || "", url.searchParams.get("status") || "") }, 200, request);
      if (sub === "queue" && method === "GET") return json({ ok: true, orders: await BILL.billingQueue(env, bOrg) }, 200, request);
      if (sub === "tariff" && method === "GET") return json({ ok: true, items: await BILL.listTariff(env, bOrg) }, 200, request);
      if (sub === "tariff" && method === "POST") return json(await BILL.upsertTariff(env, bOrg, body, aid), 200, request);
      if (sub === "invoice" && method === "POST") return json(await BILL.createInvoice(env, bOrg, body.patientId || "", aid), 200, request);
      if (sub === "invoice" && method === "GET") { const inv = await BILL.getInvoice(env, bOrg, url.searchParams.get("id") || ""); return json(inv ? Object.assign({ ok: true }, inv) : { ok: false, error: "not_found" }, 200, request); }
      if (sub === "pay" && method === "POST") return json(await BILL.payInvoice(env, bOrg, body.invoiceId || "", body.method || "cash", aid), 200, request);
      if (sub === "pharmacy" && method === "GET") return json({ ok: true, orders: await BILL.pharmacyQueue(env, bOrg) }, 200, request);
      if (sub === "dispense" && method === "POST") return json(await BILL.dispenseOrder(env, bOrg, body.orderId || "", aid), 200, request);
      return json({ ok: false, error: "not_found" }, 404, request);
    }

    // Role + capabilities, so the client can adapt its UI (server still re-checks every mutation).
    if (method === "GET" && seg === "whoami") {
      // For non-owner/non-doctor identities, the real role is org-scoped (q_members), not the global viewer.
      let role = actor.role, orgId = actor.orgId || url.searchParams.get("orgId") || actor.hospitalId || "";
      // For EVERY identity kind, not only staff: an account that is an invited member (or the owner)
      // of the hospital holds that hospital's role, and a console that read the global "doctor" role
      // instead hid the Admin Center from the person who owns the hospital. The server still
      // re-checks every mutation; this only tells the UI what to offer.
      if (orgId) { const az = await ORG.authorizeOrg(env, actor, orgId, null); if (az.ok && az.role) role = az.role; }
      const smdId = actor.kind === "firebase" ? await ORG.userSmdId(env, actor.id, actor.email) : "";   // StewardMD ID per account
      let orgCode = ""; if (orgId) { const o = await ORG.getOrg(env, orgId); if (o) orgCode = o.code || ""; }
      return json({ ok: true, role: role, caps: capsFor(role), kind: actor.kind, orgId: orgId, orgCode: orgCode, smdId: smdId, name: actor.name, hospitalId: actor.hospitalId || "", billing: BILL.billingEnabled(env) }, 200, request);
    }

    // ---- org / rooms / members config (Phase 3: multi-tenant, isolation-gated) ----
    if (method === "GET" && seg === "orgs") {
      if (actor.kind === "staff" && actor.orgId) {
        // A PIN/email staff session is minted for ONE hospital.
        const org = await ORG.getOrg(env, actor.orgId);
        if (!org) return json({ ok: true, orgs: [] }, 200, request);
        const az = await ORG.authorizeOrg(env, actor, actor.orgId, null);
        return json({ ok: true, orgs: [Object.assign({}, org, { memberRole: az.role || "viewer" })] }, 200, request);
      }
      // Owner orgs (an account) + orgs where this identity is an invited MEMBER (q_members, by id or
      // email - see authorizeOrg's own uid-then-email fallback), for any authenticated identity: an
      // account, a Cloudflare Access user or a GHIS employee whose membership spans hospitals. Owner
      // wins on a collision (a member row on an org this account also owns must never demote the
      // doctor's own view of it to their staff role).
      const owned = actor.kind === "firebase" ? (await ORG.listOrgsForOwner(env, actor.id)).map((o) => Object.assign({}, o, { memberRole: "owner" })) : [];
      const member = await ORG.listOrgsForMember(env, [actor.id, actor.email]);
      const byId = new Map();
      for (const o of member) byId.set(o.id, o);
      for (const o of owned) byId.set(o.id, o);
      return json({ ok: true, orgs: Array.from(byId.values()) }, 200, request);
    }
    if (method === "GET" && (seg === "org" || seg === "rooms" || seg === "members" || seg === "wards" || seg === "beds")) {
      const orgId = url.searchParams.get("orgId") || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, seg === "members" ? CAPS.STAFF_ADMIN : CAPS.QUEUE_VIEW);
      if (!az.ok) return json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      if (seg === "org") return json({ ok: true, org: await ORG.getOrg(env, orgId), departments: await ORG.listDepartments(env, orgId), rooms: await ORG.listRooms(env, orgId), wards: await ORG.listWards(env, orgId) }, 200, request);
      if (seg === "rooms") return json({ ok: true, rooms: await ORG.listRooms(env, orgId) }, 200, request);
      if (seg === "wards") return json({ ok: true, wards: await ORG.listWards(env, orgId) }, 200, request);
      if (seg === "beds") return json({ ok: true, beds: await ORG.listBeds(env, orgId, url.searchParams.get("wardId") || "") }, 200, request);
      return json({ ok: true, members: await ORG.listMembers(env, orgId) }, 200, request);
    }
    // Native investigation/medication catalog (WardSynQ-native hospitals only, initially): a doctor
    // searching to order a test or prescribe a drug needs SOME catalog to search, and GHIS's own
    // /inv-search and /drug-search are meaningless for a hospital with no GHIS. Reuses the org's
    // EXISTING billing tariff store (kind:"investigation"|"medication" rows) as the catalog — no new
    // configuration system, and deliberately NOT gated behind CLINIC_BILLING_ENABLED: whether an
    // org has turned invoicing on is unrelated to whether a doctor may order a test or a drug. An
    // org with no tariff rows yet returns an empty list — honest, not fabricated — and rows are
    // added the same way any tariff item is (bill/tariff POST). ?kind=medication added 2026-09-06
    // for native prescribing; investigation stays the default (unchanged for every existing caller).
    if (method === "GET" && seg === "inv-catalog") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.EMR_TREAT);
      const orgId = s.orgId || s.hospitalId;
      const q = String(url.searchParams.get("q") || "").trim().toLowerCase();
      const wantKind = url.searchParams.get("kind") === "medication" ? "medication" : "investigation";
      let rows = (await BILL.listTariff(env, orgId)).filter((t) => t.kind === wantKind);
      if (q) rows = rows.filter((t) => (t.name || "").toLowerCase().indexOf(q) > -1 || (t.code || "").toLowerCase().indexOf(q) > -1);
      return json({ ok: true, rows: rows.slice(0, 50).map((t) => ({ id: t.id, name: t.name, code: t.code || "" })) }, 200, request);
    }
    // Native prescribing's advisory-only CDSS pre-check (WardSynQ-native hospitals). NEVER gates -
    // see functions/_wardsynq/rx-safety.js's header (unapproved clinical content, per
    // vault/modules/WardSynQ.md's STATUS line). The doctor sees this BEFORE confirming the
    // prescription; the write always proceeds regardless of what it finds.
    if (method === "GET" && seg === "rx-safety") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.EMR_TREAT);
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      const wOrg = await ORG.getOrg(env, s.orgId || s.hospitalId);
      const wsq = await wsqForcedMigration(env, wOrg);
      if (!wsq || wsq.error) return json({ ok: true, safety: { unapproved: true, rulePackVersion: null, unresolvedDrug: true, findings: [], degraded: true } }, 200, request);
      const safety = await checkPrescriptionSafety(request, env, {
        candidate: { drug: url.searchParams.get("drug") || "", generic: url.searchParams.get("generic") || "" },
        patientId: patientIdForTicket(t), tenantId: wsq.tenantId,
        actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, wsq.tenantId), rulePack: getRulePack(),
      });
      return json({ ok: true, safety }, 200, request);
    }
    // Nurse-station board: rooms (status/counts) + unassigned pool for an org+day.
    if (method === "GET" && seg === "opd-board") {
      const orgId = url.searchParams.get("orgId") || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, CAPS.QUEUE_VIEW);
      if (!az.ok) return json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      const org = await ORG.getOrg(env, orgId);
      return json(Object.assign({ ok: true }, await boardForOrg(env, org, url.searchParams.get("date") || "")), 200, request);
    }
    // The doctor's OWN room session in an org — the exact queue the sister routes into on the console.
    // Resolves WHICH room by normalized identity (fb uid / email / ghis id); ?roomId= loads a specific
    // room (the app's picker fallback when no room is auto-assigned to this doctor).
    if (method === "GET" && seg === "my-room") {
      const orgId = url.searchParams.get("orgId") || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, CAPS.QUEUE_VIEW);
      if (!az.ok) return json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      const org = await ORG.getOrg(env, orgId);
      const rooms = await ORG.listRooms(env, orgId);
      const roomId = url.searchParams.get("roomId") || "";
      const rm = roomId ? rooms.filter((r) => r.id === roomId)[0] : roomForActor(rooms, actor);
      if (!rm || !resolveRoomDoctor(rm)) {
        const staffed = rooms.filter((r) => resolveRoomDoctor(r)).map((r) => ({ id: r.id, name: r.name, number: r.number, department: r.department }));
        return json({ ok: true, resolved: false, rooms: staffed }, 200, request);
      }
      const sess = await Q.getOrCreateRoomSession(env, org, rm, url.searchParams.get("date") || "");
      await Q.recompute(env, sess);   // refresh ETAs/positions, then return only the LIVE queue (no terminal/checked-out)
      const active = (await Q.listTickets(env, sess.id)).filter((t) => ACTIVE.indexOf(t.status) > -1);
      return json({ ok: true, resolved: true, room: { id: rm.id, name: rm.name, number: rm.number, department: rm.department }, session: sess, tickets: await ticketView(env, orderRoomView(active)) }, 200, request);
    }
    // Owner/admin mints the login-free wall-display link for a waiting-room screen (90-day, regenerable).
    if (method === "POST" && seg === "display-link") {
      const b = await readBody(request);
      const orgId = b.orgId || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, CAPS.STAFF_ADMIN);
      if (!az.ok) return json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      const exp = Date.now() + 90 * 24 * 3600 * 1000;
      const base = (env && env.QUEUE_LINK_BASE) || "https://stewardmd.in";
      const token = await mintDisplayToken(env, orgId, exp);
      return json({ ok: true, url: base.replace(/\/+$/, "") + "/opd-display?t=" + token, expiresAt: exp }, 200, request);
    }

    if (method === "GET" && seg === "session") {
      const hospitalId = url.searchParams.get("hospitalId") || "manual";
      await requireOrgOrGlobal(env, actor, hospitalId, CAPS.QUEUE_VIEW);   // staff must be a member of this org
      const doctorUid = (actor.kind === "firebase" && !actor.isOwner) ? actor.id : (url.searchParams.get("doctorUid") || actor.id);
      const s = await Q.getOrCreateSession(env, {
        hospitalId: hospitalId,
        doctorUid: doctorUid, doctorName: url.searchParams.get("doctorName") || actor.name || "",
        department: url.searchParams.get("department") || "", date: url.searchParams.get("date") || today(),
        source: url.searchParams.get("source") || "manual"
      });
      const tickets = await Q.recompute(env, s);
      return json({ ok: true, session: s, tickets: await ticketView(env, tickets) }, 200, request);
    }

    // Multi-doctor front-desk board (LEGACY; deprecated in favour of opd-board). Requires org
    // OWNERSHIP/MEMBERSHIP of the hospitalId — no global-role bypass, no cross-account reads.
    if (method === "GET" && seg === "board") {
      const hospitalId = url.searchParams.get("hospitalId") || "";
      if (!hospitalId) return json({ ok: false, error: "hospital_required" }, 400, request);
      const azb = await ORG.authorizeOrg(env, actor, hospitalId, CAPS.QUEUE_VIEW);
      if (!azb.ok) return json({ ok: false, error: azb.reason || "forbidden" }, azb.reason === "org_not_found" ? 404 : 403, request);
      const sessions = await Q.listSessions(env, hospitalId, url.searchParams.get("date") || today());
      const board = [];
      for (const s of sessions) board.push({ session: s, tickets: await ticketView(env, await Q.listTickets(env, s.id)) });
      return json({ ok: true, board: board }, 200, request);
    }

    if (method === "GET" && seg === "list") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.QUEUE_VIEW);
      // Only ACTIVE tickets, matching /my-room. The clients already ignore finished ones
      // (queue.js isQueued), but without this every poll shipped completed and cancelled patients to
      // every signed-in client holding queue.view - reception and interns included. Data minimisation.
      const all = await Q.listTickets(env, s.id);
      return json({ ok: true, session: s, tickets: await ticketView(env, all.filter((t) => ACTIVE.indexOf(t.status) > -1)) }, 200, request);
    }

    // Audit timeline (transparency / anti-misuse) — anyone who can view the queue can see the trail.
    if (method === "GET" && seg === "audit") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.QUEUE_VIEW);
      return json({ ok: true, events: await Q.auditTimeline(env, s, url.searchParams.get("limit")) }, 200, request);
    }

    // Staff role mapping (owner/admin only).
    if (method === "GET" && seg === "staff") {
      requireCap(actor.role, CAPS.STAFF_ADMIN);
      return json({ ok: true, staff: await Q.listStaff(env, url.searchParams.get("hospitalId") || "") }, 200, request);
    }

    // Encounter timeline, staff/doctor view (decrypted). Needs EMR view rights.
    if (method === "GET" && seg === "timeline") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.EMR_VIEW);
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      const out = { ok: true, timeline: await QT.getTimeline(env, t.id) };
      // Where this patient's WardSynQ record lives, whenever this org's tenant is reachable at all —
      // NOT gated to whichever specific write (vitals, registration, assessment...) happens to be
      // migrated for this tenant, because a device reading back must not have to guess which one.
      // Off, the default: no key, the response is what it was. The console reads
      // GET /api/wardsynq/:tenant/patient/:patientId/<Observation|ClinicalNote> with its own
      // credentials; the record decides for itself whether this person may see them.
      // A native wardsynq org links to its record regardless of the global flag (the same
      // wsqForcedMigration() every write for it already uses); every other mode is unchanged.
      const forced = await wsqForcedMigration(env, await ORG.getOrg(env, s.orgId || s.hospitalId));
      const link = forced && !forced.error ? { tenantId: forced.tenantId } : await recordLinkForOrg(env, s.orgId || s.hospitalId, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
      if (link) {
        out.record = { tenantId: link.tenantId, patientId: patientIdForTicket(t), ticketId: t.id };
        // Results is the one migration where "authoritative" does not mean "WardSynQ is the write
        // target" (see migrate-results.js's header) — GHIS is never asked to write anything here.
        // It means only this: the console MAY ALSO read DiagnosticReport back from WardSynQ. Every
        // other card above appears whenever the tenant's record is reachable AT ALL; this key is
        // deliberately narrower, exactly as asked — explicit opt-in, not "any migration is on".
        const rm = await resultsMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
        if (rm.mode === "authoritative") out.record.results = true;
      }
      return json(out, 200, request);
    }
    // Doctor's treated-patient history (self-expiring at the link's 7-30d window).
    if (method === "GET" && seg === "treated") {
      requireCap(actor.role, CAPS.EMR_VIEW);
      return json({ ok: true, treated: await QT.listTreated(env, actor.id) }, 200, request);
    }

    if (method === "GET" && seg === "link") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.QUEUE_VIEW);
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      return json(Object.assign({ ok: true }, await Q.linkFor(env, t)), 200, request);
    }

    if (method === "GET" && seg === "config") return json({ ok: true, config: await Q.getConfig(env, actor.id) }, 200, request);
    if (method === "GET" && seg === "analytics") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      await requireSessionCap(env, actor, s, CAPS.ANALYTICS_VIEW);
      const analytics = await Q.analytics(env, s);
      try { const rev = await BILL.revenueToday(env, s.orgId || s.hospitalId); if (rev) Object.assign(analytics, rev); } catch (e) {}   // clinic revenue dashboard: today's paid total (null when billing off)
      return json({ ok: true, analytics: analytics }, 200, request);
    }

    // ---- Oncology treatment plans (Phase 2, data layer; no UI wiring yet - flag smd_onco_protocols
    // gates the client). Read is allowed even with QUEUE_ONCO_WRITE unset (nothing to disable on a
    // GET); the doctor EMR_TREAT cap is authorized against the PLAN'S OWN hospitalId/orgId (fetched
    // first, same fetch-then-authorize order as loadSessionFor), never a client-supplied one. ----
    if (method === "GET" && seg === "onco" && sub === "plan") {
      const plan = await ONCO.getPlan(env, url.searchParams.get("planId"));
      if (!plan) return json({ ok: false, error: "not_found" }, 404, request);
      await requireOrgOrGlobal(env, actor, plan.hospitalId || plan.orgId, CAPS.EMR_TREAT, plan.doctorUid);
      return json({ ok: true, plan: plan }, 200, request);
    }
    // Cycle read (gap-fix, Phase 5): gated on CAPS.QUEUE_VIEW - the org-member READ cap every role
    // holds (down to a bare "viewer") - NOT CAPS.EMR_TREAT like /onco/plan above. A nurse has no
    // EMR_TREAT, so this is the ONLY way a nurse session can ever read a cycle's give-list +
    // administration history. The plan is deliberately reduced (no lockedTemplate/dose formulas) -
    // just enough to label the header (name/MRN/intent/cycle length); the clinically-actionable
    // CONFIRMED doses travel on the cycle itself (cycle.confirmedDoses), same as the doctor matrix.
    if (method === "GET" && seg === "onco" && sub === "cycle") {
      const cyc = await ONCO.getCycle(env, url.searchParams.get("cycleId"));
      if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
      const plan = await ONCO.getPlan(env, cyc.planId);
      if (!plan) return json({ ok: false, error: "not_found" }, 404, request);
      await requireOrgOrGlobal(env, actor, plan.hospitalId || plan.orgId, CAPS.QUEUE_VIEW, plan.doctorUid);
      const adminRecords = await ONCO.getAdminRecords(env, cyc.cycleId);
      // Nurse-safe template: drug names / routes / days / premeds for the give-list, NO dose formulas.
      const nurseTmpl = ONCO._nurseTemplate(plan.lockedTemplate);
      return json({ ok: true, cycle: cyc, plan: {
        protocolId: plan.protocolId,
        name: nurseTmpl.name,
        ghisPatientId: plan.ghisPatientId,
        intent: plan.intent,
        cycleLengthDays: nurseTmpl.cycleLengthDays,
        lockedTemplate: nurseTmpl,
      }, adminRecords: adminRecords }, 200, request);
    }
    // ONCQIS Phase B: read-only protocol RECOMMENDATION (flag smd_onco_recommend gates the client).
    // Decision-SUPPORT only - suggests APPLICABLE ACTIVE Standard Protocols for a clinical phenotype
    // and never auto-selects/prescribes (always the full applicable list, reviewRequired:true). Gated
    // on CAPS.QUEUE_VIEW (a pure read; nothing to disable on a GET). The phenotype is CLINICAL params
    // ONLY (diseaseId/stage/biomarkers/setting/intent/line) - NEVER a name/MRN, and nothing here logs.
    if (method === "GET" && seg === "onco" && sub === "recommend") {
      requireCap(actor.role, CAPS.QUEUE_VIEW);   // any org-member read cap; PHI-free reference data
      let biomarkers = null;
      try { const raw = url.searchParams.get("biomarkers"); if (raw) biomarkers = JSON.parse(raw); } catch (e) { biomarkers = null; }
      const phenotype = {
        diseaseId: url.searchParams.get("diseaseId") || null,
        stage: url.searchParams.get("stage") || null,
        biomarkers: biomarkers,
        setting: url.searchParams.get("setting") || null,
        intent: url.searchParams.get("intent") || null,
        line: url.searchParams.get("line") || null,
      };
      const active = activeStandardProtocols();
      if (!active.length) return json({ ok: true, applicable: [], note: "no ACTIVE protocols published yet", reviewRequired: true }, 200, request);
      const rec = ONCORECOMMEND.recommend(phenotype, active);
      return json({ ok: true, applicable: rec.applicable, reviewRequired: rec.reviewRequired }, 200, request);
    }

    if (method === "POST") {
      const body = await readBody(request);
      if (seg === "config") { requireCap(actor.role, CAPS.SESSION_MANAGE); return json({ ok: true, config: await Q.saveConfig(env, actor.id, body.config || body) }, 200, request); }
      if (seg === "staff") {   // owner manages the employeeId -> role mapping
        requireCap(actor.role, CAPS.STAFF_ADMIN);
        if (body.remove) { await Q.removeStaff(env, body.employeeId, actor.id); return json({ ok: true }, 200, request); }
        return json({ ok: true, staff: await Q.setStaff(env, body.employeeId, body, actor.id) }, 200, request);
      }
      // ---- org / rooms / members config + onboarding (Phase 3, isolation-gated) ----
      const azOrg = async (cap, target) => ORG.authorizeOrg(env, actor, body.orgId, cap, target);
      const deny = (az) => json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      const needAccount = () => actor.kind !== "firebase";   // creating an org needs a StewardMD account (= the owner)
      if (seg === "org" && !sub) {
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        /* A PG institution is SOLD, not self-served: it is provisioned for a college through the
         * owner-gated /api/tenants route, which also names its admin. Anyone may still create a
         * clinic here - that is the existing OPD flow and is unchanged - but minting an institution
         * would put a self-appointed "Academic Cell" in charge of a recognised programme. */
        if (String(body && body.kind) === "institution" && !(await ownerOK(request, env)))
          return json({ ok: false, error: "institution_provisioning_required" }, 403, request);
        return json({ ok: true, org: await ORG.createOrg(env, body, actor.id) }, 200, request);
      }
      if (seg === "org" && sub === "update") {
        const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az);
        const updated = await ORG.updateOrg(env, body.orgId, body, actor.id);
        // Best-effort, only when this update actually set/changed the tenant link - see
        // wsqLinkTenantOrg's own header for why this is a real fix, not a nice-to-have.
        if (body.connectTenantId) await wsqLinkTenantOrg(env, updated);
        return json({ ok: true, org: updated }, 200, request);
      }
      if (seg === "org" && sub === "delete") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, deleted: await ORG.deleteOrg(env, body.orgId, actor.id) }, 200, request); }
      // One-tap: turn a Connect EMR connection into an OPD hospital (so it appears in the app's Hospital list
      // and its FHIR worklist auto-imports). Called from the Connect wizard's "Use in OPD" button.
      if (seg === "org" && sub === "from-connect") {
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        if (!body.connectTenantId || !body.connectConnectionId) return json({ ok: false, error: "missing_link" }, 400, request);
        const o = await ORG.createOrg(env, { name: body.name || "Connected Hospital", mode: "connect", connectorId: "connect" }, actor.id);
        const linked = await ORG.updateOrg(env, o.id, { connectTenantId: body.connectTenantId, connectConnectionId: body.connectConnectionId }, actor.id);
        return json({ ok: true, org: linked }, 200, request);
      }
      if (seg === "dept") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, department: await ORG.createDepartment(env, body.orgId, body, actor.id) }, 200, request); }
      if (seg === "opd") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, opd: await ORG.createOpd(env, body.orgId, body, actor.id) }, 200, request); }
      if (seg === "room" && !sub) { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, room: await ORG.createRoom(env, body.orgId, body, actor.id) }, 200, request); }
      if (seg === "room" && sub === "update") { const az = await azOrg(CAPS.STAFF_ADMIN, { roomId: body.roomId }); if (!az.ok) return deny(az); return json({ ok: true, room: await ORG.updateRoom(env, body.roomId, body, actor.id) }, 200, request); }
      if (seg === "ward" && !sub) { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, ward: await ORG.createWard(env, body.orgId, body, actor.id) }, 200, request); }
      if (seg === "ward" && sub === "update") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, ward: await ORG.updateWard(env, body.wardId, body, actor.id) }, 200, request); }
      if (seg === "bed" && !sub) { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, bed: await ORG.createBed(env, body.orgId, body, actor.id) }, 200, request); }
      if (seg === "bed" && sub === "update") {
        const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az);
        // TASK 4.3: server-side concurrency, not trust in the client. Two staff racing to
        // assign/release/block the same bed get ONE winner; the loser is told to refetch and
        // retry, never handed a write that silently overwrote what they thought they saw.
        try { return json({ ok: true, bed: await ORG.updateBed(env, body.bedId, body, actor.id) }, 200, request); }
        catch (e) { if (e && e.code === "bed_changed") return json({ ok: false, error: "bed_changed", message: "This bed changed under you - reload it and try again." }, 409, request); throw e; }
      }
      if (seg === "member") {   // staff lifecycle (owner/admin only): invite/role/scope + credentials + enable/disable
        const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az);
        if (sub === "pin") { await ORG.setMemberPin(env, body.orgId, body.identity, body.pin, actor.id); return json({ ok: true }, 200, request); }
        if (sub === "password") { await ORG.setMemberPassword(env, body.orgId, body.identity, body.email, body.password, actor.id); return json({ ok: true }, 200, request); }
        if (sub === "disable") { await ORG.setMemberActive(env, body.orgId, body.identity, false, actor.id); return json({ ok: true }, 200, request); }
        if (sub === "restore") { await ORG.setMemberActive(env, body.orgId, body.identity, true, actor.id); return json({ ok: true }, 200, request); }
        if (sub === "reset") { await ORG.resetMemberAccess(env, body.orgId, body.identity, actor.id); return json({ ok: true }, 200, request); }
        if (body.remove) { await ORG.removeMembership(env, body.orgId, body.identity, actor.id); return json({ ok: true }, 200, request); }
        // setMembership refuses a create with no role rather than writing a silent read-only viewer.
        const saved = await ORG.setMembership(env, body.orgId, body.identity, body, actor.id);
        if (saved && saved.ok === false) return json(saved, 400, request);
        return json({ ok: true, member: saved }, 200, request);
      }
      if (seg === "onboard" && sub === "clinic") {   // private-clinic quick setup: native org + one room
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        const o = await ORG.createOrg(env, { name: body.name || "My Clinic", mode: "native" }, actor.id);
        const r = await ORG.createRoom(env, o.id, { name: body.roomName || "Consulting Room", assignment: { mode: "primary", primary: actor.id, doctors: [actor.id] } }, actor.id);
        return json({ ok: true, org: o, room: r }, 200, request);
      }
      if (seg === "onboard" && sub === "hospital") {  // EMR hospital: connect org (connector by config)
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        const o = await ORG.createOrg(env, { id: body.hospitalId || undefined, name: body.name || "Hospital", mode: "connect", connectorId: body.connectorId || null }, actor.id);
        return json({ ok: true, org: o }, 200, request);
      }
      if (seg === "onboard" && sub === "wardsynq") {   // self-service: a WardSynQ-native hospital (org + its own clinical-record tenant)
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        if (!env.CONNECT_DB) return json({ ok: false, error: "record_store_unavailable" }, 503, request);
        const t = await selfCreateTenant({ db: env.CONNECT_DB, identifyFn: identify }, request, env, { name: body.name });
        try {
          // The hospital's country, chosen at creation. Absent means India, as everywhere else.
          let o = await ORG.createOrg(env, { name: body.name, mode: "wardsynq", region: body.region }, actor.id);
          o = await ORG.updateOrg(env, o.id, { connectTenantId: t.id }, actor.id);
          await wsqLinkTenantOrg(env, o);
          return json({ ok: true, org: o, tenantId: t.id }, 200, request);
        } catch (e) {
          // The tenant already exists at this point - never leave it silently unlinked without saying so.
          return json({ ok: false, error: "org_create_failed", tenantId: t.id }, 500, request);
        }
      }
      if (seg === "migrate" && sub === "backfill") {  // idempotent legacy hospitalId -> org
        if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request);
        return json({ ok: true, org: await ORG.backfillOrg(env, body.hospitalId, actor.id, body.mode, body.connectorId) }, 200, request);
      }
      // ---- nurse-station runtime: register into the pool + assign a patient to a room ----
      if (seg === "pool") {   // register a department-level walk-in into the central unassigned pool
        const az = await azOrg(CAPS.QUEUE_ADD); if (!az.ok) return deny(az);
        const org = await ORG.getOrg(env, body.orgId);
        let t = await Q.addToPool(env, org, body, actor.id);
        // AUTO-ROUTE (2026-08-24): the pool exists so a big hospital's reception can triage into many
        // rooms. A clinic with exactly ONE staffed room has nothing to triage - but the ticket still sat
        // in the pool until someone tapped "Route to a room", and the doctor's app (which polls only its
        // OWN room session) never saw the patient. Staff reasonably read "Add to pool" as done.
        // So when there is exactly one room with a resolved doctor, route it there immediately.
        // Multi-room orgs are untouched: they still get the explicit triage step.
        try {
          const staffed = (await ORG.listRooms(env, org.id)).filter((r) => resolveRoomDoctor(r));
          if (staffed.length === 1) {
            await Q.assignToRoom(env, org, t.id, staffed[0], { date: body.date }, actor.id);
            t = (await Q.getTicket(env, t.id)) || t;
          }
        } catch (e) { /* routing is best-effort: the ticket still exists in the pool to route by hand */ }
        return json({ ok: true, ticket: (await ticketView(env, [t]))[0], board: await boardForOrg(env, org, body.date || "") }, 200, request);
      }
      if (seg === "assign-room") {   // nurse assigns a pool/room ticket to a specific room
        const room = await ORG.getRoom(env, body.roomId);
        if (!room || String(room.orgId) !== String(body.orgId)) return json({ ok: false, error: "room_not_found" }, 404, request);
        const az = await azOrg(CAPS.QUEUE_ASSIGN, { roomId: room.id, departmentId: room.departmentId }); if (!az.ok) return deny(az);
        // Setting urgent priority needs QUEUE_PRIORITY separately - reception may route but not mark urgent. Drop the
        // priority (never deny the whole routing) unless the actor also holds it, so a crafted request can't bypass the role.
        const azP = body.priority ? await azOrg(CAPS.QUEUE_PRIORITY, { roomId: room.id, departmentId: room.departmentId }) : { ok: false };
        const org = await ORG.getOrg(env, body.orgId);
        try { await Q.assignToRoom(env, org, body.ticketId, room, { priority: (azP.ok ? body.priority : 0), reason: body.reason, date: body.date, doctorName: body.doctorName }, actor.id); }
        catch (e) { return json({ ok: false, error: (e && e.message) || "assign_failed" }, (e && e.status) || 500, request); }
        return json({ ok: true, board: await boardForOrg(env, org, body.date || "") }, 200, request);
      }
      // ---- Oncology treatment plans (Phase 2 data layer + Phase 5 cycle/clearance/nurse execution;
      // suggest-and-confirm, no auto-order). Every mutating route is inert (501) until
      // QUEUE_ONCO_WRITE=1; then role-split via requireOrgOrGlobal, authorized against the underlying
      // plan's OWN hospitalId - resource is fetched first (cycle -> its plan) so a caller can never
      // borrow a hospitalId they belong to to reach a cycle/plan that belongs to a different org.
      // DOCTOR cap (EMR_TREAT, same cap the timeline "extend"/assessment write path uses): create
      // plan, confirm & activate plan, create cycle, resolve clearance, confirm cycle to ready.
      // NURSE cap (EMR_VITALS, same cap the "record vitals" timeline path uses - the least-privilege
      // clinical-write cap a nurse/intern/resident/doctor role actually holds, unlike QUEUE_VIEW which
      // every role including a bare "viewer" has): start a cycle, record administration, complete a
      // cycle. A nurse can never create/dose/override/confirm-to-ready (spec R11).
      if (seg === "onco") {
        if (!oncoWriteEnabled(env)) return json({ error: "onco_write_disabled" }, 501, request);
        const sub2 = parts[2] || "";
        if (sub === "plan" && !sub2) {   // create - DOCTOR
          const tmpl = oncoProtocolTemplate(body.protocolId) || clientProtocolTemplate(body.template);
          if (!tmpl) return json({ ok: false, error: "protocol_not_found" }, 404, request);
          await requireOrgOrGlobal(env, actor, body.hospitalId || body.orgId, CAPS.EMR_TREAT);
          return json({ ok: true, plan: await ONCO.createPlan(env, body, tmpl) }, 200, request);
        }
        if (sub === "plan" && sub2 === "confirm") {   // confirm & activate - DOCTOR
          const plan = await ONCO.getPlan(env, body.planId);
          if (!plan) return json({ ok: false, error: "not_found" }, 404, request);
          await requireOrgOrGlobal(env, actor, plan.hospitalId || plan.orgId, CAPS.EMR_TREAT, plan.doctorUid);
          // Options-form call -> Phase F pre-activation gate runs. physicianConfirmed must be an EXPLICIT
          // client true (the doctor's CONFIRM & ACTIVATE tap); it is never inferred, so activation is
          // gated and never automatic. The gate throws (400) with the blocker list on any failure.
          try { return json({ ok: true, plan: await ONCO.confirmPlan(env, body.planId, { overrides: body.overrides || [], physicianConfirmed: body.physicianConfirmed === true }) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "confirm_failed" }, 400, request); }
        }
        if (sub === "plan" && sub2 === "emr") {   // ADD TO EMR (structured write) - DOCTOR, EXPLICIT action ONLY, only after activation
          const plan = await ONCO.getPlan(env, body.planId);
          if (!plan) return json({ ok: false, error: "not_found" }, 404, request);
          await requireOrgOrGlobal(env, actor, plan.hospitalId || plan.orgId, CAPS.EMR_TREAT, plan.doctorUid);
          if (plan.status !== "active") return json({ ok: false, error: "plan_not_active" }, 400, request);   // never before CONFIRM & ACTIVATE
          // GHIS auth: writing into the LIVE hospital EMR needs the doctor's GHIS session token (its own
          // header, never a URL param, never the Firebase Authorization Bearer). No GHIS session -> no write.
          const ghisToken = request.headers.get("X-Ghis-Token") || "";
          if (!ghisToken) return json({ ok: false, error: "ghis_auth_required" }, 401, request);
          // Which structured fields the EMR supports is owner-config (VERIFIED slots only); default none.
          // The GHIS structured-write network call stays unwired here until a real oncology payload is
          // captured (same discipline as prescribe() in functions/api/ghis), so with no emrWrite dep every
          // field falls back to the attached Tata PDF - never a fabricated structured write.
          // ponytail: supported-field config is the calibration knob for a real EMR; wire deps.emrWrite/
          // emrAttachPdf here once the GHIS oncology payload is captured + verified.
          let supported = []; try { supported = JSON.parse(env.QUEUE_ONCO_EMR_FIELDS || "[]"); } catch (e) { supported = []; }
          try { return json({ ok: true, emr: await ONCO.writePlanToEmr(env, body.planId, { supportedFields: supported, diagnosis: body.diagnosis || "", patientName: body.patientName || "", by: actor.id }) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "emr_write_failed" }, 400, request); }
        }
        if (sub === "cycle" && !sub2) {   // create - DOCTOR
          const plan = await ONCO.getPlan(env, body.planId);
          if (!plan) return json({ ok: false, error: "not_found" }, 404, request);
          await requireOrgOrGlobal(env, actor, plan.hospitalId || plan.orgId, CAPS.EMR_TREAT, plan.doctorUid);
          return json({ ok: true, cycle: await ONCO.createCycle(env, body.planId, body.cycleNo) }, 200, request);
        }
        if (sub === "cycle" && sub2 === "clearance") {   // pre-chemo clearance attestation - DOCTOR
          const cyc = await ONCO.getCycle(env, body.cycleId);
          if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
          const plan = await ONCO.getPlan(env, cyc.planId);
          await requireOrgOrGlobal(env, actor, plan && (plan.hospitalId || plan.orgId), CAPS.EMR_TREAT, plan && plan.doctorUid);
          try { return json({ ok: true, cycle: await ONCO.resolveClearance(env, body.cycleId, { checks: body.checks || [], status: body.status, by: actor.id }) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "clearance_failed" }, 400, request); }
        }
        if (sub === "cycle" && sub2 === "confirm") {   // planned -> ready, BLOCKED unless clearance is "cleared" - DOCTOR
          const cyc = await ONCO.getCycle(env, body.cycleId);
          if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
          const plan = await ONCO.getPlan(env, cyc.planId);
          await requireOrgOrGlobal(env, actor, plan && (plan.hospitalId || plan.orgId), CAPS.EMR_TREAT, plan && plan.doctorUid);
          try { return json({ ok: true, cycle: await ONCO.confirmCycle(env, body.cycleId) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "confirm_failed" }, 400, request); }
        }
        if (sub === "cycle" && sub2 === "start") {   // ready -> administering ("nurse starts") - NURSE
          const cyc = await ONCO.getCycle(env, body.cycleId);
          if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
          const plan = await ONCO.getPlan(env, cyc.planId);
          await requireOrgOrGlobal(env, actor, plan && (plan.hospitalId || plan.orgId), CAPS.EMR_VITALS, plan && plan.doctorUid);
          try { return json({ ok: true, cycle: await ONCO.startCycle(env, body.cycleId) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "start_failed" }, 400, request); }
        }
        if (sub === "cycle" && sub2 === "complete") {   // administering -> done - NURSE
          const cyc = await ONCO.getCycle(env, body.cycleId);
          if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
          const plan = await ONCO.getPlan(env, cyc.planId);
          await requireOrgOrGlobal(env, actor, plan && (plan.hospitalId || plan.orgId), CAPS.EMR_VITALS, plan && plan.doctorUid);
          try { return json({ ok: true, cycle: await ONCO.completeCycle(env, body.cycleId) }, 200, request); }
          catch (e) { return json({ ok: false, error: (e && e.message) || "complete_failed" }, 400, request); }
        }
        if (sub === "admin" && !sub2) {   // record one administration row (append-only) - NURSE
          const cyc = await ONCO.getCycle(env, body.cycleId);
          if (!cyc) return json({ ok: false, error: "not_found" }, 404, request);
          const plan = await ONCO.getPlan(env, cyc.planId);
          await requireOrgOrGlobal(env, actor, plan && (plan.hospitalId || plan.orgId), CAPS.EMR_VITALS, plan && plan.doctorUid);
          return json({ ok: true, admin: await ONCO.recordAdmin(env, Object.assign({}, body, { administeredBy: actor.id })) }, 200, request);
        }
        return json({ ok: false, error: "not_found" }, 404, request);
      }
      const { s, err } = await loadSessionFor(env, body.sessionId, actor); if (err) return err;
      if (seg === "ticket") {
        await requireSessionCap(env, actor, s, CAPS.QUEUE_ADD);
        const t = await Q.addTicket(env, s, body, actor.id);
        await syncEncounter(request, env, s, t);   // open: today's visit begins at check-in
        return json({ ok: true, ticket: (await ticketView(env, [t]))[0] }, 200, request);
      }
      if (seg === "import") {
        await requireSessionCap(env, actor, s, CAPS.QUEUE_ADD);
        const before = new Set((await Q.listTickets(env, s.id)).map((x) => x.id));
        const r = await importRoster(env, s, body.rows || [], actor.id);
        const tickets = await Q.listTickets(env, s.id);
        // Only the tickets THIS import actually created — not the whole roster on every poll (see
        // migrate-encounter.js's header on the reconciliation cancel this diff does not catch either).
        for (const t of tickets) { if (!before.has(t.id)) await syncEncounter(request, env, s, t); }
        return json({ ok: true, imported: r.imported, skipped: r.skipped, removed: r.removed, tickets: await ticketView(env, tickets) }, 200, request);
      }
      // OPD engine → resolveOpdSource(org) → connector → existing EMR. Server pulls the worklist via the
      // org's connector (GHIS or other) instead of the client hitting /api/ghis; degrades to native.
      if (seg === "import-from-source") {
        await requireSessionCap(env, actor, s, CAPS.QUEUE_ADD);
        // A stored connect org (linked to an EMR-Connect hospital) uses its own connector + linkage; a GHIS
        // org (env-mapped hospitalId like "manual", no stored record) falls back to the env connector map.
        const stored = await ORG.getOrg(env, s.hospitalId);
        const org = (stored && stored.mode === "connect") ? stored : opdOrgFor(env, s.hospitalId);
        const ghisToken = request.headers.get("X-Ghis-Token") || "";
        const before = new Set((await Q.listTickets(env, s.id)).map((x) => x.id));
        const r = await importFromSource(env, s, org, { ghisToken: ghisToken, date: body.date || "", cb: body.cb || "", actor: actor.id });
        const tickets = await Q.listTickets(env, s.id);
        for (const t of tickets) { if (!before.has(t.id)) await syncEncounter(request, env, s, t); }
        return json({ ok: true, source: r.source, connector: org.connectorId || null, imported: r.imported || 0, skipped: r.skipped || 0, removed: r.removed || 0, degraded: !!r.degraded, native: !!r.native, tickets: await ticketView(env, tickets) }, 200, request);
      }
      if (seg === "advance") { await requireSessionCap(env, actor, s, CAPS.QUEUE_STATUS); return json({ ok: true, tickets: await ticketView(env, await Q.advance(env, s, actor.id)) }, 200, request); }
      if (seg === "status") {
        await requireSessionCap(env, actor, s, CAPS.QUEUE_STATUS);
        const tickets = await Q.setStatus(env, s, body.ticketId, body.status, actor.id);
        // Continuation and close both land here: recordEncounterSync reads the ticket's CURRENT
        // status (whatever it just became) and maps it itself — see migrate-encounter.js's header.
        const changed = tickets.find((x) => x.id === body.ticketId);
        if (changed) await syncEncounter(request, env, s, changed);
        return json({ ok: true, tickets: await ticketView(env, tickets) }, 200, request);
      }
      if (seg === "priority") { await requireSessionCap(env, actor, s, CAPS.QUEUE_PRIORITY); return json({ ok: true, tickets: await ticketView(env, await Q.setPriority(env, s, body.ticketId, body.priority, actor.id)) }, 200, request); }
      if (seg === "move") { await requireSessionCap(env, actor, s, CAPS.QUEUE_REORDER); return json({ ok: true, tickets: await ticketView(env, await Q.moveTicket(env, s, body.ticketId, body, actor.id)) }, 200, request); }
      if (seg === "assign") { await requireSessionCap(env, actor, s, CAPS.QUEUE_ASSIGN); return json({ ok: true, tickets: await ticketView(env, await Q.assignTicket(env, s, body.ticketId, body.toDoctorUid, body, actor.id)) }, 200, request); }
      if (seg === "revoke") { await requireSessionCap(env, actor, s, CAPS.QUEUE_REMOVE); await Q.revokeTicket(env, s, body.ticketId, actor.id); return json({ ok: true, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request); }
      if (seg === "session" && sub === "status") { await requireSessionCap(env, actor, s, CAPS.SESSION_MANAGE); return json({ ok: true, session: await Q.setSessionStatus(env, s, body, actor.id) }, 200, request); }

      // Add a clinical entry to the encounter timeline. Vitals => nurse (EMR_VITALS); notes/meds/
      // assessment => doctor (EMR_TREAT). "Add to timeline" for meds writes ONLY here (no pharmacy/EMR).
      if (seg === "timeline" && sub === "extend") {
        await requireSessionCap(env, actor, s, CAPS.EMR_TREAT);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        return json(Object.assign({ ok: true }, await QT.extendTimeline(env, t.id, body.days)), 200, request);
      }
      if (seg === "timeline") {
        const isVitals = QT.tlKind(body.kind) === "vitals";
        const isAssessment = QT.tlKind(body.kind) === "assessment";
        const isSignOff = isAssessment && body.signOff === true;   // the doctor's Authorise, after GHIS confirmed it
        // The doctor's investigation order rides the kind:"note" line it ALREADY mirrors as, told
        // apart by the structured `order` payload opd-emr.js now sends beside the sentence. A plain
        // note (the many other things that kind carries) has no `order` and is untouched.
        const isInvOrder = QT.tlKind(body.kind) === "note" && !!body.order && typeof body.order === "object";
        // The prescription rides its own kind:"medication" line the same way, told apart by the
        // structured `rx` payload. A "medication" line with no `rx` (the local clinic store's
        // "Medication added to the record") is not a prescription and is untouched.
        const isPrescription = QT.tlKind(body.kind) === "medication" && !!body.rx && typeof body.rx === "object";
        await requireSessionCap(env, actor, s, isVitals ? CAPS.EMR_VITALS : CAPS.EMR_TREAT);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        // NATIVE WARDSYNQ HOSPITAL (org.mode "wardsynq"): vitals, assessment and investigation orders
        // go DIRECTLY to the WardSynQ record for such an org - no GHIS to shadow, so this bypasses the
        // global WARDSYNQ_RECORD flag entirely (stays OFF/untouched - it governs the separate
        // GHIS-shadow feature). org.mode is the ONLY signal, never inferred; every other mode (native
        // personal clinic, connect FHIR EMR, GHIS) takes the unchanged flag-gated path below. Reuses
        // the SAME migrator/ctx dispatch and recordX functions verbatim - only how `mig` is computed
        // differs. PRESCRIPTIONS, since 2026-09-06 (second pass): forced authoritative like the other
        // three, now that rx-safety.js's advisory-only CDSS pre-check exists (GET /rx-safety, called
        // by opd-emr.js BEFORE the doctor confirms). That check NEVER gates this write - it cannot,
        // per its own header (unapproved clinical content) - so a prescription with no known
        // interaction data behaves exactly as one with a clean check: the record write proceeds
        // either way, informed rather than blind.
        let wsqMig = null;
        if (isVitals || isAssessment || isInvOrder || isPrescription) {
          const wOrg = await ORG.getOrg(env, s.orgId || s.hospitalId);
          wsqMig = await wsqForcedMigration(env, wOrg);
          if (wsqMig && wsqMig.error) return json({ ok: false, error: wsqMig.error }, 409, request);
        }
        // Four independent migrations share this one endpoint, because that is where each write
        // already lands: the nurse's vitals (_wardsynq/migrate-vitals.js), the doctor's assessment
        // (_wardsynq/migrate-assessment.js), the investigation order (_wardsynq/migrate-inv-order.js)
        // and, since 2026-09-06, the prescription (_wardsynq/migrate-prescription.js). Each reads its
        // OWN tenant settings key, so a clinic can run vitals on and prescriptions off. A "note" with
        // no `order`, and a "medication" with no `rx`, are both still untouched. With the tenant "off"
        // (the default, and every tenant today) no branch is entered and the response is unchanged.
        //
        // The prescription additionally cannot fire at all for a GHIS/Connect hospital until GHIS
        // prescribing is verified and enabled (QUEUE_EMR_PRESCRIBE_OK): /prescribe answers 501 today
        // and opd-emr.js's postWrite returns before the timeline mirror, so a prescription GHIS
        // refused reaches nothing here. A wardsynq org has no GHIS gate to wait on - see wsqMig above.
        const mig = wsqMig || (isVitals ? await vitalsMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow })
          : isAssessment ? await assessmentMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow })
          : isInvOrder ? await invOrderMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow })
          : isPrescription ? await prescriptionMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow })
          : { mode: "off" });
        const migrator = isVitals ? recordVitals : isSignOff ? recordAssessmentSignOff : isInvOrder ? recordInvestigationOrder : isPrescription ? recordPrescription : recordAssessment;
        if (mig.mode !== "off") {
          const ctx = isVitals
            ? { migration: mig, session: s, ticket: t, vitals: body.vitals, note: body.vitals && body.vitals.note, recordedAt: new Date().toISOString(), actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) }
            : isInvOrder
            ? { migration: mig, session: s, ticket: t, order: body.order, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) }
            : isPrescription
            ? { migration: mig, session: s, ticket: t, rx: body.rx, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) }
            : { migration: mig, session: s, ticket: t, vals: body.vals, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) };
          if (mig.mode === "authoritative") {
            // The record must accept before the timeline copy is made — true for vitals, whose
            // record write and timeline write are peers in this ONE request. For the assessment, the
            // investigation order and the prescription the GHIS write already happened via a wholly
            // separate request before this endpoint was even reached (each migrate-*.js explains
            // why); "authoritative" there means the refusal is reported to the caller, not that
            // anything upstream is undone.
            const rec = await migrator(request, env, ctx);
            if (!rec.ok) return json({ ok: false, error: "record_refused", wardsynq: rec }, rec.status || 502, request);
            // Best-effort allergy capture, wardsynq-native content saves ONLY (never sign-off, which
            // carries no vals; never a GHIS-shadow tenant that happens to also be authoritative -
            // wsqMig, not mig.mode alone, is what distinguishes them). Reuses the SAME
            // Known_allergies_details field the assessment form already asks every doctor - no new
            // UI. A failure here must never affect the assessment's own success: it is exactly the
            // syncEncounter() contract (await, but the result changes nothing about this response).
            if (isAssessment && !isSignOff && wsqMig) {
              try { await recordAllergiesFromAssessment(request, env, { migration: mig, ticket: t, vals: body.vals, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId), rulePack: getRulePack() }); } catch (e) {}
            }
            const legacy = await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id);
            return json(Object.assign({ ok: true }, legacy, { wardsynq: rec }), 200, request);
          }
          // shadow: the timeline is still what the ward reads; the record write reports, never throws.
          const legacy = await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id);
          const rec = await migrator(request, env, ctx);
          return json(Object.assign({ ok: true }, legacy, { wardsynq: rec }), 200, request);
        }
        return json(Object.assign({ ok: true }, await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id)), 200, request);
      }
      // A mirror of a READ, not of a write (migrate-results.js's header explains why this is its own
      // segment rather than riding "timeline"): after the client fetches a lab/radiology result from
      // GHIS via /api/ghis (unchanged, untouched by this route), it separately reports what it saw
      // here so a tenant with the migration on can also file it as a DiagnosticReport. There is no
      // legacy timeline entry to append — a result is not a new sentence in the visit summary, it is
      // GHIS data becoming available. Requires EMR_TREAT: see migrate-results.js for why a nurse's
      // Observation-only write scope makes this a doctor-only mirror, unlike the vitals write above.
      if (seg === "result") {
        await requireSessionCap(env, actor, s, CAPS.EMR_TREAT);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        const mig = await resultsMigration(env, s, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
        const rec = await recordResult(request, env, { migration: mig, ticket: t, source: body.source, order: body.order, detail: body.detail, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) });
        // Best-effort either way: GHIS's read already happened and is not reopened by this outcome.
        return json({ ok: true, wardsynq: rec }, 200, request);
      }
      // Slide-to-checkout: seal + share the timeline, close the patient, call the next.
      if (seg === "checkout") {
        await requireSessionCap(env, actor, s, CAPS.QUEUE_STATUS);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        const fin = await QT.finalizeCheckout(env, s, t, actor.id);
        if (t.status !== "in_consultation" && t.status !== "completed") await Q.setStatus(env, s, t.id, "in_consultation", actor.id).catch(() => {});
        await Q.setStatus(env, s, t.id, "completed", actor.id).catch(() => {});
        // Close: the visit just ended. Read the ticket back rather than trust `t`, which is still the
        // PRE-checkout snapshot taken above.
        const closed = await Q.getTicket(env, t.id);
        if (closed) await syncEncounter(request, env, s, closed);
        let sent = null; try { sent = await notifyTimeline(env, s, t, fin.url); } catch (e) {}   // WhatsApp/SMS the link
        const tickets = await Q.callNext(env, s, actor.id);
        return json({ ok: true, timelineUrl: fin.url, linkExpiresAt: fin.linkExpiresAt, sent: !!(sent && sent.ok), tickets: await ticketView(env, tickets) }, 200, request);
      }
    }

    return json({ ok: false, error: "not_found" }, 404, request);
  } catch (e) {
    const status = (e && e.status) || 500;
    /* OBSERVABILITY, 2026-09-10. The single choke point every unhandled exception on this router
     * already passes through - the one place a request-error + latency line can be emitted with no
     * new plumbing and no new risk to the response itself. PHI-free by construction: `seg` is a URL
     * PATH SEGMENT ("ward", "auth", "patient" - a route name, never patient content), and
     * observability.js's own allow-list refuses anything else. Never blocks or alters the response -
     * logEvent() cannot throw, and is called AFTER the response is already decided. */
    logEvent(KIND.REQUEST_ERROR, { route: seg, status, durationMs: Date.now() - __t0, code: e && e.name });
    return json({ ok: false, error: (e && e.message) || "error" }, status, request);
  }
}
