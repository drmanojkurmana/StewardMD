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
import { recordLinkForOrg, resolveTenantForOrg } from "../../_wardsynq/migration-tenant.js";
import { actorDeps as wsqActorDeps, recordDeps as wsqRecordDeps } from "../../_wardsynq/deps.js";

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
async function wsqForcedMigration(env, org) {
  if (!org || org.mode !== "wardsynq") return null;
  const tf = await resolveTenantForOrg(env, org.id, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
  if (!tf.tenant) return { mode: "authoritative", tenantId: null, error: "wardsynq_tenant_not_configured" };
  return { mode: "authoritative", tenantId: tf.tenantId };
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
      const link = await recordLinkForOrg(env, s.orgId || s.hospitalId, { getOrg: ORG.getOrg, tenantRow: wsqTenantRow });
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
      if (seg === "org" && sub === "update") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, org: await ORG.updateOrg(env, body.orgId, body, actor.id) }, 200, request); }
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
        // differs. PRESCRIPTIONS ARE DELIBERATELY EXCLUDED HERE: GHIS hard-blocks /prescribe until
        // reviewed (no drug-interaction/allergy/dose-ceiling CDSS wired into OPD prescribing anywhere
        // yet - wardsynq-safety.js exists but is not connected here), and a wardsynq hospital has no
        // equivalent external safety net to lean on either. Native prescribing needs that CDSS wiring
        // FIRST, not a bypass of the same caution GHIS itself is held to.
        let wsqMig = null;
        if (isVitals || isAssessment || isInvOrder) {
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
        // The prescription additionally cannot fire at all until GHIS prescribing is verified and
        // enabled (QUEUE_EMR_PRESCRIBE_OK): /prescribe answers 501 today and opd-emr.js's postWrite
        // returns before the timeline mirror, so a prescription GHIS refused reaches nothing here.
        // wardsynq orgs get the SAME caution (see above) — prescriptions still route through the
        // flag-gated shadow path only, deliberately not forced authoritative like the other three.
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
