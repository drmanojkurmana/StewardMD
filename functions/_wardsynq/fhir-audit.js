/* functions/_wardsynq/fhir-audit.js - the hospital's own audit trail, as FHIR AuditEvent. Read only.
 *
 * The trail already exists (connect_audit_event, read back by repository.auditTrail for the security
 * review). This shows the same rows to a regulator's or an information-governance system's FHIR
 * client, so "who opened this chart" does not need a CSV and a phone call.
 *
 * NO MORE THAN THE AUDIT SCREEN SHOWS. Each row carries exactly the envelope the security review's
 * evidence table shows (security-review.js evidenceRow): when, who, the action word, the record type
 * and id, the patient reference HASH, and the outcome. Resource counts, latencies and anything else in
 * the row stay out. No patient name, no MRN, no content: the trail never held them.
 *
 * WHO. Never a patient/ token and never a user/ one: an application a clinician launched reads that
 * clinician's patients, not everybody's access history. On /api/fhir only a SMART backend-services
 * token with system/AuditEvent.read (or system/*.read); on the ward door staff.admin at the route AND
 * a clinical actor that may read the record, the security review's own double gate. Reading the trail
 * is itself written to the trail.
 *
 * THE VOCABULARY IS OURS AND SAYS SO. The action word ("record.read", "fhir.export.kickoff") goes out
 * as AuditEvent.type under our own urn:stewardmd system. Mapping it onto DICOM's audit event codes
 * would be a guess at what each action means to somebody else's reviewer.
 */

import { resolveClinicalActor } from "./actor.js";
import { AuthError, PermissionError } from "../_connect/permission.js";
import { FHIR_TYPE, operationOutcome } from "./fhir.js";
import { ACTOR_SYSTEM } from "./fhir-identity.js";
import { fhirId } from "./fhir-id.js";
import { dateClause, dateMatches } from "./fhir-search.js";

const str = (v) => (v == null ? "" : String(v).trim());
const ACTION_SYSTEM = "urn:stewardmd:fhir:CodeSystem:audit-action";
const PATIENT_REF_SYSTEM = "urn:stewardmd:patient-ref-hash";
const DEFAULT_COUNT = 50, MAX_COUNT = 500;
/* R4 AuditEvent.outcome. Only words whose meaning is unambiguous are mapped; the raw word always travels in outcomeDesc. */
const OUTCOME = Object.freeze({ ok: "0", success: "0", denied: "4", invalid: "4", refused: "4", failed: "8", error: "8" });
const SEARCH = ["date", "agent", "type", "entity-type", "outcome", "_count", "_page", "orgId", "_format"];

/** PURE. One audit row as an AuditEvent. */
function fhirAuditEvent(e) {
  const scope = e.scope && typeof e.scope === "object" ? e.scope : {};
  const rt = str(scope.resourceType), rid = str(scope.id);
  const fhirType = FHIR_TYPE[rt];
  const entity = [];
  if (rt) entity.push({ what: fhirType && rid ? { reference: `${fhirType}/${fhirId(rid)}` } : { display: rid ? `${rt}/${rid}` : rt }, type: { system: "urn:stewardmd:resource-type", code: rt } });
  if (str(e.patientRefHash)) entity.push({ what: { identifier: { system: PATIENT_REF_SYSTEM, value: str(e.patientRefHash) } }, role: { system: "http://terminology.hl7.org/CodeSystem/object-role", code: "1", display: "Patient" } });
  const outcome = OUTCOME[str(e.outcome).toLowerCase()];
  return {
    resourceType: "AuditEvent", id: fhirId(str(e.id)),
    type: { system: ACTION_SYSTEM, code: str(e.action) || "unknown" },
    recorded: str(e.ts),
    ...(outcome ? { outcome } : {}),
    ...(str(e.outcome) ? { outcomeDesc: str(e.outcome) } : {}),
    agent: [{ who: str(e.actor) ? { identifier: { system: ACTOR_SYSTEM, value: str(e.actor) } } : { display: "unknown" }, requestor: true }],
    source: { observer: { display: "WardSynQ" } },
    ...(entity.length ? { entity } : {}),
  };
}

/** Who is asking: { ok: true } or { status, outcome }. */
async function authorise(request, env, ctx) {
  const b = ctx.actorOverride;
  if (b) {
    const scopes = b.scopes || [];
    const system = scopes.some((s) => s === "system/AuditEvent.read" || s === "system/*.read");
    if (b.source !== "smart:backend" || b.patientId || !system) return { status: 403, outcome: operationOutcome("error", "forbidden", "AuditEvent needs a SMART backend-services token with system/AuditEvent.read; patient/ and user/ scopes never read the audit trail") };
    return { ok: true, actorId: b.actor && b.actor.id };
  }
  try {
    const r = await resolveClinicalActor(request, env, ctx.migration.tenantId, "record:read", ctx.actorDeps);
    return { ok: true, actorId: r.actor.id };
  } catch (e) {
    const status = e instanceof AuthError ? 401 : e instanceof PermissionError ? 403 : 502;
    return { status, outcome: operationOutcome("error", status === 401 ? "login" : "forbidden", str(e && e.message) || "not permitted") };
  }
}

/**
 * GET AuditEvent/{id} and GET AuditEvent?date=&agent=&type=&entity-type=&outcome=&_count=&_page=.
 * ctx: { migration, id?, base, actorDeps, recordDeps, actorOverride? }
 */
async function auditEvents(request, env, ctx, url) {
  const mig = ctx.migration;
  if (!mig || mig.mode === "off") return { status: 404, obj: operationOutcome("error", "not-supported", "this hospital does not run the WardSynQ record") };
  const q = url.searchParams;
  const bad = [...new Set(q.keys())].filter((k) => !SEARCH.includes(k));
  if (!ctx.id && bad.length) return { status: 400, obj: operationOutcome("error", "not-supported", `${bad.join(", ")}: AuditEvent is searched by date, agent, type, entity-type and outcome`) };
  const dates = ctx.id ? [] : q.getAll("date").map((d) => ({ raw: d, c: dateClause(d) }));
  if (dates.some((d) => !d.c)) return { status: 400, obj: operationOutcome("error", "invalid", "date must be a FHIR date with an optional ge, gt, le, lt or eq prefix") };

  const who = await authorise(request, env, ctx);
  if (!who.ok) return { status: who.status, obj: who.outcome };
  const repository = ctx.recordDeps.repository;
  if (typeof repository.auditTrail !== "function") return { status: 501, obj: operationOutcome("error", "not-supported", "this deployment's storage cannot read the audit trail back") };

  /* A lower bound is pushed down to the store, a day early so a time zone cannot cut a row off; the
   * exact match happens here. Only when EVERY clause bounds from below, else the store reads newest. */
  const floors = dates.map((d) => (["ge", "gt", "eq", "sa"].includes(d.c.prefix) ? Date.parse(d.c.value) : NaN));
  const lower = floors.length && floors.every(Number.isFinite) ? new Date(Math.max(...floors) - 86400000).toISOString() : "";
  let trail;
  try { trail = await repository.auditTrail(mig.tenantId, { since: lower }); }
  catch (e) { return { status: 502, obj: operationOutcome("error", "exception", "the audit trail could not be read") }; }
  try { await repository.auditOnly(mig.tenantId, { ts: new Date().toISOString(), actor: who.actorId || "unknown", connectorId: "wardsynq", action: "fhir.auditevent.read", scope: { resourceType: "AuditEvent", ...(ctx.id ? { id: str(ctx.id) } : {}) }, outcome: "ok" }); }
  catch { return { status: 502, obj: operationOutcome("error", "exception", "reading the audit trail could not itself be audited, so it was not read") }; }

  const rows = [...(trail.events || [])].reverse().map(fhirAuditEvent);
  if (ctx.id) {
    /* ponytail: a read scans the newest AUDIT_READ_MAX rows; an older row is found by searching with date=. */
    const hit = rows.find((r) => r.id === str(ctx.id));
    return hit ? { status: 200, obj: hit } : { status: 404, obj: operationOutcome("error", "not-found", `no such AuditEvent among the ${rows.length} newest rows; search with date= for an older one`) };
  }
  const tok = (k) => str(q.get(k));
  const matched = rows.filter((r) =>
    dates.every((d) => dateMatches(r.recorded, d.c)) &&
    (!tok("agent") || str(r.agent[0].who.identifier && r.agent[0].who.identifier.value) === tok("agent").split("|").pop()) &&
    (!tok("type") || r.type.code === tok("type").split("|").pop()) &&
    (!tok("entity-type") || (r.entity || []).some((x) => x.type && x.type.code === tok("entity-type"))) &&
    (!tok("outcome") || r.outcome === tok("outcome")));
  const count = Math.min(MAX_COUNT, Math.max(1, Math.floor(Number(q.get("_count")) || DEFAULT_COUNT)));
  const page = Math.max(0, Math.floor(Number(q.get("_page")) || 0));
  const slice = matched.slice(page * count, page * count + count);
  const params = new URLSearchParams(q); params.delete("_page");
  const link = (p) => { const u = new URLSearchParams(params); if (p) u.set("_page", String(p)); return `${str(ctx.base)}/AuditEvent?${u.toString()}`; };
  const links = [{ relation: "self", url: link(page) }];
  if ((page + 1) * count < matched.length) links.push({ relation: "next", url: link(page + 1) });
  const entry = slice.map((r) => ({ fullUrl: `${str(ctx.base)}/AuditEvent/${r.id}`, resource: r, search: { mode: "match" } }));
  if (trail.truncated) entry.push({ resource: operationOutcome("warning", "too-costly", `Only the newest ${(trail.events || []).length} audit rows were read. Narrow the search with date=ge... to reach older rows.`), search: { mode: "outcome" } });
  return { status: 200, obj: { resourceType: "Bundle", type: "searchset", total: matched.length, link: links, entry } };
}

export { ACTION_SYSTEM, PATIENT_REF_SYSTEM, fhirAuditEvent, auditEvents };
