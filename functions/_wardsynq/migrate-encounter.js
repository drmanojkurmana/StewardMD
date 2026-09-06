/* functions/_wardsynq/migrate-encounter.js — the OPD visit itself, migrated onto Encounter.
 *
 * THE GAP THIS CLOSES. Every migration before this one (vitals, assessment, investigation orders,
 * prescriptions, results) writes an `encounterId` computed by `opd-identity.js
 * encounterIdForTicket(ticket)` — but nothing has ever written an `Encounter` entity AT that id.
 * Every one of those resources has been pointing at a record that does not exist. This file is the
 * ONE place that creates and closes it, so all six resource types resolve to the SAME real entity
 * rather than a dangling reference each of them happens to agree on the spelling of.
 *
 * WHERE THIS COMES FROM. There is no single "open an encounter" button in opd-emr.js — an OPD visit
 * begins the moment a ticket exists for today (`_queue_engine.js addTicket`, called directly for a
 * manual walk-in, or through `_queue_ghis.js importRoster` for a GHIS-imported patient) and ends
 * when the ticket reaches one of the THREE states `_queue_eta.js isTerminal()` already recognises:
 * completed, cancelled, no_show. This file does not invent a fourth state or a discharge workflow —
 * it reads the ticket's OWN, already-governed lifecycle and reflects it onto the canonical model.
 *
 * ONE FUNCTION SERVES OPEN, CONTINUATION AND CLOSE, because they are the SAME question asked at
 * different moments: "what does the canonical Encounter look like right now, given this ticket's
 * CURRENT state?" `recordEncounterSync` is called at ticket creation (-> "planned"), at every
 * consult-relevant status change and at checkout (-> "in-progress" / "finished" / "cancelled"). A
 * repeat call with unchanged content writes nothing, which is what makes "continuation" (a second
 * resource resolving to the SAME encounter) require no separate code path at all.
 *
 * IDENTITY. `encounterIdForTicket` (opd-identity.js) is the SAME function every prior migration
 * already calls — this file introduces no second id scheme. It was widened here, ALONGSIDE this
 * file, to anchor on the ticket's own id when there is no GHIS episode (a native, non-GHIS visit),
 * matching the fallback `anchoredOrderId` already uses for every order/rx/result id. Before that
 * widening, a native visit's five prior resources all carried `encounterId: null` — this migration
 * is the reason that gap is closed now, not before: an Encounter with no anchor cannot be created,
 * and leaving five OTHER resource types pointing at null while only some tenants get a real
 * Encounter would be a worse inconsistency than the one being fixed.
 *
 * STATUS MAPS FROM THE TICKET'S OWN LIFECYCLE, NOTHING ELSE:
 *
 *   ticket status                                  Encounter status
 *   registered / waiting / called                  "planned"   (checked in, not yet being seen)
 *   in_consultation / investigation / followup      "in-progress" (has entered a consult; may be
 *                                                     sent for a test or held for follow-up mid-visit
 *                                                     and RETURN to the queue — `_queue_eta.js NEXT`
 *                                                     allows investigation -> waiting/called/
 *                                                     in_consultation — so neither is treated as an
 *                                                     end state, only as "still actively today's visit")
 *   completed                                       "finished"
 *   cancelled / no_show                             "cancelled"
 *
 * `class` is always "OPD" — this file has no IPD/ED/ICU input to represent and does not guess one.
 *
 * A CLOSED ENCOUNTER IS NEVER REOPENED OR OVERWRITTEN. Once an encounter reaches "finished" or
 * "cancelled", every further sync is refused UNLESS the incoming state is byte-identical to what is
 * already there (a harmless repeat of the same close). This holds even between the two terminal
 * values themselves — a "cancelled" encounter does not silently become "finished" because a stale
 * or out-of-order sync arrives claiming so. In practice `_queue_eta.js`'s own transition table
 * already makes this unreachable (a terminal ticket status has no outgoing transitions at all — see
 * `NEXT`), but this file does not rely on the caller's correctness for a fact this consequential;
 * see `wardsynq-actors.js`'s own "a signature is an act, not a string" reasoning for the same
 * instinct applied to a different guarantee.
 *
 * TIMESTAMPS ARE WHAT THE TICKET ACTUALLY RECORDED, NEVER A GUESS. `periodStart` is
 * `ticket.registeredAt` (set once, unconditionally, at check-in). `periodEnd` is set only at close,
 * from `ticket.consultEndAt` when the ticket passed through a consultation (`_queue_engine.js`
 * setStatus sets it on the transition OUT of in_consultation to a terminal-adjacent status), or the
 * moment of closing itself when there is no such timestamp — a cancellation from the waiting room,
 * before any consult began, has no more precise "when did this end" than the moment it was recorded.
 *
 * ATTENDING CLINICIAN AND LOCATION ARE BOLTED ON, NOT CANONICAL FIELDS. `Encounter` has no
 * participant or attending field in the model. `attendingId` (the session's own `doctorUid` at the
 * moment of the sync — a ticket belongs to one doctor's session at a time, and CAN be reassigned;
 * this reflects whichever session is doing the syncing, not a fact frozen at open) and `location`
 * (`{facilityId: tenant, ward: department, bed: roomId}`, using the SAME shape the model already
 * documents for other encounter types) are recorded the same way every prior migration bolts on a
 * fact the canonical shape has no field for.
 *
 * GOVERNANCE IS THE EXISTING RULE, EXTENDED BY EXACTLY ONE ENTITY, NOT A NEW ONE. Checking a patient
 * in for today's visit is the SAME administrative act as registering them was already judged to be
 * (`functions/_wardsynq/actor.js`, the 2026-09-06 QUEUE_ADD note): a committed fact, not a clinical
 * draft. `actor.js` was extended so QUEUE_ADD also adds "Encounter" to write scope, alongside
 * "Patient", for exactly the reason already written there — reception and the desk check patients
 * in every day and must be able to open the visit record that represents that, without being handed
 * a doctor's EMR_TREAT scope to do it. Every role holding QUEUE_STATUS (closing a visit) already
 * holds QUEUE_ADD too, so no separate grant is needed for close.
 *
 * A KNOWN, NAMED GAP: the stale-import reconciliation in `_queue_ghis.js importRoster` (a ticket
 * that dropped off the GHIS worklist gets cancelled) calls the queue ENGINE's `setStatus` directly,
 * not through the route this file hooks. An encounter for such a ticket is not closed by that path
 * today. Every deliberate front-desk action (manual status change, checkout) IS covered; this one
 * background reconciliation edge is not, and is named here rather than silently missed.
 */

import { Encounter } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForTicket, encounterIdForTicket } from "./opd-identity.js";

const TERMINAL = Object.freeze(["finished", "cancelled"]);

/** The tenant's mode for this migration. Its own settings key; unknown or absent is "off". */
async function encounterMigration(env, session, deps) {
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "encounter", deps);
}

/**
 * PURE. The ticket's own status to the canonical Encounter status. Mirrors `_queue_eta.js
 * isTerminal()` exactly (this file does not import the queue engine — see its own header on why
 * every migrate-*.js stays a pure mapper over data it is handed) rather than re-deciding terminality.
 */
function encounterStatusFor(ticketStatus) {
  if (ticketStatus === "completed") return "finished";
  if (ticketStatus === "cancelled" || ticketStatus === "no_show") return "cancelled";
  if (ticketStatus === "in_consultation" || ticketStatus === "investigation" || ticketStatus === "followup") return "in-progress";
  return "planned"; // registered | waiting | called | anything unrecognised: not yet being seen
}

/** PURE. Epoch-ms (this codebase's `now()` convention) or an ISO string, to ISO. `null` if neither. */
function toIso(v) {
  if (v == null || v === "") return null;
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return new Date(v).toISOString();
  const parsed = Date.parse(String(v));
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString();
}

/**
 * PURE. The ticket's current state to a canonical Encounter, or null when it cannot name a patient
 * or an anchor. `attendingId` is the syncing session's doctor, not necessarily the resolved actor —
 * a nurse recording vitals mid-visit is not the attending physician the encounter should name.
 *
 * @param {{ticket: object, attendingId?: string|null, tenantId?: string|null}} input
 */
function encounterFromTicket(input) {
  const ticket = (input && input.ticket) || {};
  const patientId = patientIdForTicket(ticket);
  const id = encounterIdForTicket(ticket);
  if (!patientId || !id) return null;

  const status = encounterStatusFor(ticket.status);
  const identifiers = [{ system: "opd-ticket-id", value: String(ticket.id) }];
  if (ticket.ghisEpisodeId) identifiers.push({ system: "ghis-episode-id", value: String(ticket.ghisEpisodeId) });

  const enc = Encounter({
    id, patientId, class: "OPD", status,
    identifiers,
    periodStart: toIso(ticket.registeredAt) || undefined,
    periodEnd: TERMINAL.includes(status) ? (toIso(ticket.consultEndAt) || new Date().toISOString()) : null,
    source: { system: "wardsynq-native", sourceId: `opd-encounter:${id}` },
  });
  enc.location = { facilityId: input.tenantId || null, ward: ticket.department || null, bed: ticket.roomId || null };
  enc.attendingId = input.attendingId || null;
  return enc;
}

/** PURE. The same visit in the same state — a repeat sync of unchanged content writes nothing. */
function sameEncounter(a, b) {
  if (!a || !b) return false;
  return a.status === b.status && a.patientId === b.patientId
    && (a.periodEnd || null) === (b.periodEnd || null)
    && (a.attendingId || null) === (b.attendingId || null)
    && JSON.stringify(a.location || null) === JSON.stringify(b.location || null)
    && JSON.stringify(a.identifiers || []) === JSON.stringify(b.identifiers || []);
}

/**
 * Syncs the Encounter to the ticket's current state as the request's own governed actor. Never
 * throws. ctx: { migration, ticket, session, actorDeps, recordDeps }
 */
async function recordEncounterSync(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };
  if (!ctx.ticket) return { ...base, ok: true, skipped: "no_ticket", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  const attendingId = (ctx.session && ctx.session.doctorUid) || null;
  const candidate = encounterFromTicket({ ticket: ctx.ticket, attendingId, tenantId: mig.tenantId });
  if (!candidate) return { ...base, ok: false, status: 422, error: "no_encounter_anchor", written: 0, actor: resolved.actor.id };
  const encounterId = candidate.id;

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("Encounter", encounterId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), encounterId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, encounterId };
  }

  if (current && sameEncounter(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "unchanged", encounterId, status: current.status, version: current.version, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }
  // A closed encounter is never reopened or overwritten — not to a different status, terminal or
  // not, and not merely to refresh a timestamp. sameEncounter() above already caught the harmless
  // repeat-of-the-same-close case; anything else reaching here for an already-terminal encounter is
  // an attempted CHANGE to a closed record, refused outright.
  if (current && TERMINAL.includes(current.status)) {
    return { ...base, ok: false, status: 409, error: "encounter_closed", encounterId, currentStatus: current.status, version: current.version, actor: resolved.actor.id };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return {
      ...base, ok: true, written: 1, updated: !!current, encounterId,
      status: candidate.status, version: out.record.version, replayed: out.replayed,
      actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source,
    };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), encounterId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", encounterId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, encounterId, actor: resolved.actor.id };
  }
}

export { encounterMigration, encounterStatusFor, encounterFromTicket, sameEncounter, recordEncounterSync, TERMINAL as ENCOUNTER_TERMINAL_STATUSES };
