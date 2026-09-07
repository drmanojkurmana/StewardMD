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
import { admitPatient, listWard, recordWardVitals, createWardMedicationOrder, transferPatient, bedBoard } from "../../_wardsynq/migrate-inpatient.js";
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
import { patientEverything, readResource, capabilityStatement } from "../../_wardsynq/fhir.js";
import { startReconciliation, decideMedicine, readReconciliation } from "../../_wardsynq/med-reconciliation.js";
import { wardMetrics } from "../../_wardsynq/ward-metrics.js";
import { releaseResult, pendingRequests } from "../../_wardsynq/lab-result.js";
import { mergePatients, unmergePatients, identityOf } from "../../_wardsynq/identity-merge.js";
import { overrideReport } from "../../_wardsynq/override-analytics.js";
import { listOrderSets, prepareOrderSet, recordApplication } from "../../_wardsynq/order-sets.js";
import { recordConsent, withdrawConsent, consentStatus } from "../../_wardsynq/consent.js";
import { bookAppointment, setAppointmentState, requestFollowUp, listSchedule } from "../../_wardsynq/scheduling.js";
import { setCarePlan, recordProgress, readCarePlan } from "../../_wardsynq/care-plan.js";
import { listTemplates, writeTemplatedNote } from "../../_wardsynq/note-templates.js";
/* Aliased: `recordAssessment` is already the OPD assessment writer in this file, and a risk
 * assessment is a different thing entirely. Two names that read the same for two different
 * clinical acts is how the wrong one gets called. */
import { queueTransmission, recordOutcome, resolveTransmission, listTransmissions } from "../../_wardsynq/prescription-transmit.js";
import { submitNote, signNote, listAwaitingCoSign } from "../../_wardsynq/note-cosign.js";
import { downtimePack } from "../../_wardsynq/downtime.js";
import { qualityReport } from "../../_wardsynq/quality.js";
import { collectSpecimen, specimenOutcome, collectionList } from "../../_wardsynq/specimen.js";
import { adtForEncounter, oruForReport } from "../../_wardsynq/hl7v2.js";
import { requestAdmission, closeAdmissionRequest, admissionWaitingList } from "../../_wardsynq/admission-request.js";
import { registryReport } from "../../_wardsynq/registry.js";
import { chartWound, listWounds } from "../../_wardsynq/wound.js";
import { bookResource, setBookingState, resourceSchedule } from "../../_wardsynq/resource-booking.js";
import { flowsheet } from "../../_wardsynq/flowsheet-view.js";
import { orderInvestigation } from "../../_wardsynq/ward-order.js";
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
    return await recordEncounterSync(request, env, { migration: mig, ticket, session: s, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) });
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

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || ""; const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token, X-Staff-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }
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
  forbidden: "Your role cannot check patients in. Ask the owner to grant a role that can.",
};
function azRefusal(az) {
  const reason = (az && az.reason) || "forbidden";
  const out = { ok: false, error: reason, message: AZ_SAY[reason] || AZ_SAY.forbidden };
  if (az && az.role) {
    out.role = az.role;
    if (reason === "forbidden") {
      out.message = 'Your role here is "' + az.role + '", which cannot check patients in' +
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
    if (seg === "ward") {
      const body = method === "POST" ? await readBody(request) : {};
      const wOrgId = url.searchParams.get("orgId") || body.orgId || "";
      const capFor = {
        admit: CAPS.QUEUE_ADD, list: CAPS.QUEUE_VIEW, vitals: CAPS.EMR_VITALS,
        "medication-order": CAPS.EMR_TREAT, round: CAPS.QUEUE_VIEW, mar: CAPS.MED_ADMINISTER,
        // Reading what is due is reading the ward, not acting on it: the same view capability the
        // ward list uses. Nothing here writes, so this grants no ability to move a dose.
        schedule: CAPS.QUEUE_VIEW,
        /* Critical results. SEEING the list is emr.view - a ward that cannot see its open critical
         * results is the failure this whole path exists to prevent, so it is not gated behind the
         * authority to act. ACKNOWLEDGING is emr.treat: it is a clinical decision recorded against a
         * named clinician, and the store enforces the write scope independently. */
        criticals: CAPS.EMR_VIEW, acknowledge: CAPS.EMR_TREAT, "flag-critical": CAPS.EMR_TREAT,
        // Moving a patient between beds is the same administrative act as admitting them to one.
        transfer: CAPS.QUEUE_ADD, beds: CAPS.QUEUE_VIEW,
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
        /* The FHIR export. emr.view because it renders the chart: exporting a record is reading it,
         * and an export door that was easier to open than the chart itself would be the way around
         * every other control on this file. The record service still applies the actor's own read
         * scope on top, so the bundle contains only what that clinician could already see. */
        fhir: CAPS.EMR_VIEW,
        /* Taking a medicines history is a nurse-or-pharmacist act (emr.vitals covers the ward
         * staff who do it). DECIDING what happens to a home medicine is prescribing-adjacent and
         * belongs to the treating clinician, so it is emr.treat. */
        "med-history": CAPS.EMR_VITALS, "med-decide": CAPS.EMR_TREAT, "med-reconciliation": CAPS.EMR_VIEW,
        // What is outstanding on the ward. A count of open items, naming no patient except on the
        // oldest unacknowledged critical result - so it is readable by the ward, at emr.view.
        metrics: CAPS.EMR_VIEW,
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
        // Charting a wound is nursing work, the same authority as a vital or a fluid entry.
        wound: CAPS.EMR_VITALS, wounds: CAPS.EMR_VIEW,
        // Reading the flowsheet is reading the chart. It writes nothing.
        flowsheet: CAPS.EMR_VIEW,
        // ADT out. Reading a stay in another wire format is still reading a chart, so it needs the
        // authority to read one. It writes nothing and there is no inbound listener.
        adt: CAPS.EMR_VIEW, oru: CAPS.EMR_VIEW,
        /* Putting somebody on the waiting list is the same administrative act as admitting them to a
         * bed - the front desk's work. It reserves nothing and admits nobody. */
        "request-admission": CAPS.QUEUE_ADD, "close-admission-request": CAPS.QUEUE_ADD, "waiting-list": CAPS.QUEUE_VIEW,
        // Booking a room is the front desk's act, the same authority as booking an appointment.
        "book-resource": CAPS.QUEUE_ADD, "resource-state": CAPS.QUEUE_ADD, "resource-schedule": CAPS.QUEUE_VIEW,
        // Risk assessment is nursing work, like the rest of the flowsheet.
        "risk-tools": CAPS.EMR_VIEW, assess: CAPS.EMR_VITALS, "risk-action": CAPS.EMR_VITALS, risks: CAPS.EMR_VIEW,
        /* Sending a prescription is part of prescribing, so queueing is emr.treat. Recording what
         * the transport said, and resolving a failure by printing it instead, is desk work. */
        transmit: CAPS.EMR_TREAT, "transmit-outcome": CAPS.QUEUE_ADD, "transmit-resolve": CAPS.QUEUE_ADD, outbox: CAPS.QUEUE_VIEW,
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
      /* The open critical results are readable by a VERIFIER as well as by the ward. A pharmacist
       * checking a dose against the patient's potassium needs to see that potassium, and gating this
       * list on emr.view alone was the reason they could not - the gap this build closes. It is an
       * alternative authority, never a widening: order.verify grants the narrow record scope in
       * actor.js and nothing more, so this cannot open any other route. */
      if (!wAz.ok && sub === "criticals") wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.ORDER_VERIFY);
      /* A specimen's outcome is recorded by whichever side of the journey it happened on: the ward
       * says the attempt failed, the LABORATORY says it arrived. Same alternative-authority shape,
       * and the same reason it is not a widening - lab.result grants only the narrow record scope in
       * actor.js, so this opens no other route and the store still checks the write itself. */
      if (!wAz.ok && sub === "specimen-outcome") wAz = await ORG.authorizeOrg(env, actor, wOrgId, CAPS.LAB_RESULT);
      if (!wAz.ok) return json(azRefusal(wAz), wAz.reason === "org_not_found" ? 404 : 403, request);

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
      const deps = { migration: mig, actorDeps: wsqActorDeps(env), recordDeps: wsqRecordDeps(env, mig.tenantId) };

      if (sub === "admit" && method === "POST") {
        const r = await admitPatient(request, env, { ...deps, admission: body.admission || body, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "list" && method === "GET") {
        const r = await listWard(request, env, { ...deps, ward: url.searchParams.get("ward") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "vitals" && method === "POST") {
        const r = await recordWardVitals(request, env, { ...deps, encounterId: body.encounterId, patientId: body.patientId, vitals: body.vitals, recordedAt: body.recordedAt, idempotencyKey: body.idempotencyKey || null });
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
      if (sub === "fhir" && method === "GET") {
        const fType = parts[2] || "", fId = parts[3] || "";
        if (fType === "metadata") {
          return json(capabilityStatement({ date: new Date().toISOString(), version: "wardsynq-1" }), 200, request);
        }
        const fctx = { ...deps, base: `${url.origin}/api/queue/ward/fhir` };
        const r = fType && fId
          ? await readResource(request, env, { ...fctx, type: fType, id: fId })
          : await patientEverything(request, env, {
              ...fctx, patientId: url.searchParams.get("patient") || url.searchParams.get("patientId") || "",
              types: (url.searchParams.get("_type") || "").split(",").map((t) => t.trim()).filter(Boolean),
            });
        return json(r.ok ? (r.bundle || r.resource) : r.outcome, r.status, request);
      }
      if (sub === "transmit" && method === "POST") {
        const r = await queueTransmission(request, env, { ...deps, orderId: body.orderId, channel: body.channel, destination: body.destination, idempotencyKey: body.idempotencyKey || null });
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
        const r = await writeTemplatedNote(request, env, { ...deps, templates: (wsqCfg && wsqCfg.noteTemplates) || [], templateId: body.templateId, encounterId: body.encounterId, sections: body.sections, at: body.at, idempotencyKey: body.idempotencyKey || null });
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
      if (sub === "flowsheet" && method === "GET") {
        const r = await flowsheet(request, env, {
          ...deps, patientId: url.searchParams.get("patientId") || "",
          from: url.searchParams.get("from") || "", to: url.searchParams.get("to") || "", hours: url.searchParams.get("hours") || "",
          rows: (wsqCfg && wsqCfg.flowsheetRows) || null,
        });
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
      if (sub === "investigation" && method === "POST") {
        const r = await orderInvestigation(request, env, { ...deps, encounterId: body.encounterId, code: body.code, display: body.display, codeSystem: body.codeSystem, category: body.category, priority: body.priority, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "collect" && method === "POST") {
        const r = await collectSpecimen(request, env, { ...deps, serviceRequestId: body.serviceRequestId, specimenType: body.specimenType, container: body.container, at: body.at, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "specimen-outcome" && method === "POST") {
        const r = await specimenOutcome(request, env, { ...deps, specimenId: body.specimenId, state: body.state, failureReason: body.failureReason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "collections" && method === "GET") {
        const r = await collectionList(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
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
          marTimes: (wsqCfg && wsqCfg.marTimes) || null, offsetMinutes: (wsqCfg && wsqCfg.utcOffsetMinutes) || 0,
        });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "cosign-queue" && method === "GET") {
        const r = await listAwaitingCoSign(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
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
        const r = await pendingRequests(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "metrics" && method === "GET") {
        const r = await wardMetrics(request, env, { ...deps, ward: url.searchParams.get("ward") || "", escalationPolicy: (wsqCfg && wsqCfg.criticalEscalation) || null });
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
        const r = await declareBreakGlass(request, env, { ...deps, patientId: body.patientId, reason: body.reason, minutes: body.minutes, idempotencyKey: body.idempotencyKey || null });
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
      if (sub === "verify-order" && method === "POST") {
        const r = await verifyOrder(request, env, { ...deps, orderId: body.orderId, outcome: body.outcome, reason: body.reason, idempotencyKey: body.idempotencyKey || null });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "verification-queue" && method === "GET") {
        const r = await verificationQueue(request, env, { ...deps, patientId: url.searchParams.get("patientId") || "" });
        return json(r, r.ok ? 200 : (r.status || 502), request);
      }
      if (sub === "dispense" && method === "POST") {
        const r = await dispenseOrder(request, env, { ...deps, orderId: body.orderId, quantity: body.quantity, destination: body.destination, at: body.at, idempotencyKey: body.idempotencyKey || null });
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
        const r = await transferPatient(request, env, { ...deps, encounterId: body.encounterId, ward: body.ward, bed: body.bed, reason: body.reason, movedAt: body.movedAt, idempotencyKey: body.idempotencyKey || null });
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
        // invalid / duplicate are EXPECTED outcomes the form renders, not server errors.
        if (!r.ok) return json(r, 200, request);
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
      if (actor.kind !== "firebase" && orgId) { const az = await ORG.authorizeOrg(env, actor, orgId, null); if (az.ok) role = az.role; }
      const smdId = actor.kind === "firebase" ? await ORG.userSmdId(env, actor.id, actor.email) : "";   // StewardMD ID per account
      let orgCode = ""; if (orgId) { const o = await ORG.getOrg(env, orgId); if (o) orgCode = o.code || ""; }
      return json({ ok: true, role: role, caps: capsFor(role), kind: actor.kind, orgId: orgId, orgCode: orgCode, smdId: smdId, name: actor.name, hospitalId: actor.hospitalId || "", billing: BILL.billingEnabled(env) }, 200, request);
    }

    // ---- org / rooms / members config (Phase 3: multi-tenant, isolation-gated) ----
    if (method === "GET" && seg === "orgs")
      return json({ ok: true, orgs: actor.kind === "firebase" ? await ORG.listOrgsForOwner(env, actor.id) : [] }, 200, request);
    if (method === "GET" && (seg === "org" || seg === "rooms" || seg === "members")) {
      const orgId = url.searchParams.get("orgId") || "";
      const az = await ORG.authorizeOrg(env, actor, orgId, seg === "members" ? CAPS.STAFF_ADMIN : CAPS.QUEUE_VIEW);
      if (!az.ok) return json({ ok: false, error: az.reason || "forbidden" }, az.reason === "org_not_found" ? 404 : 403, request);
      if (seg === "org") return json({ ok: true, org: await ORG.getOrg(env, orgId), departments: await ORG.listDepartments(env, orgId), rooms: await ORG.listRooms(env, orgId) }, 200, request);
      if (seg === "rooms") return json({ ok: true, rooms: await ORG.listRooms(env, orgId) }, 200, request);
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
    return json({ ok: false, error: (e && e.message) || "error" }, (e && e.status) || 500, request);
  }
}
