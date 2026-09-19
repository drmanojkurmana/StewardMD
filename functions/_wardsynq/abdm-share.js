/* functions/_wardsynq/abdm-share.js - ABDM Scan and Share at a WardSynQ hospital (design S6 3.4, phase A5).
 *
 * THE QR. One per counter: the hospital's general desk and each active department. It encodes ABDM's
 * share-profile URL with this hospital's own HIP ID and the counter's code (abdm-connect.js shareProfileUrl).
 * A hospital that is not connected gets no QR at all, and the screen says why: a printed QR that the ABHA app
 * rejects, or that shares a profile into nobody's queue, is worse than none.
 *
 * THE SHARE. The patient scans, ABDM posts their verified profile to /api/v3/hip/patient/share, and
 * hip-handlers.js asks for a token. For a WardSynQ hospital issueShareToken queues them in the counter's
 * department through the SAME queue engine the desk uses (the department decides the token number, D7), with
 * the shared profile sealed on the ticket. Nothing is registered automatically: whether this is a patient the
 * hospital already knows is the desk's decision, on the registration sheet, where the duplicate check runs.
 * Any other hospital keeps opd-bridge.js's issueQueueToken unchanged.
 *
 * THE DESK. The Patients page lists today's shares with their tokens; Register opens the check-in sheet
 * pre-filled with the ABDM-verified profile and a desk proof for the ABHA (abdm-desk.js), so the ABHA is bound
 * to the MR number as verified. The MR number then goes back onto the ticket.
 */

import * as Q from "../_queue_engine.js";
import * as ORG from "../_opd_org_store.js";
import { decPHI } from "../_queue.js";
import { orgForTenant } from "./org.js";
import { issueQueueToken } from "../_connect/abdm/opd-bridge.js";
import { loadConnection, connectionView, shareProfileUrl } from "./abdm-connect.js";
import { mintAbhaProof } from "./abdm-desk.js";

const str = (v) => (v == null ? "" : String(v).trim());
export const SHARE_TOKEN_EXPIRY_SEC = 1800;
const GENERAL_COUNTER = "desk";

/** PURE. The counters a QR is printed for. The general desk only when a token can be given without a department. */
function sharingCounters(conn, org, departments) {
  const perDepartment = !!(org && org.tokens && org.tokens.scope === "department");
  const out = [];
  if (!perDepartment) out.push({ counterId: GENERAL_COUNTER, departmentId: null, name: null, url: shareProfileUrl(conn, GENERAL_COUNTER) });
  for (const d of departments || []) {
    if (!d || d.active === false || !/^[A-Za-z0-9_-]{1,40}$/.test(str(d.id))) continue;
    out.push({ counterId: str(d.id), departmentId: str(d.id), name: str(d.name || d.code) || null, url: shareProfileUrl(conn, d.id) });
  }
  return out.filter((c) => c.url);
}

/** GET: the QRs and today's shares. ctx: { migration, recordDeps, orgId, org } */
async function abdmShareView(request, env, ctx) {
  let conn, departments, tickets;
  try { conn = await loadConnection(env, ctx.recordDeps.repository, ctx.migration.tenantId); }
  catch { return { ok: false, status: 502, error: "abdm_profile_read_failed", message: "This hospital's ABDM profile could not be read." }; }
  try { departments = await ORG.listDepartments(env, ctx.orgId); }
  catch { return { ok: false, status: 502, error: "departments_read_failed", message: "The departments could not be read, so the counters are not shown." }; }
  try { tickets = await Q.listShareTickets(env, ctx.orgId); }
  catch { return { ok: false, status: 502, error: "shares_read_failed", message: "Today's shared profiles could not be read. This is not the same as there being none." }; }

  const shares = [];
  for (const t of tickets) {
    const registered = !!t.ghisPatientId;
    let profile = null;
    if (!registered && t.encShare) {
      try { profile = JSON.parse(await decPHI(env, t.encShare)); } catch { profile = null; }
    }
    const row = { ticketId: t.id, token: t.token || "", departmentId: t.departmentId || null, department: t.department || null,
      sharedAt: t.registeredAt || null, status: t.status, registered, mrn: registered ? t.ghisPatientId : null };
    if (!registered) {
      row.name = profile ? str(profile.name) : await decPHI(env, t.encName).catch(() => "");
      row.profile = profile;
      row.profileUnreadable = !profile;
      // ABDM verified this ABHA when the patient shared it; the desk proof carries that to the registration.
      if (profile && (profile.abhaNumber || profile.abhaAddress)) row.abhaProof = await mintAbhaProof(env, { orgId: ctx.orgId, abhaNumber: profile.abhaNumber, abhaAddress: profile.abhaAddress });
    }
    shares.push(row);
  }
  return { ok: true, connection: connectionView(conn), counters: conn.connected ? sharingCounters(conn, ctx.org, departments) : [], shares };
}

/** POST: the desk registered a share as an MR number. ctx: { orgId, org, actorId, ticketId, mrn } */
async function abdmShareRegister(request, env, ctx) {
  try {
    const t = await Q.attachShareRegistration(env, ctx.org, str(ctx.ticketId), str(ctx.mrn), ctx.actorId);
    return { ok: true, ticketId: t.id, mrn: t.ghisPatientId };
  } catch (e) {
    const status = (e && e.status) || 502;
    const say = { not_found: "No shared profile with that token at this hospital.", already_registered: "This shared profile is already registered.", mrn_required: "The MR number is missing." };
    return { ok: false, status, error: status === 502 ? "share_update_failed" : e.message, message: say[e && e.message] || "The MR number could not be put on the token. The patient is registered; tell the desk the token." };
  }
}

/**
 * The token for a scan-and-share (bound in functions/api/v3). A WardSynQ hospital queues the patient in the
 * counter's department with the shared profile sealed on the ticket; every other hospital keeps the OPD bridge.
 * Throws when no token can be given, so hip-handlers.js answers ABDM with a failure, never a token that is not real.
 */
async function issueShareToken(env, deps, input) {
  const i = input || {};
  const tenant = deps && deps.db ? await deps.db.prepare("SELECT * FROM connect_tenant WHERE id=?").bind(String(i.tenantId)).first() : null;
  const org = tenant ? await orgForTenant(env, tenant) : null;
  if (!org || org.mode !== "wardsynq") return issueQueueToken(env, deps, i);

  const counter = str(i.context);
  const departments = await ORG.listDepartments(env, org.id);
  const dept = departments.find((d) => d && d.active !== false && str(d.id) === counter) || null;
  if (!dept && counter !== GENERAL_COUNTER) throw new Error("unknown counter");
  const p = i.patient || {};
  const share = {
    name: str(p.name), gender: str(p.gender), yearOfBirth: str(p.yearOfBirth), monthOfBirth: str(p.monthOfBirth), dayOfBirth: str(p.dayOfBirth),
    mobile: str(p.mobile), abhaNumber: str(p.abhaNumber).replace(/\D/g, ""), abhaAddress: str(p.abhaAddress),
    address: p.address && typeof p.address === "object" ? { line: str(p.address.line), district: str(p.address.district), state: str(p.address.state), pinCode: str(p.address.pinCode) } : null,
  };
  const ticket = await Q.addToPool(env, org, { name: share.name, mobile: share.mobile, visitType: "new", departmentId: dept ? dept.id : "", lang: "en", abdmShare: share }, "abdm:scan-and-share");
  if (!ticket || !ticket.token) throw new Error("no token was issued");
  return { tokenNumber: ticket.token, expirySec: SHARE_TOKEN_EXPIRY_SEC, ticketId: ticket.id };
}

export { GENERAL_COUNTER, sharingCounters, abdmShareView, abdmShareRegister, issueShareToken };
