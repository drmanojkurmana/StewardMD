/* functions/_wardsynq/migrate-inv-order.js — the doctor's investigation order, migrated.
 *
 * WHERE THIS COMES FROM. `opd-emr.js submitInvOrder()` posts `{serviceId, diagnosis, emergency}` to
 * GHIS's `/inv-order` (functions/api/ghis, `orderInvestigation` -> `/Doctor/Home/CreateServices`,
 * untouched here) and, ONLY on success, mirrors it as a `kind:"note"` timeline line:
 * "Investigation ordered: <name> (for <dx>) [emergency]". That mirror is the seam, the same one
 * vitals and the assessment already use.
 *
 * NOT A TIMELINE LINE. The canonical model already represents this: `ServiceRequest` — patient,
 * encounter, code, category, priority, requester, status. So that is what is written, structured,
 * rather than the sentence the timeline shows. The timeline keeps its sentence; nothing is
 * duplicated into it and nothing is taken out of it.
 *
 * WHAT MAPS TO WHAT, and what deliberately does not:
 *
 *   code         the GHIS service id the order is actually placed against ("LAB1118", "P0110" —
 *                `material_service_sp_id`, the id the search row carries). A real identifier in
 *                GHIS's own terminology, not a re-typed name.
 *   display      the service name, bolted on the way the GHIS and SCCM adapters bolt on a fact the
 *                canonical shape has no field for. `codeSystem: "ghis-service-id"` says whose code
 *                that is, so nobody later reads "LAB1118" as a LOINC.
 *   priority     the Emergency toggle: stat when set, else routine. Both are the model's own values.
 *   reason       the typed provisional diagnosis, bolted on (ServiceRequest carries no reason field).
 *   requesterId  the AUTHENTICATED ordering clinician, from the session — never a name typed anywhere.
 *   status       "active". GHIS accepted the order before this code runs, so it is placed, not a
 *                draft. ServiceRequest is an INSTRUCTION_TYPE, so committing it active needs EXECUTE
 *                — which is the existing governance rule, enforced by the existing authoriseWrite:
 *                a nurse is refused on scope, an AI is capped at DRAFT and refused EXECUTE_DENIED.
 *   category     left at the model's own default, "other". The service id prefix hints at
 *                laboratory vs procedure and inferring a clinical category from a naming convention
 *                would be inventing one. GHIS does not tell us, so this does not pretend to know.
 *
 * PRIORITY AND REASON ARE RECORDED HERE THOUGH GHIS DROPS THEM. Worth stating plainly: the client
 * sends `emergency` and `diagnosis`, and `orderInvestigation` maps neither (it reads `indication`/
 * `antibiotics`, and has no emergency parameter at all). That is pre-existing GHIS behaviour, not
 * touched by this migration. The record keeps what the doctor actually entered.
 *
 * ONE ORDER PER TEST PER ENCOUNTER. The id is deterministic from the encounter and the service id,
 * so a retried request cannot create a second ServiceRequest, and an identical re-order on the same
 * visit is reported as `already_ordered` rather than written twice. The trade-off is stated rather
 * than hidden: a doctor genuinely re-ordering the SAME test within ONE visit is recorded once here,
 * while GHIS and the visit timeline each keep both entries.
 *
 * ORDERS ONLY. Results (DiagnosticReport) are not migrated. Prescriptions are not migrated: they
 * mirror as `kind:"medication"` and carry no `order` payload, so nothing here sees them.
 */

import { ServiceRequest } from "../../wardsynq/wardsynq-model.js";
import { GovernanceError } from "../../wardsynq/wardsynq-actors.js";
import { VersionConflictError } from "./repository.js";
import { resolveClinicalActor } from "./actor.js";
import { RecordService } from "./service.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { resolveMigration } from "./migration-tenant.js";
import { patientIdForTicket, encounterIdForTicket, serviceRequestIdForTicket } from "./opd-identity.js";

/** The tenant's mode for this migration. Its own settings key; unknown or absent is "off". */
async function invOrderMigration(env, session, deps) {
  const orgId = session && (session.orgId || session.hospitalId);
  return resolveMigration(env, orgId, "investigations", deps);
}

/**
 * PURE. The client's order draft to a canonical ServiceRequest, or null when it cannot name a
 * patient, an encounter or a service. Nothing is defaulted into existence: an order with no service
 * id is not an order.
 *
 * @param {{ticket: object, order: {serviceId, name?, diagnosis?, emergency?}, requesterId: string}} input
 */
function orderFromInvestigation(input) {
  const o = (input && input.order) || {};
  const serviceId = o.serviceId == null ? "" : String(o.serviceId).trim();
  const patientId = patientIdForTicket(input.ticket);
  const id = serviceRequestIdForTicket(input.ticket, serviceId);
  if (!serviceId || !patientId || !id || !input.requesterId) return null;

  const sr = ServiceRequest({
    id,
    patientId,
    encounterId: encounterIdForTicket(input.ticket),
    code: serviceId,
    category: "other",
    priority: o.emergency ? "stat" : "routine",
    requesterId: input.requesterId,
    status: "active",
    source: { system: "wardsynq-native", sourceId: `opd-inv-order:${id}` },
  });
  // Bolted on, the convention this codebase already uses for a fact the canonical shape has no
  // field for (wardsynq-ghis-adapter.js dobIsUnknown, wardsynq-sccm-adapter.js externalStatus).
  sr.codeSystem = "ghis-service-id";
  const name = o.name == null ? "" : String(o.name).trim();
  if (name) sr.display = name;
  const reason = o.diagnosis == null ? "" : String(o.diagnosis).trim();
  if (reason) sr.reason = reason;
  return sr;
}

/** PURE. The same test, on the same encounter, asked for in the same terms. */
function sameOrder(a, b) {
  if (!a || !b) return false;
  return a.code === b.code && a.patientId === b.patientId && a.encounterId === b.encounterId
    && a.priority === b.priority && (a.reason || "") === (b.reason || "") && a.status === b.status;
}

/**
 * Writes the order to the record as the request's own governed actor. Never throws.
 * ctx: { migration, ticket, order, actorDeps, recordDeps }
 */
async function recordInvestigationOrder(request, env, ctx) {
  const mig = ctx.migration;
  const base = { mode: mig.mode, tenantId: mig.tenantId || null };
  if (!mig || mig.mode === "off") return { ...base, ok: true, skipped: mig && mig.why ? mig.why : "off", written: 0 };

  // A kind:"note" line with no order payload is one of the many other things that kind carries.
  // It is not an order and nothing here touches it.
  if (!ctx.order || typeof ctx.order !== "object") return { ...base, ok: true, skipped: "no_order", written: 0 };

  let resolved;
  try {
    resolved = await resolveClinicalActor(request, env, mig.tenantId, "record:write", ctx.actorDeps);
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { ...base, ok: false, status, error: e instanceof AuthError ? "auth" : e instanceof PermissionError ? "permission" : "error", detail: String((e && e.message) || e), written: 0 };
  }

  const candidate = orderFromInvestigation({ ticket: ctx.ticket, order: ctx.order, requesterId: resolved.actor.id });
  if (!candidate) return { ...base, ok: false, status: 422, error: "unusable_order", written: 0, actor: resolved.actor.id };
  const orderId = candidate.id;

  const svc = new RecordService({ repository: ctx.recordDeps.repository, pseudonym: ctx.recordDeps.pseudonym, tenant: resolved.tenant, actor: resolved.actor, role: resolved.role, roleSource: resolved.source });

  let current;
  try {
    current = await svc.get("ServiceRequest", orderId);
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, actor: resolved.actor.id };
    return { ...base, ok: false, status: 502, error: "record_read_failed", detail: String((e && e.message) || e), written: 0, orderId };
  }
  if (current && sameOrder(current, candidate)) {
    return { ...base, ok: true, written: 0, skipped: "already_ordered", orderId, version: current.version, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  }

  try {
    const out = await svc.put(candidate, { expectedVersion: current ? current.version : undefined, idempotencyKey: ctx.idempotencyKey || null });
    return { ...base, ok: true, written: 1, updated: !!current, orderId, code: candidate.code, priority: candidate.priority, version: out.record.version, replayed: out.replayed, actor: resolved.actor.id, role: resolved.role, roleSource: resolved.source };
  } catch (e) {
    if (e instanceof GovernanceError) return { ...base, ok: false, status: 403, error: "governance", reasons: e.reasons.map((r) => r.code), orderId, actor: resolved.actor.id };
    if (e instanceof VersionConflictError) return { ...base, ok: false, status: 409, error: "version_conflict", orderId, detail: e.detail };
    return { ...base, ok: false, status: 502, error: "record_write_failed", detail: String((e && e.message) || e), written: 0, orderId, actor: resolved.actor.id };
  }
}

export { invOrderMigration, orderFromInvestigation, sameOrder, recordInvestigationOrder };
