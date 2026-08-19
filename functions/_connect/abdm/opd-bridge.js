// functions/_connect/abdm/opd-bridge.js — scan-and-share -> the Smart OPD Queue.
//
// ABDM's facility QR is a URL carrying our HIP id and a counter code. The patient scans it in the ABHA
// app, the gateway posts their VERIFIED demographics to <cb>/api/v3/hip/patient/share, and we answer with
// a token number. That token number is the OPD queue token the app already computes - so scan-and-share is
// not a new feature, it is the existing queue with the registration desk removed: name, gender, year of
// birth and mobile arrive verified instead of being typed in.
//
// This file is the ONLY place ABDM touches the queue. hip-handlers.js calls it through an injected seam,
// so the callback layer stays free of Firestore and is testable without it.
//
// PHI: name and mobile go into the ticket through the queue's own encPHI path (addTicket does the sealing),
// exactly as a counter-typed registration would. Nothing extra is stored, and the ABHA address is NOT put
// on the ticket - the care-context linkage is keyed by pseudonym elsewhere.

import * as Q from "../../_queue_engine.js";

/**
 * Which OPD org does this Connect tenant register into? They are the same id in the single-tenant
 * deployment; ABDM_OPD_HOSPITAL_ID exists for the case where a hospital's Connect tenant and its OPD org
 * were created separately.
 */
export function opdOrgFor(env, tenantId) {
  let map = {};
  try { map = JSON.parse((env && env.ABDM_OPD_HOSPITAL_ID) || "{}"); } catch { map = {}; }
  const id = (typeof map === "object" && map) ? (map[tenantId] || map["*"] || tenantId) : tenantId;
  return { id: String(id || ""), mode: "native", connectorId: null };
}

/**
 * Issue an OPD queue token for a scan-and-share.
 *
 * Returns { tokenNumber, expirySec } - tokenNumber is the patient's 1-based place in the counter's queue,
 * which is what the display board and the ABHA app both show.
 *
 * The ticket lands in the department-level POOL, not a doctor's queue: at scan time nobody has decided
 * which doctor the patient sees, and the nurse console already exists to route a pool ticket to a room.
 * Putting it straight into a doctor's queue would be guessing.
 */
export async function issueQueueToken(env, deps, { tenantId, context, patient, hprId } = {}) {
  const org = opdOrgFor(env, tenantId);
  if (!org.id) throw new Error("no OPD org is configured for this tenant");

  const ticket = await Q.addToPool(env, org, {
    name: patient && patient.name,
    mobile: patient && patient.mobile,
    visitType: "new",
    department: String(context || ""),        // the counter code, so the board can group by counter
    lang: "en",
    // hprId arrives free with a scan-and-share and is the practitioner's HPR id - recorded on the visit,
    // never treated as patient data.
    visitId: hprId ? "hpr:" + hprId : "",
  }, "abdm:scan-and-share");

  const tickets = await Q.listTickets(env, ticket.sessionId);
  const tokenNumber = tokenNumberFor(tickets, ticket.id);
  return { tokenNumber, expirySec: 1800, ticketId: ticket.id, sessionId: ticket.sessionId };
}

/**
 * The patient's 1-based place among the tickets still waiting. Falls back to the ticket count when the
 * ticket cannot be found in the listing (a read-after-write lag) - a token number that is one off is far
 * better than none, and the board reconciles on the next recompute.
 */
export function tokenNumberFor(tickets, ticketId) {
  const WAITING = ["registered", "waiting", "called", "in_consultation"];
  const queue = (tickets || []).filter((t) => WAITING.indexOf(t.status) > -1)
    .sort((a, b) => (a.registeredAt || 0) - (b.registeredAt || 0));
  const idx = queue.findIndex((t) => t.id === ticketId);
  return idx < 0 ? queue.length || 1 : idx + 1;
}

/**
 * Resolve the mobile number to send an ABDM link OTP to.
 *
 * ABDM sends a pseudonymous patient reference, never a phone number, so the number is ours to find. The
 * chain is: the reference we published (hmacPseudonym of the ABHA) -> connect_abha_link -> the tenant's
 * own patient id -> that patient's most recent OPD ticket -> its encPHI mobile.
 *
 * Returns null rather than throwing when there is no number on file. A null makes link/init report
 * delivered:false, which is the truth; a throw would lose the callback.
 *
 * PHI: the decrypted number is returned to the caller for one send and is never stored or logged.
 */
export async function resolvePatientMobile(env, deps, { tenantId, patientRef } = {}) {
  const db = deps && deps.db;
  if (!db || !tenantId || !patientRef) return null;

  // The reference ABDM echoes back is our published pseudonym, which IS the patient_abha_hash column.
  const link = await db.prepare(
    "SELECT patient_ref FROM connect_abha_link WHERE tenant_id=? AND patient_abha_hash=?")
    .bind(tenantId, patientRef).first();
  const localRef = link && link.patient_ref;
  if (!localRef) return null;

  // deps.findTicketMobile is the seam onto the OPD store (Firestore), injected by the composition root so
  // this module stays testable without it.
  if (typeof deps.findTicketMobile !== "function") return null;
  try { return (await deps.findTicketMobile(env, { tenantId, patientRef: localRef })) || null; }
  catch { return null; }
}
