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
import { queueEnabled, isQueueConfigured } from "../../_queue.js";
import { identify } from "../../_usage.js";
import { ownerEmails } from "../../_adminauth.js";
import { CAPS, can, requireCap, roleForActor, capsFor } from "../../_queue_roles.js";
import * as Q from "../../_queue_engine.js";
import * as QT from "../../_queue_timeline.js";
import { notifyTimeline } from "../../_queue_notify.js";
import { importRoster, importFromSource } from "../../_queue_ghis.js";
import * as ORG from "../../_opd_org_store.js";
import { resolveRoomDoctor, roomStatus } from "../../_opd_org.js";
import { verifyStaffSession, verifySecret, pinLocked, nextPinState, mintStaffSession } from "../../_opd_auth.js";
import "../../_opd_ghis_connector.js";   // side-effect: registers the "ghis" OPD connector

const CORS_ORIGINS = ["https://localhost", "capacitor://localhost", "http://localhost", "ionic://localhost", "https://stewardmd.in", "https://www.stewardmd.in"];
function corsHeaders(request) {
  const o = request.headers.get("Origin") || ""; const h = { "Vary": "Origin" };
  if (CORS_ORIGINS.indexOf(o) >= 0) { h["Access-Control-Allow-Origin"] = o; h["Access-Control-Allow-Methods"] = "POST, GET, OPTIONS"; h["Access-Control-Allow-Headers"] = "Content-Type, Authorization, X-App-Token, X-Admin-Token, X-Staff-Token"; h["Access-Control-Max-Age"] = "86400"; }
  return h;
}
function json(obj, status, request) { return new Response(JSON.stringify(obj), { status: status || 200, headers: Object.assign({ "Content-Type": "application/json", "Cache-Control": "no-store" }, corsHeaders(request)) }); }
async function readBody(request) { try { return await request.json(); } catch (e) { return {}; } }
function today() { try { return new Date().toISOString().slice(0, 10); } catch (e) { return ""; } }

const staffEnabled = (env) => env && env.QUEUE_STAFF_ENABLED === "1";
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
    return { kind: "firebase", id: who.id, email: who.email || "", isOwner: owner, role: owner ? "admin" : "doctor", hospitalId: "", name: who.email || "" };
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
  if (actor.isOwner) return { s };
  if (actor.kind === "staff") {
    if (actor.hospitalId && s.hospitalId && actor.hospitalId !== s.hospitalId) return { err: json({ ok: false, error: "forbidden" }, 403) };
    return { s };
  }
  if (s.doctorUid !== actor.id) return { err: json({ ok: false, error: "forbidden" }, 403) };
  return { s };
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
      status: doctorUid ? roomStatus(waiting, inConsult, org.thresholds) : "unavailable", tickets: await ticketView(env, tickets) });
  }
  const pool = await Q.getOrCreatePoolSession(env, org, date);
  const poolTickets = (await Q.listTickets(env, pool.id)).filter((t) => WAITING.indexOf(t.status) > -1);
  return { mode: org.mode, thresholds: org.thresholds, rooms: out, pool: await ticketView(env, poolTickets), poolSessionId: pool.id };
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
        const auth = await ORG.getMemberAuth(env, b.orgId || "", b.identity || "");
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

    // ---- authenticated: doctor (Firebase) OR staff (GHIS token, when QUEUE_STAFF_ENABLED) ----
    const actor = await resolveActor(request, env);
    if (!actor) return json({ ok: false, error: "unauthorized" }, 401, request);
    if (!isQueueConfigured(env)) return json({ ok: false, error: "not_configured" }, 200, request);
    const who = actor;   // compat alias: a plain doctor's actor.id === their Firebase uid

    // Role + capabilities, so the client can adapt its UI (server still re-checks every mutation).
    if (method === "GET" && seg === "whoami") {
      // For non-owner/non-doctor identities, the real role is org-scoped (q_members), not the global viewer.
      let role = actor.role, orgId = actor.orgId || url.searchParams.get("orgId") || actor.hospitalId || "";
      if (actor.kind !== "firebase" && orgId) { const az = await ORG.authorizeOrg(env, actor, orgId, null); if (az.ok) role = az.role; }
      return json({ ok: true, role: role, caps: capsFor(role), kind: actor.kind, orgId: orgId, name: actor.name, hospitalId: actor.hospitalId || "" }, 200, request);
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

    if (method === "GET" && seg === "session") {
      requireCap(actor.role, CAPS.QUEUE_VIEW);
      const doctorUid = (actor.kind === "firebase" && !actor.isOwner) ? actor.id : (url.searchParams.get("doctorUid") || actor.id);
      const s = await Q.getOrCreateSession(env, {
        hospitalId: (actor.kind === "staff" && actor.hospitalId) || url.searchParams.get("hospitalId") || "manual",
        doctorUid: doctorUid, doctorName: url.searchParams.get("doctorName") || actor.name || "",
        department: url.searchParams.get("department") || "", date: url.searchParams.get("date") || today(),
        source: url.searchParams.get("source") || "manual"
      });
      const tickets = await Q.recompute(env, s);
      return json({ ok: true, session: s, tickets: await ticketView(env, tickets) }, 200, request);
    }

    // Multi-doctor front-desk board: every OPD queue in the hospital for the day.
    if (method === "GET" && seg === "board") {
      requireCap(actor.role, CAPS.QUEUE_VIEW);
      const hospitalId = (actor.kind === "staff" && actor.hospitalId) || url.searchParams.get("hospitalId") || "";
      if (!hospitalId) return json({ ok: false, error: "hospital_required" }, 400, request);
      const sessions = await Q.listSessions(env, hospitalId, url.searchParams.get("date") || today());
      const board = [];
      for (const s of sessions) board.push({ session: s, tickets: await ticketView(env, await Q.listTickets(env, s.id)) });
      return json({ ok: true, board: board }, 200, request);
    }

    if (method === "GET" && seg === "list") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      requireCap(actor.role, CAPS.QUEUE_VIEW);
      return json({ ok: true, session: s, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request);
    }

    // Audit timeline (transparency / anti-misuse) — anyone who can view the queue can see the trail.
    if (method === "GET" && seg === "audit") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      requireCap(actor.role, CAPS.QUEUE_VIEW);
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
      requireCap(actor.role, CAPS.EMR_VIEW);
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      return json({ ok: true, timeline: await QT.getTimeline(env, t.id) }, 200, request);
    }
    // Doctor's treated-patient history (self-expiring at the link's 7-30d window).
    if (method === "GET" && seg === "treated") {
      requireCap(actor.role, CAPS.EMR_VIEW);
      return json({ ok: true, treated: await QT.listTreated(env, actor.id) }, 200, request);
    }

    if (method === "GET" && seg === "link") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      requireCap(actor.role, CAPS.QUEUE_VIEW);
      const t = await Q.getTicket(env, url.searchParams.get("ticketId") || "");
      if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
      return json(Object.assign({ ok: true }, await Q.linkFor(env, t)), 200, request);
    }

    if (method === "GET" && seg === "config") return json({ ok: true, config: await Q.getConfig(env, actor.id) }, 200, request);
    if (method === "GET" && seg === "analytics") {
      const { s, err } = await loadSessionFor(env, url.searchParams.get("sessionId"), actor); if (err) return err;
      requireCap(actor.role, CAPS.ANALYTICS_VIEW);
      return json({ ok: true, analytics: await Q.analytics(env, s) }, 200, request);
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
      if (seg === "org" && !sub) { if (needAccount()) return json({ ok: false, error: "account_required" }, 403, request); return json({ ok: true, org: await ORG.createOrg(env, body, actor.id) }, 200, request); }
      if (seg === "org" && sub === "update") { const az = await azOrg(CAPS.STAFF_ADMIN); if (!az.ok) return deny(az); return json({ ok: true, org: await ORG.updateOrg(env, body.orgId, body, actor.id) }, 200, request); }
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
        return json({ ok: true, member: await ORG.setMembership(env, body.orgId, body.identity, body, actor.id) }, 200, request);
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
        const t = await Q.addToPool(env, org, body, actor.id);
        return json({ ok: true, ticket: (await ticketView(env, [t]))[0], board: await boardForOrg(env, org, body.date || "") }, 200, request);
      }
      if (seg === "assign-room") {   // nurse assigns a pool/room ticket to a specific room
        const room = await ORG.getRoom(env, body.roomId);
        if (!room || String(room.orgId) !== String(body.orgId)) return json({ ok: false, error: "room_not_found" }, 404, request);
        const az = await azOrg(CAPS.QUEUE_ASSIGN, { roomId: room.id, departmentId: room.departmentId }); if (!az.ok) return deny(az);
        const org = await ORG.getOrg(env, body.orgId);
        try { await Q.assignToRoom(env, org, body.ticketId, room, { priority: body.priority, reason: body.reason, date: body.date, doctorName: body.doctorName }, actor.id); }
        catch (e) { return json({ ok: false, error: (e && e.message) || "assign_failed" }, (e && e.status) || 500, request); }
        return json({ ok: true, board: await boardForOrg(env, org, body.date || "") }, 200, request);
      }
      const { s, err } = await loadSessionFor(env, body.sessionId, actor); if (err) return err;
      if (seg === "ticket") { requireCap(actor.role, CAPS.QUEUE_ADD); const t = await Q.addTicket(env, s, body, actor.id); return json({ ok: true, ticket: (await ticketView(env, [t]))[0] }, 200, request); }
      if (seg === "import") { requireCap(actor.role, CAPS.QUEUE_ADD); const r = await importRoster(env, s, body.rows || [], actor.id); return json({ ok: true, imported: r.imported, skipped: r.skipped, removed: r.removed, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request); }
      // OPD engine → resolveOpdSource(org) → connector → existing EMR. Server pulls the worklist via the
      // org's connector (GHIS or other) instead of the client hitting /api/ghis; degrades to native.
      if (seg === "import-from-source") {
        requireCap(actor.role, CAPS.QUEUE_ADD);
        const org = opdOrgFor(env, s.hospitalId);
        const ghisToken = request.headers.get("X-Ghis-Token") || "";
        const r = await importFromSource(env, s, org, { ghisToken: ghisToken, date: body.date || "", cb: body.cb || "", actor: actor.id });
        return json({ ok: true, source: r.source, connector: org.connectorId || null, imported: r.imported || 0, skipped: r.skipped || 0, removed: r.removed || 0, degraded: !!r.degraded, native: !!r.native, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request);
      }
      if (seg === "advance") { requireCap(actor.role, CAPS.QUEUE_STATUS); return json({ ok: true, tickets: await ticketView(env, await Q.advance(env, s, actor.id)) }, 200, request); }
      if (seg === "status") { requireCap(actor.role, CAPS.QUEUE_STATUS); return json({ ok: true, tickets: await ticketView(env, await Q.setStatus(env, s, body.ticketId, body.status, actor.id)) }, 200, request); }
      if (seg === "priority") { requireCap(actor.role, CAPS.QUEUE_PRIORITY); return json({ ok: true, tickets: await ticketView(env, await Q.setPriority(env, s, body.ticketId, body.priority, actor.id)) }, 200, request); }
      if (seg === "move") { requireCap(actor.role, CAPS.QUEUE_REORDER); return json({ ok: true, tickets: await ticketView(env, await Q.moveTicket(env, s, body.ticketId, body, actor.id)) }, 200, request); }
      if (seg === "assign") { requireCap(actor.role, CAPS.QUEUE_ASSIGN); return json({ ok: true, tickets: await ticketView(env, await Q.assignTicket(env, s, body.ticketId, body.toDoctorUid, body, actor.id)) }, 200, request); }
      if (seg === "revoke") { requireCap(actor.role, CAPS.QUEUE_REMOVE); await Q.revokeTicket(env, s, body.ticketId, actor.id); return json({ ok: true, tickets: await ticketView(env, await Q.listTickets(env, s.id)) }, 200, request); }
      if (seg === "session" && sub === "status") { requireCap(actor.role, CAPS.SESSION_MANAGE); return json({ ok: true, session: await Q.setSessionStatus(env, s, body, actor.id) }, 200, request); }

      // Add a clinical entry to the encounter timeline. Vitals => nurse (EMR_VITALS); notes/meds/
      // assessment => doctor (EMR_TREAT). "Add to timeline" for meds writes ONLY here (no pharmacy/EMR).
      if (seg === "timeline" && sub === "extend") {
        requireCap(actor.role, CAPS.EMR_TREAT);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        return json(Object.assign({ ok: true }, await QT.extendTimeline(env, t.id, body.days)), 200, request);
      }
      if (seg === "timeline") {
        requireCap(actor.role, QT.tlKind(body.kind) === "vitals" ? CAPS.EMR_VITALS : CAPS.EMR_TREAT);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        return json(Object.assign({ ok: true }, await QT.appendTimeline(env, s, t, body.kind, body.text, actor.id)), 200, request);
      }
      // Slide-to-checkout: seal + share the timeline, close the patient, call the next.
      if (seg === "checkout") {
        requireCap(actor.role, CAPS.QUEUE_STATUS);
        const t = await Q.getTicket(env, body.ticketId);
        if (!t || t.sessionId !== s.id) return json({ ok: false, error: "not_found" }, 404, request);
        const fin = await QT.finalizeCheckout(env, s, t, actor.id);
        if (t.status !== "in_consultation" && t.status !== "completed") await Q.setStatus(env, s, t.id, "in_consultation", actor.id).catch(() => {});
        await Q.setStatus(env, s, t.id, "completed", actor.id).catch(() => {});
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
